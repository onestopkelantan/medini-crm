/**
 * AssistantController — Option B: percakapan natural + menu aksi TERTUTUP.
 *
 * LAPISAN (urutan dinilai, fail-closed):
 *   1. AKSI eksplisit (assistant-actions.ts) → FUNGSI SEDIA ADA yang sudah
 *      policy-gated. Menu ditulis dalam KOD — model tidak boleh menambah
 *      keupayaan, mengubah kod, atau menilai SQL.
 *   2. SAPAAN/smalltalk → MiniMax menjawab semula jadi (persona staf klinik).
 *   3. Selebihnya → router agen berdaftar sedia ada.
 *
 * Prinsip pemilik: asisten MENJALANKAN fungsi, TIDAK PERNAH mengubah kod.
 */
import { Body, Controller, Post, Req } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { AnalystService } from '../application/analyst.service';
import { AiManagerService } from '../application/ai-manager.service';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { InventoryService } from '../../inventory/application/inventory.service';
import { routeAssistant } from '../domain/assistant-router';
import { matchAssistantAction } from '../domain/assistant-actions';

const askSchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();

const GREETING_SYSTEM = [
  'Anda ialah "Pembantu AI" Klinik Pergigian Medini — rakan kerja staf di aplikasi CRM.',
  'Bahasa: ikut bahasa pengguna (Melayu/Indonesia/Inggeris). Ringkas, mesra, semula jadi.',
  'Anda asisten SERBA-BOLEH secara percakapan: boleh berbual, menjelaskan apa yang',
  'anda boleh buat, dan membantu pengguna faham sistem. TIGA had yang WAJIB anda pegang:',
  '1) JANGAN karang sebarang NOMBOR (angka klinik hanya dari soalan data yang betul,',
  '   contoh: "berapa kutipan bulan lepas").',
  '2) TINDAKAN hanya dari senarai tetap: "imbas kutipan" (imbasan kutipan Finance AI),',
  '   "jeda agen" / "aktifkan semula agen", "semak baris kelulusan". Kalau pengguna minta',
  '   tindakan lain, terangkan apa yang tersedia dan bagaimana melakukannya di aplikasi',
  '   (contoh: tempah appointment dibuat di halaman Temujanji, atau pesakit WhatsApp',
  '   ditempah oleh Nur di Hab WhatsApp).',
  '3) Anda TIDAK boleh mengubah kod sistem atau mengubah data secara terus.',
  'Akhiri balasan mesra yang menawarkan bantuan seterusnya bila sesuai.',
].join(' ');

/* LAPIS 2 — ASISTEN FLEKSIBLE (arah pemilik 8 Okt: "AI Assistantnya buat
 * fleksibel... tanya jawab aja" jangan dinding 'diluar scope').
 *
 * Pendekatan terbalik dari sebelumnya: PERBUALAN BEBAS ialah DEFAULT.
 * Kita tidak cuba meneka semua teks bebas (senarai regex tidak akan
 * habis); sebaliknya kita kenal pasti SOALAN DATA KLINIK dengan tepat.
 * Mesej yang mengandungi kosakata data klinik (hasil/kutipan/pesakit/
 * temujanji/no-show/rawatan/doktor/hutang dsb.) pergi ke analyst agar
 * jawapannya BERASAS (angka sebenar, sumber dipetik) — keperluan hard
 * rule model (jangan karang nombor). SEMUA yang lain berbual dengan
 * model natural: sapaan, soalan umum, cuti-cuti, apa khabar, apa pun.
 * Dinding kemampuan hanya wujud untuk soalan data yang analyst sendiri
 * tidak kenali — itu kejujuran yang betul, bukan tembok untuk semua. */
