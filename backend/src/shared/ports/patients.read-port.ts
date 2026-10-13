import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, inArray, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';
import { patients, patientRelationships, appointments } from '../../infrastructure/database/schema';

/**
 * PatientsReadPort — sanctioned CROSS-MODULE read boundary for the patients
 * domain. Lives in shared (not in the patients module) so that other modules
 * can depend on it without violating module-infra boundaries. It operates on
 * a transaction passed by the caller (already inside runAs() so RLS applies).
 * It NEVER writes.
 */
@Injectable()
export class PatientsReadPort {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  private requireDb(): Database {
    if (!this.db) throw new Error('Database not configured');
    return this.db;
  }

  async getPatientById(tx: DbClient, orgId: string, id: string) {
    const rows = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.orgId, orgId), eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Sprint 6 (governance §6/§7) — ambiguity-safe patient lookup by phone.
   * READ-ONLY. Callers normalise the phone (whatsapp-lifecycle.normalizePhone)
   * and pass the exact digits string; matches against phone AND whatsapp
   * columns using the digits-suffix form stored in patient master data.
   * Returns MINIMAL fields (id, branchId, mrn, name) — never copies patient
   * data into WhatsApp tables. Multiple rows = ambiguity: the CALLER must not
   * auto-link. Org scope via RLS context; branch visibility by caller check.
   */
  async findByPhone(tx: DbClient, orgId: string, normalizedPhone: string) {
    const local = `0${normalizedPhone.slice(2)}`; /* 6012… → 012… */
    const intl = normalizedPhone.startsWith('0') ? `6${normalizedPhone}` : normalizedPhone;
    const rows = await tx
      .select({ id: patients.id, branchId: patients.branchId, mrn: patients.mrn, name: patients.name })
      .from(patients)
      .where(
        and(
          eq(patients.orgId, orgId),
          isNull(patients.deletedAt),
          sql`(
            REGEXP_REPLACE(COALESCE(${patients.phone}, ''), '\\D', '') IN (${intl}, ${local})
            OR REGEXP_REPLACE(COALESCE(${patients.whatsapp}, ''), '\\D', '') IN (${intl}, ${local})
          )`,
        ),
      )
      .limit(5);
    return rows;
  }

  async countPatients(tx: DbClient, orgId: string, branchId: string | null): Promise<number> {
    const conds = [
      eq(patients.orgId, orgId),
      isNull(patients.deletedAt),
    ];
    if (branchId) conds.push(eq(patients.branchId, branchId));
    const rows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(patients)
      .where(and(...conds));
    return rows[0]?.n ?? 0;
  }

  /** Doctor↔patient linkage via appointments (own-patients scope helper). */
  async doctorLinkedToPatient(
    tx: DbClient,
    orgId: string,
    doctorId: string,
    patientId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.doctorId, doctorId),
          eq(appointments.patientId, patientId),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Count relationships for a patient (dashboard context). */

  /* ---------------- FASA 1G (Dashboard) — pesakit baharu ---------------- */

  /**
   * Berapa pesakit BAHARU didaftarkan dalam tempoh ini.
   *
   * "Baharu" bermaksud rekod pesakit dicipta dalam tempoh tersebut — bukan
   * pesakit yang kali pertama datang. Klinik yang memasukkan pesakit lama
   * ke dalam sistem akan kelihatan mempunyai pesakit baharu yang banyak;
   * itu batasan yang diterima, dan lebih baik daripada tiada isyarat.
   */
  async countNewInPeriod(
    tx: DbClient, orgId: string, from: string, to: string, branchId?: string | null,
  ): Promise<number> {
    const cond: SQL[] = [
      eq(patients.orgId, orgId),
      isNull(patients.deletedAt),
      sql`${patients.createdAt} >= ${from + ' 00:00:00'}`,
      sql`${patients.createdAt} <= ${to + ' 23:59:59'}`,
    ];
    if (branchId) cond.push(eq(patients.branchId, branchId));
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(patients).where(and(...cond));
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Jumlah lawatan pesakit dalam tempoh — asas untuk nisbah baharu:lama.
   *
   * Dikira daripada temujanji yang BENAR-BENAR berlaku (selesai atau
   * no-show), bukan temujanji yang ditempah. Menggunakan temujanji yang
   * ditempah akan menjadikan penyebut lebih besar daripada realiti dan
   * nisbah pesakit baharu kelihatan lebih kecil daripada sebenarnya.
   */
  async countVisitsInPeriod(
    tx: DbClient, orgId: string, from: string, to: string, branchId?: string | null,
  ): Promise<number> {
    const cond: SQL[] = [
      eq(appointments.orgId, orgId),
      isNull(appointments.deletedAt),
      sql`${appointments.scheduledDate} >= ${from}`,
      sql`${appointments.scheduledDate} <= ${to}`,
      inArray(appointments.status, ['completed', 'no-show']),
    ];
    if (branchId) cond.push(eq(appointments.branchId, branchId));
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(appointments).where(and(...cond));
    return Number(rows[0]?.n ?? 0);
  }

  async countRelationships(tx: DbClient, orgId: string, patientId: string): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(patientRelationships)
      .where(eq(patientRelationships.patientId, patientId));
    return rows[0]?.n ?? 0;
  }
}
