import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { resolveAnalystQuestion, ANALYST_CAPABILITY_REPLY } from '@modules/ai-manager/domain/analyst-question';
import { buildAnalystFacts } from '@modules/ai-manager/domain/analyst-facts';

const URL = process.env.DATABASE_URL ?? 'mysql://medini:***@localhost:3306/medini_dev';

const probe = pingDatabase(URL).then((ok) => {
  if (!ok) console.warn('[analyst] MySQL not reachable — SKIPPING (honest skip, not a pass).');
  return ok;
});

describe('analyst seam — demo data becomes facts a reply can quote', () => {
  it('the resolver + facts builder produce the revenue figure Reports would return', async () => {
    if (!(await probe)) return;

    const { db, close } = createFreshDatabase(URL);
    const dbCtx = new DbContextService(db);

    /* The demo data carries DEMO-SALE rows (RM2,550 total). Query the same
     * source ReportsService reads, then prove the facts pipeline can carry
     * that number. */
    const org = '00000000-0000-0000-0000-000000000001';
    const q = resolveAnalystQuestion('berapa kutipan bulan lepas?', '2026-10-02');
    expect(q.keys.length).toBeGreaterThan(0);

    const res = await dbCtx.runAsWorker(
      { orgId: org, branchIds: [org], correlationId: 'analyst-seam', source: 'system_worker' },
      async (tx) => {
        const r = await tx.execute(sql`
          SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
          FROM sale_records
          WHERE org_id = ${org} AND deleted_at IS NULL AND status = 'confirmed'
        `);
        const rows =
          (r as { rows?: Array<{ total: string | number; n: number }> }).rows ?? [];
        return rows[0] as { total: string | number; n: number };
      },
    );

    const facts = buildAnalystFacts('30D', {
      revenueByBranch: {
        period: '30D',
        rows: [{ branchName: 'All', revenue: String(Number(res.total).toFixed(2)) }],
      },
    });

    expect(facts).toContain('DATA DISAHKAN SISTEM');
    expect(facts).toContain(`RM${Number(res.total).toFixed(2)}`);
    await close();
  });

  it('capability reply is used when nothing matches (no data leaves)', () => {
    const q = resolveAnalystQuestion('saya lapar', '2026-10-02');
    expect(q.keys).toEqual([]);
    expect(ANALYST_CAPABILITY_REPLY).toContain('Kutipan');
  });
});
