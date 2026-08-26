/**
 * Lab payable lifecycle state machine (Sprint 4 S4-T3).
 * Locked lifecycle (Blueprint §311, Master Prompt §6B):
 *   DRAFT → OUTSTANDING → PARTIALLY_PAID → PAID
 *   DRAFT|OUTSTANDING|PARTIALLY_PAID → VOID (terminal)
 *   PAID is terminal. VOID is terminal.
 * Same-state = valid no-op.
 *
 * Overpayment is BLOCKED at the DB layer (paid_amount <= amount) and re-asserted
 * in the service. Operational cost tracking, NOT a full accounting payable ledger.
 * Pure & deterministic.
 */
export const LAB_PAYABLE_STATUSES = [
  'DRAFT', 'OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'VOID',
] as const;
export type LabPayableStatus = (typeof LAB_PAYABLE_STATUSES)[number];

export function isLabPayableStatus(value: string): value is LabPayableStatus {
  return (LAB_PAYABLE_STATUSES as readonly string[]).includes(value);
}

const ALLOWED: Record<LabPayableStatus, readonly LabPayableStatus[]> = {
  DRAFT:           ['DRAFT', 'OUTSTANDING', 'VOID'],
  OUTSTANDING:     ['OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'VOID'],
  PARTIALLY_PAID:  ['PARTIALLY_PAID', 'PAID', 'VOID'],
  PAID:            ['PAID'],
  VOID:            ['VOID'],
};

/** True when the transition from → to is legal. */
export function canTransitionLabPayable(from: string, to: string): boolean {
  if (!isLabPayableStatus(from) || !isLabPayableStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/**
 * Derive the payable status from amounts after a payment is applied.
 * outstanding = amount - paid; PAID when fully settled; PARTIALLY_PAID when 0<paid<amount.
 * Throws (overpayment) when paid exceeds amount — defense-in-depth on top of the
 * DB check constraint (which is the final guard).
 */
export function labPayableStatusForAmounts(amount: number, paid: number): LabPayableStatus {
  if (paid < 0) throw new Error('paid_amount cannot be negative');
  if (paid > amount) throw new Error('overpayment blocked: paid_amount exceeds amount');
  if (paid === 0) return 'OUTSTANDING';
  if (paid < amount) return 'PARTIALLY_PAID';
  return 'PAID';
}

/** outstanding = amount - paid (never negative; guarded). */
export function labPayableOutstanding(amount: number, paid: number): number {
  const out = amount - paid;
  if (out < 0) throw new Error('overpayment blocked: outstanding would be negative');
  return out;
}
