import { describe, it, expect } from 'vitest';

import { formatSlotContext } from '@modules/ai-manager/domain/slot-context';
import type { FreeSlot } from '@modules/ai-manager/domain/slot-finder';

const slot = (over: Partial<FreeSlot>): FreeSlot => ({
  date: '2026-10-03',
  startMin: 630,
  time: '10:30',
  label: '10:30 pagi',
  doctorId: 'doc-1',
  doctorName: 'Dr. Aina Rahman',
  sameDoctor: true,
  ...over,
});

describe('formatSlotContext — facts for the AI prompt', () => {
  it('formats up to 2 slots as bullet facts in the findAlternatives line shape', () => {
    const out = formatSlotContext([
      slot({}),
      slot({ time: '11:00', startMin: 660, label: '11:00 pagi' }),
    ]);
    expect(out).toContain('SLOT KOSONG (disahkan sistem');
    expect(out).toContain('• 2026-10-03 10:30 pagi — Dr. Aina Rahman');
    expect(out).toContain('• 2026-10-03 11:00 pagi — Dr. Aina Rahman');
  });

  it('empty list yields the honest "no slots" fact, never silence', () => {
    const out = formatSlotContext([]);
    expect(out).toContain('SLOT KOSONG: tiada');
    expect(out).toContain('JANGAN mereka masa');
  });

  it('one slot formats identically (no plural assumptions)', () => {
    const out = formatSlotContext([slot({})]);
    expect(out).toContain('• 2026-10-03 10:30 pagi — Dr. Aina Rahman');
  });
});