export function isDataQuestion(text: string): boolean {
  const t = text.toLowerCase();
  /* Kosakata data klinik (BM/EN) — dipadankan sebagai perkataan penuh. */
  if (/\b(hasil|kutipan|revenue|jualan|sales|untung|pendapatan|perbelanjaan|expense|kos|margin|pesakit|patient|temujanji|appointment|booking|no[-\s]?show|hadir|kehadiran|rawatan|treatment|scaling|extraction|filling|rct|whitening|braces|implant|doktor|doctor|produksi|branch|cawangan|hutang|piutang|tertunggak|overdue|debt|baki|balance|bil|invoice|komisen|commission|makmal|lab|statistik|trend|laporan|report|kira|count|jumlah|total|purata|average|minggu|bulan|tahun|week|month|year|stok|inventori|inventory)\b/.test(t)) {
    return true;
  }
  return false;
}

/* Sentiasa balik dengan gaya semula jadi bila isDataQuestion false. */
export function isConversational(text: string): boolean {
  return !isDataQuestion(text);
}

@Controller({ path: 'ai/assistant', version: '1' })
export class AssistantController {
  constructor(
    private readonly analyst: AnalystService,
    private readonly aiManager: AiManagerService,
    private readonly minimax: MinimaxAdapter,
    private readonly inventory: InventoryService,
  ) {}

  @Post('ask')
  @RequirePermission('ai', 'view')
  async ask(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError({ message: ['Mesej tidak sah'] });
    }
    const message = parsed.data.message;
    const principal = req.principal!;
    const isHq = principal.role === 'hq';

    /* ---- LAPIS 1: aksi eksplisit → fungsi sedia ada (menu tertutup) ---- */
    const action = matchAssistantAction(message);
    if (action) {
      switch (action.id) {
        case 'finance.scan_collections': {
          const answer = await this.analyst.financeCollections(principal);
          return { ...answer, agent: 'finance-ai', action: action.id };
        }
        case 'queue.peek': {
          const rows = await this.aiManager.listApprovalRequests(principal, { status: 'pending' });
          const list = Array.isArray(rows) ? rows : (rows as { requests?: unknown[] }).requests ?? [];
          const n = list.length;
          return {
            reply: n > 0
              ? `Ada ${n} tindakan menunggu kelulusan di baris kelulusan AI Manager. Semak dan putuskan di sana.`
              : 'Baris kelulusan kosong — tiada tindakan menunggu.',
            sources: [], agent: 'ai-manager', action: action.id,
          };
        }
        case 'agents.pause':
        case 'agents.enable': {
          if (!isHq) {
            throw new ForbiddenError('Hanya HQ boleh mengawal status agen');
          }
          /* Agen sasaran: Nur / AI Receptionist (padanan nama boleh
           * diperluas nanti). */
          const agents = await this.aiManager.listAgents(principal);
          const target = (agents as Array<{ id: string; key: string; status: string }>)
            .find((a) => a.key === 'ai-receptionist');
          if (!target) return {
            reply: 'Agen receptionist tidak ditemui dalam senarai. Semak AI Manager → Agen.',
            sources: [], agent: 'ai-manager', action: action.id,
          };
          const command = action.id === 'agents.pause' ? 'pause' as const : 'enable' as const;
          const updated = await this.aiManager.transitionAgent(principal, target.id, command);
          const status = (updated as { status?: string }).status ?? '?';
          return {
            reply: action.id === 'agents.pause'
              ? `Agen Nur (AI Receptionist) kini ${status}. Balasan WhatsApp dihentikan sementara — aktifkan semula bila perlu.`
              : `Agen Nur (AI Receptionist) kini ${status} dan sedia membalas WhatsApp.`,
            sources: [], agent: 'ai-manager', action: action.id,
          };
        }
      }
    }

    /* ---- LAPIS 2: perbualan bebas → model natural (bukan dinding) ---- */
    if (isConversational(message)) {
      const reply = await this.minimax.chat(GREETING_SYSTEM, message);
      return { reply, sources: [], agent: 'assistant' };
    }

