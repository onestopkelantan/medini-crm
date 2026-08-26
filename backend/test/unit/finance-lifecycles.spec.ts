import { describe, it, expect } from 'vitest';
import {
  canTransitionLabPayable, labPayableStatusForAmounts, labPayableOutstanding,
} from '../../src/modules/finance/domain/lab-payable-lifecycle';
import { canTransitionExpense, isExpenseCategory } from '../../src/modules/finance/domain/expense-lifecycle';
import { canTransitionRecurring, advanceNextDue } from '../../src/modules/finance/domain/recurring-lifecycle';
import { canTransitionCommission } from '../../src/modules/finance/domain/commission-status';
import { agingBucketFor, daysOverdue, AGING_BUCKETS } from '../../src/modules/finance/domain/aging';
import { severityForDaysUntilDue, daysUntilDue, ALERT_THRESHOLDS } from '../../src/modules/finance/domain/radar-rules';

describe('Lab payable lifecycle (overpayment blocked)', () => {
  it('locked lifecycle DRAFT→OUTSTANDING→PARTIALLY_PAID→PAID|VOID', () => {
    expect(canTransitionLabPayable('DRAFT', 'OUTSTANDING')).toBe(true);
    expect(canTransitionLabPayable('OUTSTANDING', 'PARTIALLY_PAID')).toBe(true);
    expect(canTransitionLabPayable('PARTIALLY_PAID', 'PAID')).toBe(true);
    expect(canTransitionLabPayable('OUTSTANDING', 'VOID')).toBe(true);
    expect(canTransitionLabPayable('PAID', 'VOID')).toBe(false);
    expect(canTransitionLabPayable('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionLabPayable('VOID', 'OUTSTANDING')).toBe(false);
  });

  it('same-state is a valid no-op', () => {
    expect(canTransitionLabPayable('OUTSTANDING', 'OUTSTANDING')).toBe(true);
  });

  it('derives status from amounts; blocks overpayment', () => {
    expect(labPayableStatusForAmounts(1000, 0)).toBe('OUTSTANDING');
    expect(labPayableStatusForAmounts(1000, 400)).toBe('PARTIALLY_PAID');
    expect(labPayableStatusForAmounts(1000, 1000)).toBe('PAID');
    expect(() => labPayableStatusForAmounts(1000, 1001)).toThrow('overpayment');
  });

  it('outstanding = amount − paid; never negative', () => {
    expect(labPayableOutstanding(1000, 250)).toBe(750);
    expect(() => labPayableOutstanding(100, 200)).toThrow();
  });
});

describe('Expense lifecycle + categories', () => {
  it('lifecycle draft→pending_approval→approved→paid; rejected/cancelled', () => {
    expect(canTransitionExpense('draft', 'pending_approval')).toBe(true);
    expect(canTransitionExpense('pending_approval', 'approved')).toBe(true);
    expect(canTransitionExpense('approved', 'paid')).toBe(true);
    expect(canTransitionExpense('pending_approval', 'rejected')).toBe(true);
    expect(canTransitionExpense('paid', 'draft')).toBe(false);
    expect(canTransitionExpense('draft', 'paid')).toBe(false);
  });

  it('HTML finance categories are recognised', () => {
    ['Utilities', 'Payroll', 'Doctor Commission', 'Insurance', 'Taxes & Government',
      'Premises', 'Maintenance', 'Supplies', 'Professional Services', 'Lab Fees', 'Operations',
    ].forEach((c) => expect(isExpenseCategory(c)).toBe(true));
    expect(isExpenseCategory('Invoice')).toBe(false);
  });
});

describe('Recurring lifecycle + advance', () => {
  it('active↔paused, →cancelled; cancelled terminal', () => {
    expect(canTransitionRecurring('active', 'paused')).toBe(true);
    expect(canTransitionRecurring('paused', 'active')).toBe(true);
    expect(canTransitionRecurring('active', 'cancelled')).toBe(true);
    expect(canTransitionRecurring('cancelled', 'active')).toBe(false);
  });

  it('advances next due by frequency', () => {
    const base = new Date(2026, 7, 15);
    expect(advanceNextDue(base, 'Weekly').getDate()).toBe(22);
    expect(advanceNextDue(base, 'Monthly').getMonth()).toBe(8); /* Sep */
    expect(advanceNextDue(base, 'Yearly').getFullYear()).toBe(2027);
    expect(advanceNextDue(base, 'Custom').getTime()).toBe(base.getTime());
  });
});

describe('Commission status lifecycle', () => {
  it('calculated→pending_review→approved→scheduled→paid; cancelled', () => {
    expect(canTransitionCommission('calculated', 'pending_review')).toBe(true);
    expect(canTransitionCommission('pending_review', 'approved')).toBe(true);
    expect(canTransitionCommission('approved', 'scheduled')).toBe(true);
    expect(canTransitionCommission('scheduled', 'paid')).toBe(true);
    expect(canTransitionCommission('paid', 'approved')).toBe(false);
    expect(canTransitionCommission('cancelled', 'paid')).toBe(false);
  });
});

describe('Aging buckets (HTML authoritative)', () => {
  it('buckets: Current / 1–30 / 31–60 / 61–90 / 90+', () => {
    expect([...AGING_BUCKETS]).toEqual(['Current', '1-30', '31-60', '61-90', '90+']);
  });

  it('classifies by days overdue', () => {
    const today = new Date(2026, 7, 16);
    const daysAgo = (n: number) => new Date(2026, 7, 16 - n);
    expect(agingBucketFor(daysAgo(-5), today)).toBe('Current');  /* future due */
    expect(agingBucketFor(daysAgo(0), today)).toBe('Current');   /* due today */
    expect(agingBucketFor(daysAgo(15), today)).toBe('1-30');
    expect(agingBucketFor(daysAgo(45), today)).toBe('31-60');
    expect(agingBucketFor(daysAgo(75), today)).toBe('61-90');
    expect(agingBucketFor(daysAgo(120), today)).toBe('90+');
    expect(daysOverdue(daysAgo(10), today)).toBe(10);
  });
});

describe('Radar rules (alert thresholds)', () => {
  it('thresholds dueSoon=7, critical=1, escalation=7', () => {
    expect(ALERT_THRESHOLDS).toEqual({ dueSoon: 7, critical: 1, escalation: 7 });
  });

  it('severity by days until due', () => {
    expect(severityForDaysUntilDue(-3)).toBe('critical');  /* overdue */
    expect(severityForDaysUntilDue(1)).toBe('critical');   /* due within critical */
    expect(severityForDaysUntilDue(5)).toBe('high');       /* due soon */
    expect(severityForDaysUntilDue(30)).toBe('medium');    /* outside window */
  });

  it('daysUntilDue negative when overdue', () => {
    const today = new Date(2026, 7, 16);
    expect(daysUntilDue(new Date(2026, 7, 13), today)).toBe(-3);
    expect(daysUntilDue(new Date(2026, 7, 20), today)).toBe(4);
  });
});
