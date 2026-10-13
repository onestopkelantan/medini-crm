import { describe, it, expect } from 'vitest';

import {
  generateSchedule, outstandingBalance, nextDue, refreshOverdue,
  isPlanComplete, scheduleSumsToTotal, toPoints, fromPoints, PlanError,
} from '@modules/finance/domain/payment-plan';

/**
 * P4 — the payment-plan arithmetic. The invariant under test everywhere:
 * down_payment + SUM(instalments) = total, EXACTLY, in integer points —
 * the classic float trap (0.1 + 0.2) must be impossible by construction.
 */

describe('money points — the boundary conversion', () => {
  it('parses and round-trips', () => {
    expect(toPoints('3500.0000')).toBe(35_000_000);
    expect(fromPoints(35_000_000)).toBe('3500');
    expect(toPoints('500.50')).toBe(5_005_000);
    expect(fromPoints(5_005_000)).toBe('500.5');
  });

  it('rejects garbage (the guard behind the zod schema)', () => {
    expect(() => toPoints('abc')).toThrow();
    expect(() => toPoints('-5')).toThrow();
    expect(() => toPoints('1.23456')).toThrow(); /* scale 4 max */
  });
});

describe('generateSchedule — the promise, split exactly', () => {
  it('the reference case: RM3,500 braces, RM500 down, 6 monthly', () => {
    const sched = generateSchedule({
      totalAmount: '3500', downPayment: '500', installments: 6,
      frequency: 'monthly', startDate: '2026-10-06',
    });
    expect(sched).toHaveLength(6);
    /* 3000 / 6 = exactly 500 per instalment. */
    sched.forEach((s) => expect(s.amount).toBe('500'));
    expect(sched[0]!.dueDate).toBe('2026-11-05'); /* 30 days after start */
    /* 6 × 30 = 180 days from 2026-10-06 lands on 2027-04-04 (calendar months
     * are not 30 equal days — the arithmetic is honest even when February is
     * not). The generator walks fixed 30-day periods, per its docstring. */
    expect(sched[5]!.dueDate).toBe('2027-04-04');
    expect(scheduleSumsToTotal({ totalAmount: '3500', downPayment: '500' }, sched)).toBe(true);
  });

  it('rounding remainder rides the FIRST instalment — sum stays exact', () => {
    /* 1000 over 3 → 333.3333 × 2 and the first absorbs the 0.0001 leftover. */
    const sched = generateSchedule({
      totalAmount: '1000', downPayment: '0', installments: 3,
      frequency: 'monthly', startDate: '2026-01-01',
    });
    expect(sched[0]!.amount).toBe('333.3334');
    expect(sched[1]!.amount).toBe('333.3333');
    expect(sched[2]!.amount).toBe('333.3333');
    expect(scheduleSumsToTotal({ totalAmount: '1000', downPayment: '0' }, sched)).toBe(true);
  });

  it('float trap is impossible: 100 over 3 instalments', () => {
    const sched = generateSchedule({
      totalAmount: '100', downPayment: '0', installments: 3,
      frequency: 'weekly', startDate: '2026-01-01',
    });
    expect(scheduleSumsToTotal({ totalAmount: '100', downPayment: '0' }, sched)).toBe(true);
    /* 33.3334 + 33.3333 + 33.3333 = 100 exactly — no 99.99999 anywhere. */
    expect(sched.map((s) => s.amount)).toEqual(['33.3334', '33.3333', '33.3333']);
  });

  it('paid fully up front → empty schedule (honest, not a phantom RM0 row)', () => {
    const sched = generateSchedule({
      totalAmount: '200', downPayment: '200', installments: 3,
      frequency: 'monthly', startDate: '2026-01-01',
    });
    expect(sched).toEqual([]);
  });

  it('weekly and biweekly step by 7 and 14 days', () => {
    const weekly = generateSchedule({ totalAmount: '300', downPayment: '0', installments: 2, frequency: 'weekly', startDate: '2026-01-05' });
    expect(weekly[0]!.dueDate).toBe('2026-01-12');
    expect(weekly[1]!.dueDate).toBe('2026-01-19');
    const bi = generateSchedule({ totalAmount: '300', downPayment: '0', installments: 2, frequency: 'biweekly', startDate: '2026-01-05' });
    expect(bi[0]!.dueDate).toBe('2026-01-19');
  });

  it('first instalment is due ONE period after start, never on start day', () => {
    const sched = generateSchedule({ totalAmount: '100', downPayment: '0', installments: 1, frequency: 'monthly', startDate: '2026-01-01' });
    expect(sched[0]!.dueDate).toBe('2026-01-31');
  });

  it('rejects down payment above total', () => {
    expect(() => generateSchedule({ totalAmount: '100', downPayment: '150', installments: 2, frequency: 'monthly', startDate: '2026-01-01' }))
      .toThrow(PlanError);
  });

  it('rejects instalment counts outside 1–60', () => {
    for (const bad of [0, -1, 61, 1.5]) {
      expect(() => generateSchedule({ totalAmount: '100', downPayment: '0', installments: bad, frequency: 'monthly', startDate: '2026-01-01' }))
        .toThrow(PlanError);
    }
  });
});

describe('outstandingBalance / nextDue — the counter\'s two questions', () => {
  const sched = [
    { installmentNo: 1, amount: '500', status: 'paid' as const, paidAmount: '500' },
    { installmentNo: 2, amount: '500', status: 'overdue' as const },
    { installmentNo: 3, amount: '500', status: 'pending' as const },
    { installmentNo: 4, amount: '500', status: 'waived' as const },
  ];

  it('balance counts pending + overdue, never paid/waived', () => {
    expect(outstandingBalance(sched)).toBe('1000');
  });

  it('next due is the lowest unpaid number', () => {
    expect(nextDue(sched)!.installmentNo).toBe(2);
  });

  it('nothing left → null and zero', () => {
    expect(nextDue([])).toBeNull();
    expect(outstandingBalance([])).toBe('0');
  });
});

describe('refreshOverdue — lateness is the only thing time changes', () => {
  const mk = (no: number, due: string, status: 'pending' | 'paid' | 'overdue' | 'waived' = 'pending') =>
    ({ installmentNo: no, amount: '100', dueDate: due, status });

  it('pending past due becomes overdue; future stays pending', () => {
    const refreshed = refreshOverdue([mk(1, '2026-09-01'), mk(2, '2026-12-01')], '2026-10-06');
    expect(refreshed[0]!.status).toBe('overdue');
    expect(refreshed[1]!.status).toBe('pending');
  });

  it('due TODAY is not overdue — strictly past', () => {
    const refreshed = refreshOverdue([mk(1, '2026-10-06')], '2026-10-06');
    expect(refreshed[0]!.status).toBe('pending');
  });

  it('paid and waived are never rewritten', () => {
    const refreshed = refreshOverdue([mk(1, '2026-01-01', 'paid'), mk(2, '2026-01-01', 'waived')], '2026-10-06');
    expect(refreshed[0]!.status).toBe('paid');
    expect(refreshed[1]!.status).toBe('waived');
  });
});

describe('isPlanComplete', () => {
  it('true when everything is paid or waived', () => {
    expect(isPlanComplete([{ installmentNo: 1, amount: '1', status: 'paid' }, { installmentNo: 2, amount: '1', status: 'waived' }])).toBe(true);
  });
  it('true for the empty (paid-up-front) schedule', () => {
    expect(isPlanComplete([])).toBe(true);
  });
  it('false while anything is pending or overdue', () => {
    expect(isPlanComplete([{ installmentNo: 1, amount: '1', status: 'overdue' }])).toBe(false);
  });
});