    /* ---- LAPIS 2.5: INVENTORI (stok/inventori) — pemilik 10 Okt:
          "bukannya AI nya harusnya bisa akses segala yg di aplikasi ini?"
          Modul Inventory (P6/P8) kini mempunyai pintu di Assistant.
          Baca: senarai item + bendera varians terkini (semua peranan,
          scope ikut peranan). Tambah item katalog: HQ sahaja. ---- */
    if (/\b(stok|stoks|inventori|inventory|variance|varians|bendera)\b/i.test(message)) {
      /* (a) permintaan TAMBAH item: "tambah/tambahkan [SKU] ..." — HQ sahaja */
      if (/\b(tambah(kan)?|add|daftar(kan)?|create)\b/i.test(message) && !/\b(berapa|baki|senarai|list|flag|bendera)\b/i.test(message)) {
        if (!isHq) {
          return {
            reply: 'Katalog item inventori diurus oleh HQ. ' +
              'Minta HQ tambah item itu di Inventori → Item, atau hantar butirannya (SKU, nama, unit, kos) kepada HQ.',
            sources: [], agent: 'inventory-ai',
          };
        }
        return {
          reply: 'Boleh! Buka halaman Inventori → tab Item → butang Tambah Item. ' +
            'Isi SKU, nama item, unit (cth. box/botol), kos seunit, dan pembekal. ' +
            'Item terus masuk katalog dan boleh dipakai dalam kiraan mingguan. ' +
            '(Tambah item melalui chat belum dibuka — setiap tulis katalog direkod dengan nama HQ di jejak audit.)',
          sources: [], agent: 'inventory-ai',
        };
      }
      /* (b) soalan DATA stok: senarai item + bendera varians — nyata, bukan karangan model */
      const items = await this.inventory.listItems(principal);
      const flags = await this.inventory.listFlags(principal);
      /* Bendera hanya simpan itemId — petakan ke nama item katalog. */
      const itemNameById = new Map((items as Array<{ id: string; name: string; sku: string }>)
        .map((i) => [i.id, `${i.name} (${i.sku})`]));
      const flagLines = (flags as Array<{ itemId: string; variancePct: string | number; isoWeek: string }>)
        .slice(0, 8)
        .map((f) => `• ${itemNameById.get(f.itemId) ?? f.itemId}: varians ${Number(f.variancePct).toFixed(1)}% (minggu ${f.isoWeek})`);
      const reply =
        `Katalog inventori ada ${items.length} item. ` +
        ((flags as unknown[]).length > 0
          ? `Bendera varians terkini (melebihi 5% dari asas rawatan):\n${flagLines.join('\n')}`
          : 'Tiada bendera varians buat masa ini — penggunaan dalam batas asas rawatan.') +
        (isHq ? ' Kira semula varians: Inventori → Kiraan Mingguan → Kira Varians.' : ' Semak kiraan mingguan di Inventori → Kiraan Mingguan.');
      return { reply, sources: [{ key: 'inventory', period: 'live' }], agent: 'inventory-ai' };
    }

    /* ---- LAPIS 3: router agen berdaftar (tingkah laku lama) ---- */
    const route = routeAssistant(message);
    if (route.agent === 'insights-ai') {
      /* The grounded analyst, unchanged — sources badge and all. */
      const answer = await this.analyst.ask(principal, message);
      return { ...answer, agent: 'insights-ai' };
    }

    if (route.agent === 'ai-receptionist') {
      /* Honest pointer, not impersonation: Nur works on WhatsApp, and a
       * staff chat pretending to be her would be a lie with her name on
       * it. The reply names where her work shows up. */
      return {
        reply:
          'Soalan booking WhatsApp di bawah portfolio AI Receptionist (Nur). ' +
          'Nur bekerja terus di WhatsApp pesakit — rekod perbualan dan tempahannya ' +
          'boleh dilihat di Hab WhatsApp → Perbualan, dan Rekod Tempahan AI. ' +
          'Untuk soalan data klinik (revenue, rawatan, pesakit, temujanji), tanya saya di sini.',
        sources: [],
        agent: 'ai-receptionist',
      };
    }

    /* finance-ai — collections. The scan is the SAME one the Balances
     * tab's Imbas Kutipan runs (policy-gated, HQ-only in the service);
     * the reply reports what it did, honestly, with numbers. */
    const answer = await this.analyst.financeCollections(principal);
    return { ...answer, agent: 'finance-ai' };
  }
}
