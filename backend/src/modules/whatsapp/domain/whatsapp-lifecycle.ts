/**
 * SPRINT 6 — WhatsApp Hub deterministic lifecycles + safety engine.
 * Pure functions only: no DB, no transport, no workers, no AI decisions.
 * Gate order + thresholds are taken VERBATIM from the locked M2 WhatsApp Hub
 * architecture (docs/M2-WHATSAPP-HUB.md Fasa 1) — do NOT invent new gates.
 */

export type WaChannelState = 'stopped' | 'starting' | 'working' | 'failed' | 'need_qr';
export type WaConversationState = 'new' | 'open' | 'pending' | 'escalated' | 'resolved' | 'archived';
export type WaMessageState = 'queued' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed';
export type WaAiQueueState = 'received' | 'buffering' | 'ready' | 'processing' | 'responded' | 'waiting' | 'handoff' | 'closed';

function allows(current: string, next: string, transitions: Record<string, readonly string[]>): boolean {
  return current === next || (transitions[current] ?? []).includes(next);
}

/* ---------- Channel: STOPPED→STARTING→WORKING→FAILED→(restart); WORKING↔NEED_QR ---------- */
export const canTransitionWaChannel = (current: WaChannelState, next: WaChannelState) => allows(current, next, {
  stopped: ['starting'],
  starting: ['working', 'failed', 'need_qr'],
  working: ['failed', 'need_qr', 'stopped'],
  failed: ['starting', 'stopped'],
  need_qr: ['working', 'stopped'],
});

/* ---------- Conversation (governance-final):
   new→open→pending→resolved→archived · open→escalated→open · resolved→open (reopen)
   archived = TERMINAL (no reopen). new may also move straight to pending/resolved. */
export const canTransitionWaConversation = (current: WaConversationState, next: WaConversationState) => allows(current, next, {
  new: ['open', 'pending', 'resolved'],
  open: ['pending', 'resolved', 'escalated'],
  pending: ['open', 'resolved'],
  escalated: ['open'],
  resolved: ['open', 'archived'],
  archived: [] /* terminal — same contact returns → NEW conversation */,
});

/* ---------- Message: queued→processing→sent→delivered→read · queued→processing→failed (terminal). ---------- */
export const canTransitionWaMessage = (current: WaMessageState, next: WaMessageState) => allows(current, next, {
  queued: ['processing', 'sent', 'failed'],
  processing: ['sent', 'failed'],
  sent: ['delivered'],
  delivered: ['read'],
  read: [],
  failed: [],
});

/* ---------- AI response queue (state foundation only — no timer/worker in S6). ---------- */
export const canTransitionWaAiQueue = (current: WaAiQueueState, next: WaAiQueueState) => allows(current, next, {
  received: ['buffering'],
  buffering: ['ready'],
  ready: ['processing'],
  processing: ['responded', 'waiting', 'handoff'],
  responded: ['closed'],
  waiting: ['ready', 'handoff', 'closed'],
  handoff: ['closed'],
  closed: [],
});

/* ============================================================================
   SAFETY ENGINE — six locked gates, evaluated IN ORDER (M2 Fasa 1).
   Deterministic control layer only. NOT AI/LLM, NOT transport, NOT scheduler.
   ==========================================================================*/
export const WA_HEALTH_READY_MIN = 70; /* score >= 70 = ready to send */
export const WA_DAILY_CAP_DEFAULT = 50;
export const WA_SEND_WINDOW_START = 9; /* 09:00 local */
export const WA_SEND_WINDOW_END = 18; /* 18:00 local */
/* D18: 30s lower bound approved by Bos governance (S8 remediation authorization,
 * master prompt §D18 override: "30–60 SECOND randomized per-channel cooldown").
 * Worker randomizes each send to 30–60s. */
export const WA_MIN_INTERVAL_MS = 30_000;
export const WA_AUTO_PAUSE_EVERY = 25; /* every 25 sends → auto-pause gate engages */
export const WA_AUTO_PAUSE_MS = 15 * 60_000; /* N6-3: auto-pause duration before auto-resume */
export const WA_SEND_DELAY_MIN_MS = 30_000; /* D18 override: randomized cooldown floor */
export const WA_SEND_DELAY_MAX_MS = 60_000; /* D18 override: randomized cooldown ceiling */

export type WaBlockedReason =
  | 'CHANNEL_UNAVAILABLE'
  | 'LOW_HEALTH'
  | 'DAILY_CAP_REACHED'
  | 'OUTSIDE_SENDING_WINDOW'
  | 'RATE_LIMIT'
  | 'AUTO_PAUSED';

