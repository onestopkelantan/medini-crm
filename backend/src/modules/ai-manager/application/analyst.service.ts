import { Injectable, Logger } from '@nestjs/common';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { AiPolicyPort } from '../../../shared/ports/ai-policy.port';
import { ReportsService } from '../../reports/application/reports.service';
import { FinanceAiService } from '../../finance/application/finance-ai.service';
import type { PeriodRange } from '../../reports/domain/period-resolver';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import {
  resolveAnalystQuestion,
  ANALYST_CAPABILITY_REPLY,
  type ReportKey,
} from '../domain/analyst-question';
import { buildAnalystFacts, ANALYST_PROMPT, type AnalystData } from '../domain/analyst-facts';

/**
 * Human label for the previous window, shown in the facts header so the model
 * quotes the window it is comparing against (Phase B — dental-erp
 * clinic-analyst "compare current vs previous" pattern).
 */
const PREVIOUS_LABEL: Record<string, string> = {
  '7D': '7 hari sebelumnya',
  '30D': '30 hari sebelumnya',
  '90D': '90 hari sebelumnya',
  '12M': '12 bulan sebelumnya',
};

/**
 * Data Analyst agent — facts-first question answering over the Reports layer.
 *
 * Flow (design spec §4.4): policy gate → resolve → fetch (caller's principal,
 * so scope is enforced by ReportsService itself) → facts → ONE model call.
 * The model narrates; the numbers are fetched by code.
 */
@Injectable()
export class AnalystService {
  private readonly logger = new Logger('DataAnalyst');

  constructor(
    private readonly policy: AiPolicyPort,
    private readonly reports: ReportsService,
    private readonly minimax: MinimaxAdapter,
    private readonly financeAi: FinanceAiService,
  ) {}

  /**
   * A2 — the finance-ai route of the AI Assistant. Runs the SAME
   * policy-gated overdue scan the Balances tab's "Imbas Kutipan" runs
   * (drafts escalation follow-ups into the approval queue) and narrates
   * what it did with real counts. The scan itself is HQ-only by its own
   * service rule — a branch manager asking here gets the honest refusal,
   * not a watered-down scan.
   */
  async financeCollections(principal: Principal): Promise<{
    reply: string;
    sources: Array<{ key: string; period: string }>;
  }> {
    const result = await this.financeAi.scanOverdue(principal);
    const reply =
      `Imbasan kutipan (Finance AI) selesai. ` +
      `${result.scanned} pelan diperiksa, ${result.drafted} draf eskalasi dicipta ke dalam baris kelulusan, ` +
      `${result.skippedExisting} sudah mempunyai draf, ${result.staffTasks} tugas staf dijana. ` +
      `Semak dan luluskan draf di Kewangan → Baki Pesakit, atau di baris kelulusan AI Manager.`;
    return { reply, sources: [{ key: 'finance-ai', period: 'live' }] };
  }

  async ask(principal: Principal, message: string): Promise<{
    reply: string;
    sources: Array<{ key: ReportKey; period: string }>;
  }> {
    /* 1. POLICY GATE — the pause button is real here too. Unknown/paused/
     *    revoked → refuse before any data leaves or any model call is made.
     *
     *    insights-ai is DRAFT-ONLY (LOCKED rule 3: analytics insights never
     *    execute autonomously). The answer this endpoint returns is a DRAFT the
     *    human reads and acts on — so the gate asks for DRAFT, not EXECUTE. */
    const allowed = await this.policy.canDraft(principal, {
      agentKey: 'insights-ai',
      domain: 'reports',
      actionKey: 'analyst.answer',
    });
    if (!allowed) {
      throw new ForbiddenError('Agen Insights AI tidak aktif (paused/registered) di AI Manager');
    }

    /* 2. RESOLVE — deterministic. No match → honest capability reply, no
     *    model call, no data fetch. */
    const q = resolveAnalystQuestion(message, new Date().toISOString().slice(0, 10));
    if (q.keys.length === 0) {
      return { reply: ANALYST_CAPABILITY_REPLY, sources: [] };
    }

    /* 3. FETCH — each report with the CALLER's principal. Scope (HQ=all,
     *    manager=own branch) is enforced by ReportsService; we add nothing.
     *
     *    COMPARISON (Phase B): when the question explicitly asks to compare
     *    ("bandingkan ... dengan bulan lepas"), we fetch the SAME reports for
     *    the previous window too and render a second facts block. The delta
     *    wording stays in the prompt — the model narrates both windows; it
     *    never computes a number we did not fetch. */
    const previous = q.compare ? this.reports.previousWindow(q.period) : null;
    const fetchers: Record<string, (range?: PeriodRange) => Promise<unknown>> = {
      kpis: (range) => this.reports.kpis(principal, q.period, range),
      revenueByBranch: (range) => this.reports.revenueByBranch(principal, q.period, undefined, range),
      treatmentMix: (range) => this.reports.treatmentMix(principal, q.period, range),
      appointmentTrends: (range) => this.reports.appointmentTrends(principal, q.period, range),
      doctorProduction: (range) => this.reports.doctorProduction(principal, q.period, range),
      newPatients: (range) => this.reports.newPatients(principal, q.period, range),
      formsIssued: (range) => this.reports.formsIssued(principal, q.period, range),
    };

    const fetchAll = async (range?: PeriodRange): Promise<AnalystData> => {
      const out: AnalystData = {};
      for (const key of q.keys) {
        try {
          (out as Record<string, unknown>)[key] = await fetchers[key]!(range);
        } catch (error) {
          /* A failing report omits its facts; the reply stays honest about
           * what is missing rather than failing the whole answer. */
          this.logger.warn(
            `Laporan "${key}"${range ? ' (tempoh lepas)' : ''} gagal diambil: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return out;
    };

    const data = await fetchAll();
    const prevData = previous ? await fetchAll(previous) : null;

    /* 4. FACTS + ONE MODEL CALL. The comparison block labels the previous
     * window explicitly so the model quotes it correctly. */
    const previousFacts = prevData
      ? '\n\n' + buildAnalystFacts(PREVIOUS_LABEL[q.period] ?? 'tempoh sebelumnya', prevData)
      : '';
    const facts = buildAnalystFacts(q.period, data) + previousFacts;
    const reply = await this.minimax.chat(ANALYST_PROMPT + '\n\n' + facts, message);

    return {
      reply,
      sources: q.keys.map((key) => ({ key, period: q.period })),
    };
  }
}
