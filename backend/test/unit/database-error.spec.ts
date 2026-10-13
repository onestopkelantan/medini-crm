import { describe, it, expect } from 'vitest';
import { toDomainError } from '@shared/errors/database-error';
import { ConflictError } from '@shared/errors/errors';

function wrapped(constraint?: string): unknown {
  return {
    message: 'Failed query: insert ...',
    cause: {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      sqlMessage: `Duplicate entry 'x' for key '${constraint ?? 'some_other_uq'}'`,
    },
  };
}

describe('toDomainError — structured MySQL error mapping', () => {
  it('maps patients_org_mrn_uq → 409 ConflictError "MRN already exists"', () => {
    const out = toDomainError(wrapped('patients_org_mrn_uq'));
    expect(out).toBeInstanceOf(ConflictError);
    expect((out as ConflictError).message).toBe('MRN already exists');
    expect((out as ConflictError).statusCode).toBe(409);
  });

  it('maps patients_org_ic_uq → 409 "IC already registered"', () => {
    const out = toDomainError(wrapped('patients_org_ic_uq'));
    expect((out as ConflictError).message).toBe('IC already registered');
  });

  it('maps appt_org_code_uq → 409 "Appointment code already exists"', () => {
    const out = toDomainError(wrapped('appt_org_code_uq'));
    expect((out as ConflictError).message).toBe('Appointment code already exists');
  });

  /* Sprint 2A T2 — payor constraint mappings */
  it('maps panel_companies_org_name_uq → 409 "Panel name already exists"', () => {
    const out = toDomainError(wrapped('panel_companies_org_name_uq'));
    expect(out).toBeInstanceOf(ConflictError);
    expect((out as ConflictError).message).toBe('Panel name already exists');
    expect((out as ConflictError).statusCode).toBe(409);
  });

  it('maps panel_companies_org_code_uq → 409 "Panel code already exists"', () => {
    const out = toDomainError(wrapped('panel_companies_org_code_uq'));
    expect((out as ConflictError).message).toBe('Panel code already exists');
  });

  it('maps insurance_companies_org_name_uq → 409 "Insurance name already exists"', () => {
    const out = toDomainError(wrapped('insurance_companies_org_name_uq'));
    expect(out).toBeInstanceOf(ConflictError);
    expect((out as ConflictError).message).toBe('Insurance name already exists');
  });

  it('maps insurance_companies_org_code_uq → 409 "Insurance code already exists"', () => {
    const out = toDomainError(wrapped('insurance_companies_org_code_uq'));
    expect((out as ConflictError).message).toBe('Insurance code already exists');
  });

  it('maps unknown unique violation → generic 409', () => {
    const out = toDomainError(wrapped('some_other_uq'));
    expect(out).toBeInstanceOf(ConflictError);
    expect((out as ConflictError).message).toBe('Duplicate record');
  });

  it('passes through non-unique errors unchanged', () => {
    const err = { message: 'foreign key', cause: { code: 'ER_NO_REFERENCED_ROW_2' } };
    expect(toDomainError(err)).toBe(err);
  });

  it('passes through errors without a cause', () => {
    const err = new Error('plain');
    expect(toDomainError(err)).toBe(err);
  });
});
