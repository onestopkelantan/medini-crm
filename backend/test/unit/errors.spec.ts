import { describe, it, expect } from 'vitest';
import { AppError, DomainError, NotFoundError, ValidationError } from '@shared/errors/errors';

describe('error model', () => {
  it('AppError carries code/status/fieldErrors', () => {
    const e = new AppError('X', 'boom', 500, { f: ['bad'] });
    expect(e.code).toBe('X');
    expect(e.statusCode).toBe(500);
    expect(e.fieldErrors).toEqual({ f: ['bad'] });
    expect(e.expose).toBe(false);
  });

  it('DomainError is client-safe (expose=true)', () => {
    const e = new DomainError('D', 'business rule', 400);
    expect(e.expose).toBe(true);
    expect(e.statusCode).toBe(400);
  });

  it('NotFoundError → 404', () => {
    const e = new NotFoundError('Patient', 'MDN-1');
    expect(e.statusCode).toBe(404);
    expect(e.message).toContain('MDN-1');
  });

  it('ValidationError → 422 with fieldErrors', () => {
    const e = new ValidationError({ name: ['required'] });
    expect(e.statusCode).toBe(422);
    expect(e.fieldErrors?.name).toEqual(['required']);
  });
});
