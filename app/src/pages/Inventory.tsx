/* Baris API P6 — medan yang dipakai UI sahaja. */
interface InvItem { id: string; sku: string; name: string; category?: string | null; unit: string; unitCost: string; supplier?: string | null; }
interface InvRestock { id: string; itemId: string; qty: string; unitCost: string; supplier?: string | null; restockDate?: string | null; }
interface InvBom { id: string; treatmentType: string; itemId: string; qtyPerCase: string; }
interface InvCount { id: string; itemId: string; isoWeek: string; qtyCounted: string; status: 'draft' | 'submitted' | 'approved' | 'rejected'; }
interface InvFlag { id: string; itemId: string; isoWeek: string; expectedQty: string; actualQty: string; varianceQty: string; variancePct: string; status: 'open' | 'investigating' | 'closed'; }
interface ComputeResult { week: string; computed: number; flagged: number; }

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { toast } from 'sonner';

import { api, errorMessage } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { usePrefs } from '../hooks/usePrefs';
import { useScope } from '../hooks/useScope';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table';

/**
 * P6 — Inventory per Invelli PRD, di dalam CRM.
 * Tab: Item (katalog A1), Restock (C3), BOM (A2), Kiraan Mingguan (B),
 * Variance (D — pengesanan kebocoran).
 */
type Tab = 'items' | 'restock' | 'bom' | 'counts' | 'variance';

const TABS: Array<{ key: Tab }> = [
  { key: 'items' },
  { key: 'restock' },
  { key: 'bom' },
  { key: 'counts' },
  { key: 'variance' },
];

