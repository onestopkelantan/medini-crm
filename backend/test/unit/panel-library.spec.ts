import { describe, it, expect } from 'vitest';
import { BUILTIN_PANEL_LIBRARY, findBuiltinPanel } from '@modules/payors/domain/panel-library';

describe('built-in panel library (Sprint 2A T3)', () => {
  it('contains exactly the 5 required entries', () => {
    expect(BUILTIN_PANEL_LIBRARY).toHaveLength(5);
    expect(BUILTIN_PANEL_LIBRARY.map((p) => p.name)).toEqual([
      'HealthMetrics', 'MediDent', 'MedKad', 'MiCare', 'TuneProtect',
    ]);
  });

  it('every entry has a stable unique key and a complete address', () => {
    const keys = BUILTIN_PANEL_LIBRARY.map((p) => p.key);
    expect(new Set(keys).size).toBe(5);
    expect(keys).toEqual(['healthmetrics', 'medident', 'medkad', 'micare', 'tuneprotect']);
    for (const p of BUILTIN_PANEL_LIBRARY) {
      expect(p.address.length).toBeGreaterThan(20);
    }
  });

  it('addresses match the locked library data', () => {
    expect(findBuiltinPanel('healthmetrics')?.address).toContain('The Place @ ONE City');
    expect(findBuiltinPanel('medident')?.address).toContain('Wisma Cosway');
    expect(findBuiltinPanel('medkad')?.address).toContain('Laman Seri Business Park');
    expect(findBuiltinPanel('micare')?.address).toContain('Bukit Jelutong');
    expect(findBuiltinPanel('tuneprotect')?.address).toContain('Wisma Tune');
  });

  it('unknown key returns undefined (service maps to 422)', () => {
    expect(findBuiltinPanel('aia')).toBeUndefined();
    expect(findBuiltinPanel('')).toBeUndefined();
  });
});
