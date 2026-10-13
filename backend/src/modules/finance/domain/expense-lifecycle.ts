/**
 * Expense status state machine (Sprint 4 S4-T2).
 * Operational expense lifecycle (CRM-owned, NOT accounting journal):
 *   draft → pending_approval → approved → paid
 *   draft|pending_approval → cancelled
 *   pending_approval → rejected
 *   approved|paid|rejected|cancelled are terminal-ish (paid/cancelled terminal).
 * Same-state = valid no-op (Medini convention — no mutation/audit).
 *
 * Pure & deterministic. No payment processing — CRM records only.
 */
export const EXPENSE_STATUSES = [
  'draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled',
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export function isExpenseStatus(value: string): value is ExpenseStatus {
  return (EXPENSE_STATUSES as readonly string[]).includes(value);
}

const ALLOWED: Record<ExpenseStatus, readonly ExpenseStatus[]> = {
  draft:            ['draft', 'pending_approval', 'cancelled'],
  pending_approval: ['pending_approval', 'approved', 'rejected', 'cancelled'],
  approved:         ['approved', 'paid', 'cancelled'],
  paid:             ['paid'],
  rejected:         ['rejected'],
  cancelled:        ['cancelled'],
};

/** True when the transition from → to is legal. */
export function canTransitionExpense(from: string, to: string): boolean {
  if (!isExpenseStatus(from) || !isExpenseStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/** Finance expense categories (from CURRENT-MEDINI-REVIEW.html FIN_CFG/FINCONF). */
export const EXPENSE_CATEGORIES = [
  'Utilities', 'Payroll', 'Doctor Commission', 'Insurance', 'Taxes & Government',
  'Premises', 'Maintenance', 'Supplies', 'Professional Services', 'Lab Fees', 'Operations',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
