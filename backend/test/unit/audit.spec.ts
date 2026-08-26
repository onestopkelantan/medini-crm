import { describe, it, expect } from 'vitest';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';

describe('audit foundation', () => {
  it('records an immutable audit event with correlation + timestamp', async () => {
    const adapter = new InMemoryAuditAdapter();
    const svc = new AuditService(adapter);
    const evt = await svc.record({
      actorId: 'u1', actorRole: 'hq', action: 'config_updated', entity: 'settings',
      entityId: 'cfg-1', branchId: null, before: { on: false }, after: { on: true },
    });
    expect(adapter.events).toHaveLength(1);
    expect(evt.actorRole).toBe('hq');
    expect(evt.orgId).toBe('medini-dental-group');
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evt.correlationId).toBeTruthy();
    expect(evt.before).toEqual({ on: false });
    expect(evt.after).toEqual({ on: true });
  });
});
