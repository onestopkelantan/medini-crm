/**
 * Map a staff data question to the report(s) that can answer it.
 *
 * FACTS-FIRST (design spec §3): the resolver is deterministic keyword
 * matching, NOT a model decision. The model never chooses which data to see;
 * it only narrates what this function selected. A miss returns keys: [] and
 * the caller answers honestly with the capability list — a wrong report
 * match would put real numbers under the wrong question, which is worse
 * than admitting the analyst cannot answer.
 *
 * Pure and deterministic — no I/O, no clock. Caller supplies today.
 */

export type ReportKey =
  | 'kpis'
  | 'revenueByBranch'
  | 'treatmentMix'
  | 'appointmentTrends'
  | 'doctorProduction'
  | 'newPatients'
  | 'formsIssued';

export type Period = '7D' | '30D' | '90D' | '12M';

export interface AnalystQuestion {
  readonly keys: readonly ReportKey[];
  readonly period: Period;
  /**
   * True when the question explicitly asks to compare the current period with
   * the previous one ("bandingkan", "berbanding", "vs last..."). The service
   * then fetches the previous window too and hands the model both fact
   * blocks. Deterministic — the model never decides to compare.
   */
  readonly compare: boolean;
}

/**
 * Comparison intent, detected by KEYWORDS ONLY (fail-closed like the topic
 * matcher): a bare "vs" is not enough because it appears in questions that
 * are not period comparisons ("doktor vs pesakit"). Fetching a second window
 * doubles the query load and puts unasked facts in the prompt.
 */
export function wantsComparison(text: string): boolean {
  return /\b(bandingkan|banding|berbanding|compare[ds]?\b|compared|versus last|vs\.? last|with last)\b/i.test(text)
    || /\bcompare\b.*\bvs\b/i.test(text)
    || /\bvs\b.*\blepas\b/i.test(text)
    || /\bvs\b.*\blast\b/i.test(text);
}

/** Canonical order = the order facts are rendered in the prompt. */
const CANONICAL: readonly ReportKey[] = [
  'kpis', 'revenueByBranch', 'treatmentMix',
  'appointmentTrends', 'doctorProduction', 'newPatients', 'formsIssued',
];

interface Topic {
  readonly re: RegExp;
  readonly keys: readonly ReportKey[];
}

const TOPICS: readonly Topic[] = [
  {
    /* 'finance'/'cek' ditambah selepas laporan pemilik: "kalau cek finance?"
     * jatuh ke dinding kemampuan walaupun revenue tersenarai di dalamnya. */
    re: /\b(kutipan|jualan|hasil|pendapatan|revenue|revenues|sales|income|finance|finances?|perbelanjaan|expenses?|untung|profit)\b/i,
    keys: ['kpis', 'revenueByBranch'],
  },
  {
    re: /\b(no[- ]?show|tidak hadir|tak datang|absen)\b/i,
    keys: ['kpis', 'appointmentTrends'],
  },
  /* Treatments. The old regex used \btreatment\b, which never matches the
   * PLURAL ("treatments") because the word boundary falls before the 's' —
   * so the UI's own example "Top treatments in the last 30 days?" hit the
   * capability fallback. */
  {
    re: /\b(rawatan|treatments?|campuran|mix)\b/i,
    keys: ['treatmentMix'],
  },
  /* Appointments generally — trends, counts, visits. Previously reachable
   * only via the no-show phrasing; now a first-class topic so
   * "Appointment trends this week?" resolves. */
  {
    re: /\b(temujanji|appointments?|trend|visits?|lawatan|kunjungan)\b/i,
    keys: ['kpis', 'appointmentTrends'],
  },
  {
    re: /\b(doktor|doctors?|produksi|production)\b/i,
    keys: ['doctorProduction'],
  },
  {
    re: /\b(pesakit baharu|pesakit baharu|pesakit baru|new patients?|pendaftaran baharu)\b/i,
    keys: ['newPatients'],
  },
  {
    re: /\b(borang|forms?|mc|sijil|certificates?)\b/i,
    keys: ['formsIssued'],
  },
];

interface PeriodRule {
  readonly re: RegExp;
  readonly period: Period;
}

/** Order matters: specific phrases first. */
const PERIODS: readonly PeriodRule[] = [
  { re: /\b(7 hari|seminggu|minggu ini|last week|this week|weekly)\b/i, period: '7D' },
  { re: /\b(90 hari|tiga bulan|3 bulan|quarter|suku tahun)\b/i, period: '90D' },
  { re: /\b(tahun ini|setahun|yearly|this year|annual|12 bulan)\b/i, period: '12M' },
  { re: /\b(30 hari|bulan (ni|ini|lepas)|last month|this month|monthly|sebulan)\b/i, period: '30D' },
];

const DEFAULT_PERIOD: Period = '30D';

export function resolveAnalystQuestion(
  text: string,
  _today: string,
): AnalystQuestion {
  const keys = new Set<ReportKey>();
  for (const topic of TOPICS) {
    if (topic.re.test(text)) topic.keys.forEach((k) => keys.add(k));
  }

  let period = DEFAULT_PERIOD;
  for (const rule of PERIODS) {
    if (rule.re.test(text)) {
      period = rule.period;
      break;
    }
  }

  return {
    keys: CANONICAL.filter((k) => keys.has(k)),
    period,
    compare: wantsComparison(text),
  };
}

/** The honest reply when keys is empty — what the analyst CAN answer. */
export const ANALYST_CAPABILITY_REPLY = [
  'Maaf, soalan itu di luar skop saya setakat ini.',
  'Saya boleh jawab tentang:',
  '• Kutipan / jualan (jumlah & ikut cawangan)',
  '• Kadar no-show & trend temujanji',
  '• Campuran rawatan',
  '• Produksi doktor',
  '• Pesakit baharu',
  '• Borang dikeluarkan (MC/PDPA)',
  'Nyatakan tempoh juga (contoh: "bulan lepas", "7 hari").',
].join('\n');
