import { describe, it, expect } from 'vitest';
import {
  DOMAIN_REGISTRY, CANONICAL_DOMAIN_IDS, DATA_OWNERSHIP, CROSS_DOMAIN_EVENTS,
  ROLE_DOMAIN_MATRIX, CANONICAL_ROLE_KEYS, can,
  PAYMENT_STATUS_VALUES, CANONICAL_BRANCH_COUNT, MEDINI_ARCHITECTURE,
} from '@shared/architecture/architecture.contract';

describe('MEDINI_ARCHITECTURE contract — presence & internal consistency', () => {
  it('has exactly 13 canonical domains', () => {
    expect(DOMAIN_REGISTRY).toHaveLength(13);
    expect(CANONICAL_DOMAIN_IDS).toHaveLength(13);
  });

  it('domain ids match the locked canonical set', () => {
    expect([...CANONICAL_DOMAIN_IDS].sort()).toEqual([
      'admin', 'ai', 'appointments', 'clinical', 'dashboard', 'documents',
      'finance', 'marketing', 'operations', 'patients', 'reports', 'settings', 'whatsapp',
    ].sort());
  });

  it('reports + dashboard are read-only', () => {
    const byId = Object.fromEntries(DOMAIN_REGISTRY.map((d) => [d.id, d]));
    expect(byId.reports?.readOnly).toBe(true);
    expect(byId.dashboard?.readOnly).toBe(true);
    expect(byId.reports?.owner).toBe('READ_ONLY');
  });

  it('DATA_OWNERSHIP owners reference real domains (or READ_ONLY)', () => {
    const ids = new Set([...CANONICAL_DOMAIN_IDS, 'READ_ONLY']);
    for (const owner of Object.values(DATA_OWNERSHIP)) {
      expect(ids.has(owner)).toBe(true);
    }
  });

  it('has exactly 4 canonical roles + receptionist alias', () => {
    expect(CANONICAL_ROLE_KEYS).toEqual(['hq', 'branch_manager', 'branch_admin', 'doctor']);
    expect(ROLE_DOMAIN_MATRIX.receptionist).toBe(ROLE_DOMAIN_MATRIX.branch_admin);
  });

  it('every role covers all 13 domains', () => {
    for (const role of CANONICAL_ROLE_KEYS) {
      const cells = ROLE_DOMAIN_MATRIX[role];
      expect(cells).toBeDefined();
      for (const d of CANONICAL_DOMAIN_IDS) {
        expect(cells?.[d]).toBeDefined();
      }
    }
  });

  it('payment status model is exactly PENDING/PAID/OVERDUE', () => {
    expect([...PAYMENT_STATUS_VALUES].sort()).toEqual(['OVERDUE', 'PAID', 'PENDING'].sort());
  });

  it('cross-domain events reference valid domains + have a producer', () => {
    const ids = new Set(CANONICAL_DOMAIN_IDS);
    for (const evt of Object.values(CROSS_DOMAIN_EVENTS)) {
      expect(ids.has(evt.source)).toBe(true);
      expect(evt.targets.length).toBeGreaterThan(0);
      for (const t of evt.targets) expect(ids.has(t)).toBe(true);
    }
  });

  it('canonical branch count is 14', () => {
    expect(CANONICAL_BRANCH_COUNT).toBe(14);
  });

  it('aggregate export mirrors window.MEDINI_ARCHITECTURE shape', () => {
    expect(MEDINI_ARCHITECTURE.DOMAIN_REGISTRY).toBe(DOMAIN_REGISTRY);
    expect(MEDINI_ARCHITECTURE.ROLE_DOMAIN_MATRIX).toBe(ROLE_DOMAIN_MATRIX);
    expect(MEDINI_ARCHITECTURE.DATA_OWNERSHIP).toBe(DATA_OWNERSHIP);
    expect(MEDINI_ARCHITECTURE.CROSS_DOMAIN_EVENTS).toBe(CROSS_DOMAIN_EVENTS);
    expect(MEDINI_ARCHITECTURE.PERMISSION_MATRIX.can).toBe(can);
  });
});
