/**
 * FASA 5D-B — notifications for the clinic.
 *
 * WHY THIS EXISTS
 *
 * The queue named 'notifications' was declared in QueueRegistry and never used —
 * no sender, no table, no module. So when the AI handed a patient to a human,
 * the conversation was flagged in the database and NOTHING told anybody. The
 * patient waited in a list nobody was watching.
 *
 * FASA 5D-A made the AI switchable. Without this, switching it off silently
 * converts every patient message into an unread row.
 *
 * THE HARD PART IS NOT SENDING — IT IS NOT SPAMMING
 *
 * A busy clinic produces events in bursts: five patients ask for a human within
 * a minute, three channels flap, two blasts get refused. Twenty separate alerts
 * means the operator learns to dismiss alerts, and then the one that mattered is
 * dismissed with them.
 *
 * So this module's central concern is coalescing: the same KIND of event, for
 * the same branch, inside a short window, becomes ONE notification that counts
 * up. The operator sees "5 pesakit menunggu", not five rows.
 *
 * WHAT IS COALESCED AND WHAT IS NOT
 *
 * Coalescing an opt-out would be wrong. Each STOP is a separate patient, a
 * separate compliance record, and a separate conversation the clinic may need to
 * act on. Telling an operator "3 pesakit berhenti melanggan" hides which three,
 * and that is the piece that matters. Bursts of waiting patients coalesce; named
 * patients do not.
 */

export type NotificationKind =
  | 'human_needed'
  | 'opt_out'
  | 'channel_error'
  | 'blast_blocked';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationDraft {
  kind: NotificationKind;
  severity: NotificationSeverity;
  /** One line the operator reads first. */
  title: string;
  /** One plain sentence saying what to do, or what happened. */
  body: string;
  /** `''` when the kind aggregates rather than naming one record. */
  entityId: string;
}

/**
 * How each kind behaves.
 *
 * `coalesce` answers "if another one of these arrives within the window, add to
 * the existing notification instead of creating a second?" — the decision that
 * keeps a burst legible.
 *
 * `windowMinutes` is how long a burst is considered the same event. Ten minutes
 * suits a clinic: a receptionist who clears the queue and comes back should get
 * a fresh alert, not one that has been silently accumulating for an hour.
 *
 * `actionable` marks the kinds that represent a patient currently waiting. Those
 * are the ones that escalate to `critical` as their count grows — the others do
 * not, because a stopped channel is not more urgent for having happened twice.
 */
export const NOTIFICATION_RULES: Record<
  NotificationKind,
  {
    coalesce: boolean;
    windowMinutes: number;
    actionable: boolean;
    baseSeverity: NotificationSeverity;
    /** Count at which an actionable notification becomes critical. */
    criticalAt: number;
  }
> = {
  human_needed: {
    /* Aggregated per branch: the operator's question is "how many are waiting",
     * not "which row is newest". The detail lives in the conversation list. */
    coalesce: true,
    windowMinutes: 10,
    actionable: true,
    baseSeverity: 'warning',
    criticalAt: 3,
  },
  opt_out: {
    /* NEVER coalesced. Each STOP is a patient who must not be messaged again —
     * an aggregated "3 pesakit" hides exactly the part the clinic needs. */
    coalesce: false,
    windowMinutes: 0,
    actionable: false,
    baseSeverity: 'info',
    criticalAt: 99,
  },
  channel_error: {
    coalesce: true,
    windowMinutes: 15,
    actionable: false,
    /* Repeated failures are not more urgent, only more persistent — but one is
     * already serious, because a dead channel stops every outbound message. */
    baseSeverity: 'critical',
    criticalAt: 99,
  },
  blast_blocked: {
    coalesce: false,
    windowMinutes: 0,
    actionable: false,
    baseSeverity: 'warning',
    criticalAt: 99,
  },
};

