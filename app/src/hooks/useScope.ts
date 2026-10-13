/* ============================================================================
 * useScope() — pembungkus skop untuk semua tulisan klinikal.
 *
 * MASALAH YANG DIBETULKAN
 *
 * Guard kebenaran backend (`permission.guard.ts`) bersifat FAIL-CLOSED untuk skop
 * `own`: ia mengisi `doctorId` dari token HANYA untuk tindakan `view`:
 *
 *     if (required.action === 'view' && principal.role === 'doctor' && target.doctorId == null) {
 *       target.doctorId = principal.doctorId;
 *     }
 *
 * Untuk `create` / `edit`, `doctorId` mesti DIHANTAR dalam body. Kalau tidak, guard
 * menilai skop tanpa sasaran dan menolak permintaan — dengan pesanan ralat yang
 * menyalahkan PERANAN ("You do not have permission to perform this action"), bukan
 * medan yang hilang. Doktor yang sah pun nampak seolah-olah tiada hak.
 *
 * Ini telah menyebabkan EMPAT bug berasingan:
 *   1D  TreatmentPlanPanel   — pelan rawatan tidak boleh disimpan
 *   1E  ConsentPanel         — kebenaran tidak boleh direkod
 *   1G  batalkan borang      — borang tidak boleh dibatalkan
 *   bahagian ini  — preskripsi / kesan buruk / rujukan / SOAP / tandatangan / pindaan
 *
 * Setiap kali, gejala kelihatan seperti masalah RBAC dan setiap kali puncanya sama:
 * medan skop tertinggal. Helper ini wujud supaya ia tidak boleh tertinggal lagi —
 * satu tempat, satu bentuk, dipakai oleh setiap permintaan bertulis.
 *
 * NOTA: ini menyelesaikan halaman, bukan punca di backend. Guard masih memerlukan
 * medan itu dihantar. Menukar guard ialah keputusan tadbir urus RBAC yang perlu
 * persetujuan Bos — bukan sesuatu yang boleh diubah sendiri di sini.
 * ========================================================================== */
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";

export interface ScopeBody {
  /** Cawangan yang menjadi konteks tulisan ini. */
  branchId?: string | null;
  /** Doktor pemilik rekod. Wajib untuk skop `own` pada create/edit. */
  doctorId?: string | null;
}

export function useScope(): ScopeBody {
  const { user } = useAuth();
  const { branchId } = useBranch();
  return { branchId: branchId ?? user?.branchId, doctorId: user?.doctorId };
}

/**
 * Cantumkan skop ke dalam body permintaan. Medan yang sudah ada dalam `body`
 * tidak ditimpa — pemanggil kekal boleh menetapkan sasaran secara eksplisit
 * (contoh: HQ menulis bagi pihak cawangan tertentu).
 */
export function withScope<T extends Record<string, unknown>>(scope: ScopeBody, body: T) {
  return { ...scope, ...body };
}
