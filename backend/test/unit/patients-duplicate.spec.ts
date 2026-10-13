import { describe, it, expect } from 'vitest';
import { findDuplicates } from '@modules/patients/domain/duplicate';

const existing = [
  { id: 'p1', name: 'Ahmad', ic: '800101-14-1234', phone: '123456789' },
  { id: 'p2', name: 'Siti', ic: '900202-08-5678', phone: '987654321' },
];

describe('findDuplicates', () => {
  it('flags exact IC match', () => {
    const out = findDuplicates({ ic: '800101-14-1234', existing });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ patientId: 'p1', reason: 'ic' });
  });

  it('flags phone match for own contact', () => {
    const out = findDuplicates({ phone: '123456789', contactType: 'own', existing });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ patientId: 'p1', reason: 'phone' });
  });

  it('does NOT flag shared phone for family-linked (guardian) contacts', () => {
    const out = findDuplicates({ phone: '123456789', contactType: 'guardian', existing });
    expect(out).toHaveLength(0);
  });

  it('returns nothing when nothing matches', () => {
    const out = findDuplicates({ ic: '111111-11-1111', phone: '555555555', existing });
    expect(out).toHaveLength(0);
  });
});