/**
 * Should this draft add to an existing notification, or start a new one?
 *
 * This is the RULE, stated in one place. The merge itself is not performed in
 * TypeScript: NotificationService.raise() hands the same conditions to MySQL
 * (`ON DUPLICATE KEY UPDATE` with the age test in a CASE), because reading and
 * then writing is not atomic and lost events under concurrent bursts.
 *
 * Keep the two in step. If the rule changes here, change the CASE in raise().
 * The tests for this function pin the boundary; the live verification pins the
 * SQL.
 *
 * @param rule          the kind's rule
 * @param existingAgeMs how long ago the candidate notification was last updated
 * @param sameEntity    whether the candidate names the same record
 */
export function shouldCoalesce(
  rule: (typeof NOTIFICATION_RULES)[NotificationKind],
  existingAgeMs: number,
  sameEntity: boolean,
): boolean {
  if (!rule.coalesce) return false;
  if (!sameEntity) return false;
  return existingAgeMs <= rule.windowMinutes * 60_000;
}

/**
 * Severity for a notification with `count` occurrences.
 *
 * Only actionable kinds escalate: three patients waiting is more urgent than
 * one, whereas three failed channel calls are the same problem observed three
 * times.
 */
export function severityFor(
  rule: (typeof NOTIFICATION_RULES)[NotificationKind],
  count: number,
): NotificationSeverity {
  if (rule.actionable && count >= rule.criticalAt) return 'critical';
  return rule.baseSeverity;
}

/** Sort key: unread first, then critical, then newest. */
export function notificationRank(n: {
  readAt: string | Date | null;
  severity: NotificationSeverity;
  lastAt: string | Date;
}): number {
  const read = n.readAt ? 1 : 0;
  const sev = n.severity === 'critical' ? 0 : n.severity === 'warning' ? 1 : 2;
  /* Newest first within a group: negate the epoch so a later time sorts lower. */
  const time = -new Date(n.lastAt).getTime();
  return read * 1_000_000_000_000 + sev * 1_000_000_000 + (time / 1_000_000);
}

/**
 * Copy for the operator, in plain Malay.
 *
 * Kept in one place because the same event is described in the list, in the
 * bell's popover and — later — in a Telegram message, and three phrasings of the
 * same fact read as three different facts.
 */
export function describeNotification(input: {
  kind: NotificationKind;
  count: number;
  branchName?: string | null;
  /** Minutes the longest-waiting patient has waited, when known. */
  waitedMinutes?: number | null;
}): { title: string; body: string } {
  const { kind, count, branchName, waitedMinutes } = input;
  const branch = branchName ? ` di ${branchName}` : '';

  switch (kind) {
    case 'human_needed': {
      const who =
        count === 1
          ? '1 pesakit menunggu dijawab'
          : `${count} pesakit menunggu dijawab`;
      /* The wait time is the fact that turns a notification into a decision. */
      const wait =
        waitedMinutes && waitedMinutes > 0
          ? ` Paling lama ${waitedMinutes} minit.`
          : '';
      return {
        title: `${who}${branch}`,
        body: `Buka WhatsApp Hub dan jawab. AI tidak akan menjawab perbualan ini.${wait}`,
      };
    }

    case 'opt_out':
      return {
        title: `Pesakit berhenti melanggan${branch}`,
        body:
          'Pesakit menghantar STOP. Nombor ini tidak akan menerima blast atau ' +
          'mesej lain dari mana-mana cawangan Medini.',
      };

    case 'channel_error':
      return {
        title: `Masalah saluran WhatsApp${branch}`,
        body:
          count > 1
            ? `${count} kali gagal. Mesej tidak dapat dihantar sehingga saluran pulih.`
            : 'Mesej tidak dapat dihantar. Semak sambungan WhatsApp di skrin QR.',
      };

    case 'blast_blocked':
      return {
        title: `Blast tidak dihantar${branch}`,
        body: 'Kempen dihentikan oleh sistem keselamatan. Semak sebabnya di WhatsApp Campaign.',
      };
  }
}
