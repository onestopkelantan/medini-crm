import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';

/**
 * assertClinicalWriter — siapa boleh MENULIS rekod klinikal (owner direction
 * 8 Okt 2026: HQ serba-boleh).
 *
 * DUA jalan sah:
 *  1. DOCTOR menulis sendiri — doctorId + branchId dari principal (seperti sedia).
 *  2. HQ menulis ATAS NAMA seorang doktor — HQ memilih doktor itu secara
 *     eksplisit (`doctorId` dalam body). HQ tiada identiti doktor sendiri
 *     (doctor_ref NULL), jadi tiada laluan "tulis sebagai tiada siapa":
 *     doctorId mesti merujuk baris staff doctor sebenar — dipanggil memeriksa
 *     selepas helper ini oleh servis (resolve dari body).
 *
 * branchId doktor diambil dari pesakit (servis sudah buat begitu), jadi
 * helper ini hanya mengesahkan JENIS pelakunya, bukan skop.
 *
 * Branch manager dan branch_admin TETAP ditolak — arahan pemilik menambah
 * kuasa HQ sahaja, bukan melonggarkan peranan lain.
 */
export function assertClinicalWriter(
  p: Principal,
): asserts p is Principal {
  if (p.role !== 'doctor' && p.role !== 'hq') {
    throw new ForbiddenError('Hanya doktor atau HQ boleh menulis rekod klinikal');
  }
}

/** True bila pelaku ialah doktor (identiti doctorId sendiri tersedia). */
export function isActingDoctor(p: Principal): p is Principal & { doctorId: string; branchId: string } {
  return p.role === 'doctor' && !!p.doctorId && !!p.branchId;
}