export function Inventory() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('items');
  const isHQ = user?.role === 'hq';
  const isManager = user?.role === 'branch_manager';

  return (
    <div className="p-4 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" aria-hidden />
          {t('inv.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('inv.subtitle')}</p>
      </header>

      <div role="tablist" aria-label={t('inv.title')} className="flex gap-1 overflow-x-auto border-b mb-4 pb-px">
        {TABS.map(({ key }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg transition-colors ${
              tab === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`inv.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'items' && <ItemsTab isHQ={isHQ} />}
      {tab === 'restock' && <RestockTab />}
      {tab === 'bom' && <BomTab isHQ={isHQ} />}
      {tab === 'counts' && <CountsTab isHQ={isHQ} isManager={isManager} />}
      {tab === 'variance' && <VarianceTab isHQ={isHQ} />}
    </div>
  );
}

/* ---------- helper ---------- */
function useItems() {
  return useQuery({
    queryKey: ['inv-items'],
    queryFn: () => api.get<InvItem[]>('/inventory/items'),
  });
}

/* ---------------- Item (katalog, A1) ---------------- */
function ItemsTab({ isHQ }: { isHQ: boolean }) {
  const { t } = usePrefs();
  const { data: items, isLoading } = useItems();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'unit', unitCost: '', supplier: '' });
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.post('/inventory/items', {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        unit: form.unit,
        unitCost: Number(form.unitCost || 0),
        supplier: form.supplier || undefined,
      }),
    onSuccess: () => {
      toast.success(t('inv.saved'));
      setDialog(false);
      setForm({ sku: '', name: '', category: '', unit: 'unit', unitCost: '', supplier: '' });
      qc.invalidateQueries({ queryKey: ['inv-items'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  return (
    <section>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <p className="text-sm text-muted-foreground">{t('inv.items.desc')}</p>
        {isHQ && <Button onClick={() => setDialog(true)}>{t('inv.items.add')}</Button>}
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>{t('inv.items.name')}</TableHead>
              <TableHead>{t('inv.items.category')}</TableHead>
              <TableHead>{t('inv.items.unit')}</TableHead>
              <TableHead>{t('inv.items.unitCost')}</TableHead>
              <TableHead>{t('inv.items.supplier')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6">…</TableCell></TableRow>}
            {(items ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.category ? <Badge variant="outline">{r.category}</Badge> : '—'}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell>{r.unitCost}</TableCell>
                <TableCell>{r.supplier ?? '—'}</TableCell>
              </TableRow>
            ))}
            {!isLoading && (items ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">{t('inv.empty')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('inv.items.add')}</DialogTitle>
            <DialogDescription>{t('inv.items.addDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <Input placeholder={t('inv.items.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder={t('inv.items.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Input placeholder={t('inv.items.unit')} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <Input type="number" step="0.0001" placeholder={t('inv.items.unitCost')} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
            <Input placeholder={t('inv.items.supplier')} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </div>
          {/* Pasangan Batal/Simpan: satu butang "Save" bersendirian tidak
              memberi jalan keluar yang jelas selain X kecil di penjuru. */}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(false)}>{t('common.cancel')}</Button>
            <Button disabled={save.isPending || !form.sku || !form.name} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------------- Restock (C3) ---------------- */
function RestockTab() {
  const { t } = usePrefs();
  const scope = useScope();
  const { data: items } = useItems();
  const { data: restocks, isLoading } = useQuery({
    queryKey: ['inv-restocks'],
    queryFn: () => api.get<InvRestock[]>('/inventory/restocks'),
  });
  const [form, setForm] = useState({ itemId: '', qty: '', unitCost: '', supplier: '' });
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.post('/inventory/restocks', {
        branchId: scope.branchId,
        itemId: form.itemId,
        qty: Number(form.qty),
        unitCost: Number(form.unitCost || 0),
        supplier: form.supplier || undefined,
        restockDate: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      toast.success(t('inv.saved'));
      setForm({ itemId: '', qty: '', unitCost: '', supplier: '' });
      qc.invalidateQueries({ queryKey: ['inv-restocks'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  const itemName = (id: string) => (items ?? []).find((i: InvItem) => i.id === id)?.name ?? id.slice(0, 8);

  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">{t('inv.restock.desc')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t('inv.restock.pickItem')}
          value={form.itemId}
          onChange={(e) => setForm({ ...form, itemId: e.target.value })}
        >
          <option value="">{t('inv.restock.pickItem')}</option>
          {(items ?? []).map((i: InvItem) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
        </select>
        <Input type="number" placeholder={t('inv.restock.qty')} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <Input type="number" step="0.0001" placeholder={t('inv.restock.cost')} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
        <Input placeholder={t('inv.restock.supplier')} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
      </div>
      <Button disabled={save.isPending || !form.itemId || !form.qty} onClick={() => save.mutate()}>
        {t('inv.restock.add')}
      </Button>

      <div className="rounded-lg border overflow-x-auto mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inv.items.name')}</TableHead>
              <TableHead>{t('inv.restock.qty')}</TableHead>
              <TableHead>{t('inv.restock.cost')}</TableHead>
              <TableHead>{t('inv.restock.supplier')}</TableHead>
              <TableHead>{t('inv.restock.date')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6">…</TableCell></TableRow>}
            {(restocks ?? []).map((r: InvRestock) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{itemName(r.itemId)}</TableCell>
                <TableCell>{r.qty}</TableCell>
                <TableCell>{r.unitCost}</TableCell>
                <TableCell>{r.supplier ?? '—'}</TableCell>
                <TableCell>{r.restockDate?.slice(0, 10) ?? '—'}</TableCell>
              </TableRow>
            ))}
            {!isLoading && (restocks ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">{t('inv.empty')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/* ---------------- BOM (A2) ---------------- */
const TREATMENT_TYPES = ['Scaling', 'Extraction', 'Filling', 'RCT', 'Whitening', 'Braces', 'Implant'];

function BomTab({ isHQ }: { isHQ: boolean }) {
  const { t } = usePrefs();
  const { data: items } = useItems();
  const { data: boms, isLoading } = useQuery({
    queryKey: ['inv-bom'],
    queryFn: () => api.get<InvBom[]>('/inventory/bom'),
  });
  const [form, setForm] = useState({ treatmentType: '', itemId: '', qtyPerCase: '' });
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.post('/inventory/bom', {
        treatmentType: form.treatmentType,
        itemId: form.itemId,
        qtyPerCase: Number(form.qtyPerCase),
      }),
    onSuccess: () => {
      toast.success(t('inv.saved'));
      setForm({ treatmentType: '', itemId: '', qtyPerCase: '' });
      qc.invalidateQueries({ queryKey: ['inv-bom'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  const itemName = (id: string) => (items ?? []).find((i: InvItem) => i.id === id)?.name ?? id.slice(0, 8);

  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">{t('inv.bom.desc')}</p>
      {isHQ && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t('inv.bom.pickTreatment')}
              value={form.treatmentType}
              onChange={(e) => setForm({ ...form, treatmentType: e.target.value })}
            >
              <option value="">{t('inv.bom.pickTreatment')}</option>
              {TREATMENT_TYPES.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
            </select>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t('inv.bom.pickItem')}
              value={form.itemId}
              onChange={(e) => setForm({ ...form, itemId: e.target.value })}
            >
              <option value="">{t('inv.bom.pickItem')}</option>
              {(items ?? []).map((i: InvItem) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <Input type="number" step="0.0001" placeholder={t('inv.bom.qty')} value={form.qtyPerCase} onChange={(e) => setForm({ ...form, qtyPerCase: e.target.value })} />
          </div>
          <Button disabled={save.isPending || !form.treatmentType || !form.itemId || !form.qtyPerCase} onClick={() => save.mutate()}>
            {t('inv.bom.add')}
          </Button>
        </>
      )}

      <div className="rounded-lg border overflow-x-auto mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inv.bom.treatment')}</TableHead>
              <TableHead>{t('inv.items.name')}</TableHead>
              <TableHead>{t('inv.bom.qty')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={3} className="text-center py-6">…</TableCell></TableRow>}
            {(boms ?? []).map((r: InvBom) => (
              <TableRow key={r.id}>
                <TableCell><Badge variant="outline">{r.treatmentType}</Badge></TableCell>
                <TableCell className="font-medium">{itemName(r.itemId)}</TableCell>
                <TableCell>{r.qtyPerCase}</TableCell>
              </TableRow>
            ))}
            {!isLoading && (boms ?? []).length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">{t('inv.empty')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/* ---------------- Kiraan Mingguan (B) ---------------- */
function CountsTab({ isHQ, isManager }: { isHQ: boolean; isManager: boolean }) {
  const { t } = usePrefs();
  const { data: items } = useItems();
  const { data: counts, isLoading } = useQuery({
    queryKey: ['inv-counts'],
    queryFn: () => api.get<InvCount[]>('/inventory/counts'),
  });
  const [form, setForm] = useState({ itemId: '', qtyCounted: '' });
  const qc = useQueryClient();
  const canDecide = isHQ || isManager;

  const submit = useMutation({
    mutationFn: () =>
      api.post('/inventory/counts', {
        itemId: form.itemId,
        qtyCounted: Number(form.qtyCounted),
        submit: true,
      }),
    onSuccess: () => {
      toast.success(t('inv.counts.submitted'));
      setForm({ itemId: '', qtyCounted: '' });
      qc.invalidateQueries({ queryKey: ['inv-counts'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  const decide = useMutation({
    mutationFn: (v: { countId: string; decision: 'approved' | 'rejected' }) =>
      api.post('/inventory/counts/decision', v),
    onSuccess: () => {
      toast.success(t('inv.saved'));
      qc.invalidateQueries({ queryKey: ['inv-counts'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  const compute = useMutation({
    mutationFn: () => api.post<ComputeResult>('/inventory/compute-week', {}),
    onSuccess: (d: ComputeResult) => {
      toast.success(t('inv.counts.computed', { n: d?.computed ?? 0, f: d?.flagged ?? 0 }));
      qc.invalidateQueries({ queryKey: ['inv-counts'] });
      qc.invalidateQueries({ queryKey: ['inv-flags'] });
    },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });

  const itemName = (id: string) => (items ?? []).find((i: InvItem) => i.id === id)?.name ?? id.slice(0, 8);

  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">{t('inv.counts.desc')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t('inv.bom.pickItem')}
          value={form.itemId}
          onChange={(e) => setForm({ ...form, itemId: e.target.value })}
        >
          <option value="">{t('inv.bom.pickItem')}</option>
          {(items ?? []).map((i: InvItem) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <Input type="number" placeholder={t('inv.counts.qtyCounted')} value={form.qtyCounted} onChange={(e) => setForm({ ...form, qtyCounted: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button disabled={submit.isPending || !form.itemId || !form.qtyCounted} onClick={() => submit.mutate()}>
          {t('inv.counts.submit')}
        </Button>
        {isHQ && (
          <Button variant="outline" disabled={compute.isPending} onClick={() => compute.mutate()}>
            {t('inv.counts.compute')}
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inv.items.name')}</TableHead>
              <TableHead>{t('inv.counts.week')}</TableHead>
              <TableHead>{t('inv.counts.qtyCounted')}</TableHead>
              <TableHead>{t('inv.counts.status')}</TableHead>
              {canDecide && <TableHead className="text-right">{t('inv.counts.decide')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6">…</TableCell></TableRow>}
            {(counts ?? []).map((c: InvCount) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{itemName(c.itemId)}</TableCell>
                <TableCell className="font-mono text-xs">{c.isoWeek}</TableCell>
                <TableCell>{c.qtyCounted}</TableCell>
                <TableCell>
                  <Badge variant={c.status === 'approved' ? 'default' : c.status === 'rejected' ? 'destructive' : 'secondary'}>
                    {c.status}
                  </Badge>
                </TableCell>
                {canDecide && (
                  <TableCell className="text-right">
                    {c.status === 'submitted' && (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" aria-label={t('inv.counts.approve')} disabled={decide.isPending}
                          onClick={() => decide.mutate({ countId: c.id, decision: 'approved' })}>✓</Button>
                        <Button size="sm" variant="outline" aria-label={t('inv.counts.reject')} disabled={decide.isPending}
                          onClick={() => decide.mutate({ countId: c.id, decision: 'rejected' })}>✗</Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && (counts ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">{t('inv.empty')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/* ---------------- Variance / kebocoran (D) ---------------- */
function VarianceTab({ isHQ }: { isHQ: boolean }) {
  const { t } = usePrefs();
  const { data: flags, isLoading } = useQuery({
    queryKey: ['inv-flags'],
    queryFn: () => api.get<InvFlag[]>('/inventory/flags'),
  });

  const openCount = (flags ?? []).filter((f) => f.status === 'open').length;

  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">{t('inv.variance.desc')}</p>
      {openCount > 0 && (
        <div role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 px-4 py-3 text-sm">
          {t('inv.variance.banner', { n: openCount })}
        </div>
      )}
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inv.variance.item')}</TableHead>
              <TableHead>{t('inv.counts.week')}</TableHead>
              <TableHead>{t('inv.variance.expected')}</TableHead>
              <TableHead>{t('inv.variance.actual')}</TableHead>
              <TableHead>Δ</TableHead>
              <TableHead>{t('inv.variance.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6">…</TableCell></TableRow>}
            {(flags ?? []).map((f: InvFlag) => (
              <TableRow key={f.id}>
                <TableCell className="font-mono text-xs">{f.itemId.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">{f.isoWeek}</TableCell>
                <TableCell>{f.expectedQty}</TableCell>
                <TableCell>{f.actualQty}</TableCell>
                <TableCell className={Number(f.varianceQty) > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-green-600 dark:text-green-400 font-medium'}>
                  {Number(f.varianceQty) > 0 ? '+' : ''}{f.varianceQty} ({Number(f.variancePct) > 0 ? '+' : ''}{Number(f.variancePct).toFixed(1)}%)
                </TableCell>
                <TableCell>
                  <Badge variant={f.status === 'open' ? 'destructive' : 'secondary'}>{f.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (flags ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">{t('inv.variance.none')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {isHQ && (flags ?? []).some((f) => f.status === 'open') && (
        <p className="text-xs text-muted-foreground mt-2">{t('inv.variance.hint')}</p>
      )}
    </section>
  );
}

export default Inventory;
