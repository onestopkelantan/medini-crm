import { describe, it, expect } from 'vitest';

import { matchAssistantAction, isGreeting } from '../../src/modules/ai-manager/domain/assistant-actions';

/**
 * Option B boundary tests: the assistant may trigger ONLY the listed actions,
 * matched by explicit phrases — never by vibes. Greetings route to the model
 * for a natural reply instead of the old capability-wall.
 */
describe('isGreeting — sapaan ke model natural', () => {
  it('mengenali sapaan tunggal', () => {
    for (const g of ['Hi', 'hi!', 'Hai', 'halo', 'Hello', 'Salam', 'pagi', 'Selamat pagi', 'assalamualaikum']) {
      expect(isGreeting(g), g).toBe(true);
    }
  });

  it('bukan sapaan: soalan sebenar (tetap ke router/agen)', () => {
    for (const q of ['berapa kutipan bulan lepas', 'imbas kutipan', 'Hai, berapa revenue?', 'tolong jeda agent']) {
      expect(isGreeting(q), q).toBe(false);
    }
  });
});

describe('matchAssistantAction — menu aksi tertutup', () => {
  it('imbas kutipan (BM + EN)', () => {
    expect(matchAssistantAction('imbas kutipan')!.id).toBe('finance.scan_collections');
    expect(matchAssistantAction('tolong imbas tertunggak')!.id).toBe('finance.scan_collections');
    expect(matchAssistantAction('scan collections')!.id).toBe('finance.scan_collections');
  });

  it('jeda / aktif agen', () => {
    expect(matchAssistantAction('jeda agen nur')!.id).toBe('agents.pause');
    expect(matchAssistantAction('pause agent')!.id).toBe('agents.pause');
    expect(matchAssistantAction('aktifkan semula agent')!.id).toBe('agents.enable');
    expect(matchAssistantAction('activate receptionist')!.id).toBe('agents.enable');
  });

  it('intip antrean', () => {
    expect(matchAssistantAction('semak baris kelulusan')!.id).toBe('queue.peek');
    expect(matchAssistantAction('approval queue')!.id).toBe('queue.peek');
  });

  it('AYAKAN/PERINTAH BAHARU TIDAK dikenali — menu tertutup, tiada tebakan', () => {
    /* Ini janji pemilik: asisten TIDAK boleh mengubah kod atau mencipta
     * keupayaan. Ayakan di luar senarai jatuh ke laluan semula jadi
     * (router → analyst/kata kunci), bukan menjadi aksi. */
    expect(matchAssistantAction('padam semua pesakit')).toBeNull();
    expect(matchAssistantAction('ubah harga rawatan jadi RM0')).toBeNull();
    expect(matchAssistantAction('hantar blast whatsapp sekarang')).toBeNull();
    expect(matchAssistantAction('create table test')).toBeNull();
    expect(matchAssistantAction('kirim wa ke semua pesakit')).toBeNull();
  });
});
