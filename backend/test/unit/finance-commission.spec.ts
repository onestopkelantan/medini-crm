import { describe, it, expect } from 'vitest';
import {
  computeCommission, sumEligibleDirectCosts, isEligibleDirectCost,
  COMMISSION_CONFIG, nextPayoutDates,
} from '../../src/modules/finance/domain/commission-engine';

/**
 * Commission Engine — LOCKED formula (S4-T3, Master Prompt §6C).
 * Base = Gross Revenue − Eligible Direct Costs; Commission = Base × Rate.
 * Default rate 0.40, doctor-only beneficiary, eligible costs = Lab/X-Ray/Add-on.
 */
describe('Commission Engine (LOCKED formula)', () => {
  it('default rate is 0.40, basis Treatment Revenue, payout Twice Monthly 15/30', () => {
    expect(COMMISSION_CONFIG.RATE).toBe(0.40);
    expect(COMMISSION_CONFIG.BASIS).toBe('Treatment Revenue');
    expect(COMMISSION_CONFIG.PAYOUT).toBe('Twice Monthly');
    expect([...COMMISSION_CONFIG.PAYOUT_DATES]).toEqual([15, 30]);
  });

  it('computes base = gross − eligible, amount = base × 0.40', () => {
    const c = computeCommission(10000, 1500, 0.40);
    expect(c.commissionBase).toBe(8500);
    expect(c.commissionAmount).toBe(3400);
  });

  it('floors base at 0 when costs exceed revenue (never negative)', () => {
    const c = computeCommission(1000, 2000, 0.40);
    expect(c.commissionBase).toBe(0);
    expect(c.commissionAmount).toBe(0);
  });

  it('rejects rate outside 0..1', () => {
    expect(() => computeCommission(1000, 0, 1.5)).toThrow();
    expect(() => computeCommission(1000, 0, -0.1)).toThrow();
  });

  it('rejects negative revenue/costs', () => {
    expect(() => computeCommission(-100, 0)).toThrow();
    expect(() => computeCommission(100, -5)).toThrow();
  });

  it('sums ONLY eligible direct costs (Lab Cost, X-Ray, Add-on)', () => {
    const total = sumEligibleDirectCosts({
      'Lab Cost': 500,
      'X-Ray': 200,
      'Add-on': 100,
      'Utilities': 9999,   /* NOT eligible — excluded */
      'Payroll': 8888,     /* NOT eligible — excluded */
      'Rent': 7777,        /* NOT eligible — excluded */
    });
    expect(total).toBe(800);
  });

  it('excludes general business expenses from commission base', () => {
    expect(isEligibleDirectCost('Lab Cost')).toBe(true);
    expect(isEligibleDirectCost('X-Ray')).toBe(true);
    expect(isEligibleDirectCost('Add-on')).toBe(true);
    expect(isEligibleDirectCost('Utilities')).toBe(false);
    expect(isEligibleDirectCost('Rent')).toBe(false);
    expect(isEligibleDirectCost('Insurance')).toBe(false);
    expect(isEligibleDirectCost('Payroll')).toBe(false);
    expect(isEligibleDirectCost('Tax')).toBe(false);
    expect(isEligibleDirectCost('Maintenance')).toBe(false);
  });

  it('rounds to 4 dp (numeric(19,4) parity)', () => {
    const c = computeCommission(3333.3333, 111.1111, 0.40);
    expect(c.commissionBase).toBe(3222.2222);
    expect(c.commissionAmount).toBe(1288.8889);
  });

  it('nextPayoutDates returns 15th & 30th forward', () => {
    const from = new Date(2026, 7, 10); /* 10 Aug 2026 */
    const dates = nextPayoutDates(from, 2);
    expect(dates[0]!.getDate()).toBe(15);
    expect(dates[1]!.getDate()).toBe(30);
  });
});
