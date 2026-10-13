/**
 * Render fetched report results as FACT lines for the analyst prompt.
 *
 * Same contract as the slot-context formatter: the model receives SYSTEM
 * FACTS and narrates them. Numbers come from the Reports layer; this module
 * only stringifies. `available:false` KPIs render as "tidak tersedia" so the
 * model states unavailability instead of computing something (the
 * revenue_per_appointment honesty precedent).
 */

interface KpiCard {
  kpiKey: string;
  value: string | null;
  unit: string;
  available: boolean;
  note?: string;
}

/** Structural shape of the LIVE reports envelopes (verified against /reports/*
 * on 2 Oct 2026). appointmentTrends carries `series` (not rows); KPI cards
 * carry {kpiKey, value, unit} (not label/display); revenueByBranch rows
 * carry `revenue`; doctorProduction rows carry {name, appointmentsCompleted};
 * newPatients rows are per-patient; formsIssued carries {total, byKind}. */
export interface AnalystData {
  kpis?: { period: string; cards: KpiCard[] };
  revenueByBranch?: { period: string; total?: string; rows: Array<{ branchName: string; revenue: string }> };
  treatmentMix?: { period: string; rows: Array<{ category: string; count: number; share: number }> };
  appointmentTrends?: { period: string; series: Array<{ date: string; booked: number; completed: number; noShow: number }> };
  doctorProduction?: { period: string; rows: Array<{ name: string; appointmentsCompleted: number }> };
  newPatients?: { period: string; rows: Array<{ mrn: string }> };
  formsIssued?: { period: string; total: number; byKind?: Array<{ kind: string; count: number }> };
}

const UNAVAILABLE = 'tidak tersedia';

/** Human labels for the KPI keys the Reports layer emits. */
const KPI_LABELS: Record<string, string> = {
  revenue: 'Jumlah Kutipan',
  revenue_per_appointment: 'Kutipan Setiap Temujanji',
  recall_rate: 'Kadar Recall',
  no_show_rate: 'Kadar No-Show',
  chair_utilisation: 'Penggunaan Kerusi',
};

/** Render a raw value + unit the way a Malaysian clinic reads it. */
function renderKpiValue(card: KpiCard): string {
  if (!card.available || card.value == null) return UNAVAILABLE;
  if (card.unit === 'MYR') {
    return `RM${Number(card.value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (card.unit === 'percent') return `${Number(card.value).toFixed(1)}%`;
  return `${card.value}${card.unit ? ` ${card.unit}` : ''}`;
}

function rm(value: string | number): string {
  return `RM${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildAnalystFacts(period: string, data: AnalystData): string {
  const sections: string[] = [];

  if (data.kpis) {
    const lines = data.kpis.cards.map(
      (c) => `• ${KPI_LABELS[c.kpiKey] ?? c.kpiKey}: ${renderKpiValue(c)}`,
    );
    sections.push(`KPI (${period}):\n${lines.join('\n')}`);
  }

  if (data.revenueByBranch) {
    const lines = data.revenueByBranch.rows.map(
      (r) => `• ${r.branchName}: ${rm(r.revenue)}`,
    );
    sections.push(`KUTIPAN IKUT CAWANGAN (${period}):\n${lines.join('\n')}`);
  }

  if (data.treatmentMix) {
    const lines = data.treatmentMix.rows.map(
      (r) => `• ${r.category}: ${r.count}× (${r.share}%)`,
    );
    sections.push(`CAMPURAN RAWATAN (${period}):\n${lines.join('\n')}`);
  }

  if (data.appointmentTrends) {
    /* Bounded: a 12M series is long; the model needs the shape, not every day. */
    const lines = data.appointmentTrends.series
      .slice(-10)
      .map((r) => `• ${r.date}: tempah ${r.booked} · selesai ${r.completed} · tidak hadir ${r.noShow}`);
    const extra = data.appointmentTrends.series.length - 10;
    const suffix = extra > 0 ? `\n• …(${extra} hari lain diabaikan untuk ringkasan)` : '';
    sections.push(`TREND TEMUJANJI (${period}, 10 hari terkini):\n${lines.join('\n')}${suffix}`);
  }

  if (data.doctorProduction) {
    const lines = data.doctorProduction.rows.map(
      (r) => `• ${r.name}: ${r.appointmentsCompleted} temujanji selesai`,
    );
    sections.push(`PRODUKSI DOKTOR (${period}):\n${lines.join('\n')}`);
  }

  if (data.newPatients) {
    sections.push(`PESAKIT BAHARU (${period}): jumlah ${data.newPatients.rows.length}`);
  }

  if (data.formsIssued) {
    const kinds = (data.formsIssued.byKind ?? [])
      .map((k) => `• ${k.kind}: ${k.count}`)
      .join('\n');
    sections.push(
      `BORANG DIKELUARKAN (${period}): jumlah ${data.formsIssued.total}${kinds ? `\n${kinds}` : ''}`,
    );
  }

  const body =
    sections.length > 0
      ? sections.join('\n\n')
      : 'tiada data diperoleh untuk tempoh ini';

  return [
    `DATA DISAHKAN SISTEM (${period}) — jawab HANYA dengan nombor di bawah; JANGAN mereka, jangan kira sendiri:`,
    body,
  ].join('\n');
}

/** The analyst persona — mirrors nurPrompt conventions (BM-first, short). */
export const ANALYST_PROMPT = `Awak ialah penganalisis data Klinik Pergigian Medini. Jawab soalan staf tentang data klinik menggunakan HANYA DATA DISAHKAN SISTEM yang diberikan.
- Bahasa Melayu profesional; boleh campur istilah Inggeris.
- Sebut angka dari data sahaja. JANGAN mereka, jangan agak, jangan kira sendiri.
- Kalau data tidak tersedia, kata terus "tidak tersedia".
- Maksimum 4-5 ayat. Nyatakan tempoh dalam jawapan (contoh: "bagi 30 hari lepas").`;
