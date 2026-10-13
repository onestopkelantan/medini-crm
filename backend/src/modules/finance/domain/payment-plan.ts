/**
 * Payment plan arithmetic — P4 (0028).
 *
 * Pure and deterministic: no I/O, no clock. The caller supplies `start`
 * and `today` (the service passes real ones; tests pass fixed ones).
 *
 * THE INVARIANT THIS MODULE EXISTS TO HOLD
 *
 *   down_payment + SUM(schedule.amount) = total_amount
 *
 * The schedule is GENERATED, never accepted from input — a client that could
 * post its own instalment rows could post a plan that "adds up" to less than
 * its total, and the patient would owe money nobody can name. Every function
 * here either constructs the schedule or checks money against this rule.
 *
 * MONEY IS STRINGS (BM-style decimal, scale 4) at the boundary — the same
 * convention as the finance module's moneySchema. Arithmetic happens in
 * integer "points" (amount × 10^4) so 0.1 + 0.2 never becomes 0.30000004.
 */

export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly';

/** Days between instalments per frequency. */
export const FREQUENCY_DAYS: Record<PlanFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

const SCALE = 10_000;

/** Parse a boundary money string into integer points. Throws on garbage —
 * the zod schema has already validated the shape; this guard is for code
 * that bypasses it (internal callers passing numbers, say). */
export function toPoints(amount: string | number): number {
  const n = typeof amount === 'number' ? amount.toFixed(4) : amount;
  const m = /^(\d+)\.(\d{1,4})$/.exec(n) ?? /^(\d+)$/.exec(n);
  if (!m) throw new Error(`invalid money value: ${String(amount)}`);
  const whole = BigInt(m[1]!);
  const frac = m[2] ? BigInt(m[2].padEnd(4, '0')) : 0n;
  return Number(whole * BigInt(SCALE) + frac);
}

/** Points back to a canonical 4-decimal string. */
export function fromPoints(points: number): string {
  const neg = points < 0 ? '-' : '';
  const abs = BigInt(Math.abs(points));
  const whole = abs / BigInt(SCALE);
  const frac = (abs % BigInt(SCALE)).toString().padStart(4, '0');
  /* Trim trailing zeros — RM1,500.0000 reads as noise on a printed slip. */
  const fracTrimmed = frac.replace(/0+$/, '');
  return `${neg}${whole.toString()}${fracTrimmed ? '.' + fracTrimmed : ''}`;
}

export interface PlanInput {
  totalAmount: string;
  downPayment: string;
  installments: number;
  frequency: PlanFrequency;
  startDate: string; /* YYYY-MM-DD */
}

export interface GeneratedInstallment {
  installmentNo: number;
  amount: string;
  dueDate: string; /* YYYY-MM-DD */
}

/**
 * Generate the instalment schedule.
 *
 * The remainder after the down payment is split into N parts; the FIRST
 * instalment absorbs any rounding remainder so the sum is exact, and the
 * first instalment is never zero unless the remainder is (a RM0.0004
 * leftover becomes part of instalment #1, not a phantom RM0.0004 row).
 * First instalment is due ONE period after the start date — the start date
 * is when the patient commits (and pays the down payment), not when the
 * first instalment falls due.
 */
export function generateSchedule(input: PlanInput): GeneratedInstallment[] {
  const total = toPoints(input.totalAmount);
  const down = toPoints(input.downPayment);

  if (down > total) {
    throw new PlanError('down payment cannot exceed the total amount');
  }
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 60) {
    throw new PlanError('instalments must be 1–60');
  }

  const remainder = total - down;
  if (remainder === 0) {
    /* Fully paid up front — the "plan" is the down payment itself; an empty
     * schedule plus a completed plan is the honest representation. */
    return [];
  }

  const per = Math.floor(remainder / input.installments);
  const firstExtra = remainder - per * input.installments; /* 0..N-1 points */
  const stepDays = FREQUENCY_DAYS[input.frequency];
  if (!stepDays) throw new PlanError(`unknown frequency: ${input.frequency as string}`);

  const start = new Date(`${input.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new PlanError(`invalid start date: ${input.startDate}`);

  return Array.from({ length: input.installments }, (_, i) => {
    const due = new Date(start.getTime() + stepDays * (i + 1) * 86_400_000);
    const amount = per + (i === 0 ? firstExtra : 0);
    return {
      installmentNo: i + 1,
      amount: fromPoints(amount),
      dueDate: due.toISOString().slice(0, 10),
    };
  });
}

export interface InstallmentLike {
  installmentNo: number;
  amount: string;
  status: 'pending' | 'paid' | 'overdue' | 'waived';
  paidAmount?: string | null;
}

/** Balance still owed: every instalment that is not paid/waived, in points. */
export function outstandingBalance(schedule: readonly InstallmentLike[]): string {
  const owed = schedule
    .filter((s) => s.status === 'pending' || s.status === 'overdue')
    .reduce((sum, s) => sum + toPoints(s.amount), 0);
  return fromPoints(owed);
}

/** Next unpaid, non-waived instalment — the `next_due_date` source of truth.
 * Null when nothing is left to collect. */
export function nextDue(schedule: readonly InstallmentLike[]): GeneratedInstallment | null {
  const upcoming = schedule
    .filter((s) => s.status === 'pending' || s.status === 'overdue')
    .sort((a, b) => a.installmentNo - b.installmentNo);
  const first = upcoming[0];
  return first ? { installmentNo: first.installmentNo, amount: first.amount, dueDate: (first as { dueDate?: string }).dueDate ?? '' } : null;
}

/**
 * Refresh statuses against `today` (YYYY-MM-DD): pending instalments past
 * their due date become OVERDUE. Paid/waived are never touched — money and
 * forgiveness are facts about the past; lateness is the only thing that
 * changes with time.
 */
export function refreshOverdue<T extends InstallmentLike & { dueDate: string }>(
  schedule: readonly T[],
  today: string,
): T[] {
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return schedule.map((s) => {
    if (s.status !== 'pending') return s;
    const due = new Date(`${s.dueDate}T00:00:00Z`).getTime();
    return due < now ? { ...s, status: 'overdue' as const } : s;
  });
}

/** A plan is complete when nothing is pending or overdue (all paid/waived,
 * or the schedule is empty because it was paid up front). */
export function isPlanComplete(schedule: readonly InstallmentLike[]): boolean {
  return schedule.every((s) => s.status === 'paid' || s.status === 'waived');
}

/** Full money check at the boundary — the invariant, stated once. */
export function scheduleSumsToTotal(
  input: { totalAmount: string; downPayment: string },
  schedule: readonly { amount: string }[],
): boolean {
  const total = toPoints(input.totalAmount);
  const down = toPoints(input.downPayment);
  const sum = schedule.reduce((acc, s) => acc + toPoints(s.amount), 0);
  return down + sum === total;
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}
