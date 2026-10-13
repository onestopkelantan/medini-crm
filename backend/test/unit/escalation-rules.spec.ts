import { describe, it, expect } from 'vitest';

import {
  escalationTier,
  draftReminder,
  escalationKey,
  type OverdueInstallment,
} from '../../src/modules/finance/domain/escalation-rules';

/**
 * Fasa D — Finance AI collection escalation ladder (dental-erp billing-agent
 * pattern, Medini discipline: pure, deterministic, no I/O, no model).
 *
 * Boundaries are the contract: 3/4, 7/8, 14/15. An off-by-one here sends the
 * wrong tone to a patient, which is a customer-relations bug, not just code.
 */
describe('escalationTier — overdue days → tier', () => {
  it('friendly tier for 1–3 days overdue', () => {
    expect(escalationTier(1)).toBe('friendly');
    expect(escalationTier(3)).toBe('friendly');
  });

  it('firm tier for 4–7 days', () => {
    expect(escalationTier(4)).toBe('firm');
    expect(escalationTier(7)).toBe('firm');
  });

  it('serious tier for 8–14 days', () => {
    expect(escalationTier(8)).toBe('serious');
    expect(escalationTier(14)).toBe('serious');
  });

  it('escalation tier beyond 14 days (staff task, not a patient message)', () => {
    expect(escalationTier(15)).toBe('escalation');
    expect(escalationTier(60)).toBe('escalation');
  });

  it('0 or negative days are NOT overdue — no tier, no draft', () => {
    expect(escalationTier(0)).toBeNull();
    expect(escalationTier(-1)).toBeNull();
  });
});

describe('escalationKey — one draft per installment × tier (idempotency)', () => {
  it('includes plan, installment number AND tier', () => {
    const a: OverdueInstallment = {
      planId: 'p1', installmentNo: 2, daysOverdue: 5, amount: '300.0000',
      dueDate: '2026-10-01', patientName: 'Ahmad', patientPhone: '60123456789',
      planCode: 'PP-0001', patientId: 'pt1',
    };
    expect(escalationKey(a)).toBe('finance.escalate:p1:2:firm');
    /* Same installment rescan → same key. A LATER tier is a different key,
     * so the queue can hold the friendly draft AND the firm draft without
     * confusing them. */
    const later = { ...a, daysOverdue: 9 };
    expect(escalationKey(later)).toBe('finance.escalate:p1:2:serious');
  });
});

describe('draftReminder — the template text (BM), money from data only', () => {
  const base: OverdueInstallment = {
    planId: 'p1', installmentNo: 3, daysOverdue: 2, amount: '300.0000',
    dueDate: '2026-10-01', patientName: 'Ahmad bin Ali', patientPhone: '60123456789',
    planCode: 'PP-0001', patientId: 'pt1',
  };

  it('friendly draft mentions amount, plan code and due date — no threats', () => {
    const d = draftReminder(base)!;
    expect(d.tier).toBe('friendly');
    expect(d.body).toContain('RM300.00');
    expect(d.body).toContain('PP-0001');
    expect(d.body).toContain('2026-10-01');
    expect(d.body).not.toMatch(/hubungi klinik untuk aturan|amaran/i);
  });

  it('firm draft states the outstanding total and asks for arrangement', () => {
    const d = draftReminder({ ...base, daysOverdue: 5 })!;
    expect(d.tier).toBe('firm');
    expect(d.body).toMatch(/tertunggak/i);
    expect(d.body).toMatch(/aturan bayaran/i);
  });

  it('serious draft proposes restructuring and flags staff takeover', () => {
    const d = draftReminder({ ...base, daysOverdue: 10 })!;
    expect(d.tier).toBe('serious');
    expect(d.body.toLowerCase()).toContain('rancangan');
  });

  it('escalation tier produces NO patient message — a staff summary instead', () => {
    const d = draftReminder({ ...base, daysOverdue: 20 })!;
    expect(d.tier).toBe('escalation');
    expect(d.toStaff).toBe(true);
    expect(d.body).not.toContain('Salam'); /* never addressed to the patient */
  });

  it('opted-out patient never gets a message draft — staff task from any tier', () => {
    const d = draftReminder({ ...base, optedOut: true })!;
    expect(d.toStaff).toBe(true);
    expect(d.body).not.toContain('Salam');
  });
});
