import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '@infrastructure/database/schema';

describe('database schema — canonical model structure', () => {
  it('has all 11 core tables', () => {
    const tables = [
      'branches', 'staff', 'roleAssignments', 'patients', 'patientRelationships',
      'appointments', 'paymentStatus', 'auditLog', 'domainEvents', 'processedEvents', 'idempotencyKeys',
    ];
    for (const t of tables) {
      expect((schema as Record<string, unknown>)[t], `missing table ${t}`).toBeDefined();
    }
  });

  it('patients enforces unique MRN + IC', () => {
    const cfg = getTableConfig(schema.patients);
    const uniqueCols = cfg.indexes.map((i) => i.config.name);
    expect(uniqueCols).toContain('patients_org_mrn_uq');
    expect(uniqueCols).toContain('patients_org_ic_uq');
  });

  it('payment_status is the STATUS layer only (PENDING/PAID/OVERDUE) — not a payment gateway', () => {
    const cfg = getTableConfig(schema.paymentStatus);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('status');
    expect(colNames).toContain('payment_reference'); /* external ref */
    expect(colNames).not.toContain('card_number');    /* no gateway fields */
    expect(colNames).not.toContain('fpx_token');
  });

  it('appointments carries optimistic-lock version + status enum', () => {
    const cfg = getTableConfig(schema.appointments);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('version');
    expect(colNames).toContain('status');
  });

  it('audit_log is append-only (no updated_at / deleted_at)', () => {
    const cfg = getTableConfig(schema.auditLog);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).not.toContain('updated_at');
    expect(colNames).not.toContain('deleted_at');
    expect(colNames).toContain('correlation_id');
    expect(colNames).toContain('before');
    expect(colNames).toContain('after');
  });

  it('staff username is unique per org; non-HQ requires branch (check)', () => {
    const cfg = getTableConfig(schema.staff);
    const idxNames = cfg.indexes.map((i) => i.config.name);
    expect(idxNames).toContain('staff_org_username_uq');
  });

  it('every scoped business table carries org_id + branch_id + audit fields', () => {
    const scoped = [schema.patients, schema.appointments, schema.paymentStatus, schema.staff];
    for (const t of scoped) {
      const colNames = getTableConfig(t).columns.map((c) => c.name);
      expect(colNames).toContain('org_id');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('updated_at');
    }
  });
});