export interface WaSafetyInput {
  channelStatus: WaChannelState;
  healthScore: number;
  sentTodayCount: number;
  lastSentAt: Date | null;
  now: Date;
  dailyCap?: number;
  windowStartHour?: number;
  windowEndHour?: number;
  minIntervalMs?: number;
  autoPauseEvery?: number;
  /** When true (post auto-resume), gate 6 is treated as passed so the resume
   * send is not immediately re-blocked by the deterministic threshold. */
  skipAutoPause?: boolean;
}

export interface WaSafetyGateResult {
  gate: string;
  passed: boolean;
  reason: WaBlockedReason | null;
}

export interface WaSafetyEvaluation {
  allowed: boolean;
  blockedReason: WaBlockedReason | null;
  gates: WaSafetyGateResult[];
}

export function evaluateWaSafety(input: WaSafetyInput): WaSafetyEvaluation {
  const dailyCap = input.dailyCap ?? WA_DAILY_CAP_DEFAULT;
  const winStart = input.windowStartHour ?? WA_SEND_WINDOW_START;
  const winEnd = input.windowEndHour ?? WA_SEND_WINDOW_END;
  const minInterval = input.minIntervalMs ?? WA_MIN_INTERVAL_MS;
  const autoPauseEvery = input.autoPauseEvery ?? WA_AUTO_PAUSE_EVERY;

  const gates: WaSafetyGateResult[] = [];
  const push = (gate: string, passed: boolean, reason: WaBlockedReason | null) => {
    gates.push({ gate, passed, reason });
    return passed;
  };

  /* 1. Channel Availability */
  if (!push('channel_availability', input.channelStatus === 'working', 'CHANNEL_UNAVAILABLE')) {
    return { allowed: false, blockedReason: 'CHANNEL_UNAVAILABLE', gates };
  }
  /* 2. Health Score */
  if (!push('health_score', input.healthScore >= WA_HEALTH_READY_MIN, 'LOW_HEALTH')) {
    return { allowed: false, blockedReason: 'LOW_HEALTH', gates };
  }
  /* 3. Daily Cap */
  if (!push('daily_cap', input.sentTodayCount < dailyCap, 'DAILY_CAP_REACHED')) {
    return { allowed: false, blockedReason: 'DAILY_CAP_REACHED', gates };
  }
  /* 4. Sending Window (09:00–18:00 MALAYSIA TIME, UTC+8 — clinic operations).
   * Server clock may be UTC; the business window is always interpreted in MYT. */
  const hour = (input.now.getUTCHours() + 8) % 24;
  if (!push('sending_window', hour >= winStart && hour < winEnd, 'OUTSIDE_SENDING_WINDOW')) {
    return { allowed: false, blockedReason: 'OUTSIDE_SENDING_WINDOW', gates };
  }
  /* 5. Interval / Cooldown since last send */
  const sinceLast = input.lastSentAt ? input.now.getTime() - input.lastSentAt.getTime() : Number.POSITIVE_INFINITY;
  if (!push('interval_cooldown', sinceLast >= minInterval, 'RATE_LIMIT')) {
    return { allowed: false, blockedReason: 'RATE_LIMIT', gates };
  }
  /* 6. Auto-Pause (every N sends → pause cycle; human review resumes the channel) */
  if (input.skipAutoPause) {
    gates.push({ gate: 'auto_pause', passed: true, reason: null });
  } else if (!push('auto_pause', (input.sentTodayCount + 1) % autoPauseEvery !== 0, 'AUTO_PAUSED')) {
    return { allowed: false, blockedReason: 'AUTO_PAUSED', gates };
  }
  return { allowed: true, blockedReason: null, gates };
}

/* ============================================================================
   DEVICE HEALTH — deterministic derived status (M2 Fasa 1 thresholds).
   S6 persists the score; background recalculation worker = S8.
   ==========================================================================*/
export type WaHealthBand = 'healthy' | 'ready' | 'warming' | 'critical';
export function waHealthBand(score: number): WaHealthBand {
  if (score >= 85) return 'healthy';
  if (score >= 70) return 'ready';
  if (score >= 40) return 'warming';
  return 'critical';
}

/* Phone normalisation for deterministic contact identity + patient matching.
 * Strips everything except digits; converts Malaysia local 01x → 601x. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0') && !digits.startsWith('00')) return `6${digits}`;
  return digits;
}
