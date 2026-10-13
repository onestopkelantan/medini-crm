import { describe, it, expect } from 'vitest';

import { routeAssistant } from '@modules/ai-manager/domain/assistant-router';

/**
 * A2 — the assistant routes to REGISTERED agents; it never answers on
 * their behalf. Collections → finance-ai; booking help → an honest
 * pointer to the receptionist's portfolio; everything else → the
 * grounded analyst (whose own fallback handles the rest).
 */

describe('routeAssistant', () => {
  it('collections questions go to finance-ai', () => {
    for (const q of [
      'siapa pesakit tertunggak?',
      'kutipan tertunggak bulan ni',
      'overdue installments report',
      'hutang pesakit berapa?',
    ]) {
      expect(routeAssistant(q).agent).toBe('finance-ai');
    }
  });

  it('revenue vocabulary alone is NOT collections (analyst keeps it)', () => {
    for (const q of [
      'berapa jualan bulan ini?',
      'revenue this month vs last month',
      'jumlah kutipan 30 hari',
    ]) {
      expect(routeAssistant(q).agent).toBe('insights-ai');
    }
  });

  it('booking help points at the receptionist portfolio, not the analyst', () => {
    expect(routeAssistant('macam mana nak buat booking via whatsapp?').agent).toBe('ai-receptionist');
    expect(routeAssistant('nur tak reply pesakit').agent).toBe('ai-receptionist');
    /* REGRESI (laporan pemilik 8 Okt): ayat EN 'assign an appointment'
     * pernah jatuh ke dinding kemampuan analyst. */
    expect(routeAssistant('can you assign an appointment?').agent).toBe('ai-receptionist');
    expect(routeAssistant('can you assign an apointment?').agent).toBe('ai-receptionist');
    expect(routeAssistant('boleh tolong tempah appointment?').agent).toBe('ai-receptionist');
    expect(routeAssistant('schedule an appointment for tomorrow').agent).toBe('ai-receptionist');
  });

  it('booking + data together stays analytical (data wins)', () => {
    expect(routeAssistant('booking trend dan revenue bulan ini').agent).toBe('insights-ai');
  });

  it('unmatched text falls through to the analyst (its honest fallback)', () => {
    expect(routeAssistant('apa khabar').agent).toBe('insights-ai');
  });
});
