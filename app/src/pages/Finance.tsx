import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { PageHeader, StatCard, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rm, fmtDate } from "@/lib/format";
import { TrendingUp, Receipt, AlertCircle, Plus, CreditCard, Repeat, FlaskConical, Percent, Trophy } from "lucide-react";
import { toast } from "sonner";

interface Revenue { total?: number; amount?: number }
interface Sale { id: string; amount?: number; status?: string; saleDate?: string; saleCode?: string }
interface Expense { id: string; category?: string; payee?: string; amount?: number; expenseDate?: string; status?: string }
interface Recurring { id: string; payee?: string; amount?: number; status?: string; frequency?: string }
interface TreatmentCost { id: string; treatmentName?: string; cost?: number }
interface TopTreatment { id: string; name?: string; treatmentName?: string; count?: number; revenue?: number }
interface LabPayable { id: string; labVendor?: string; amount?: number; status?: string; dueDate?: string }
interface Commission { id: string; doctorId?: string; amount?: number; status?: string; period?: string }
interface Alert { id: string; message?: string; severity?: string }

const EXPENSE_CATEGORIES = ["rent", "utilities", "salaries", "supplies", "lab", "marketing", "equipment", "maintenance", "other"];

function NewExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ category: "supplies", payee: "", amount: "", expenseDate: new Date().toISOString().slice(0, 10), notes: "" });
  const create = useMutation({
    mutationFn: () => api.post<Expense>("/finance/expenses", {
      branchId, category: form.category, payee: form.payee,
      amount: Number(form.amount), expenseDate: form.expenseDate, notes: form.notes || null,
    }),
    onSuccess: () => { toast.success("Expense recorded"); qc.invalidateQueries({ queryKey: ["finance"] }); onClose(); setForm({ category: "supplies", payee: "", amount: "", expenseDate: new Date().toISOString().slice(0, 10), notes: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to record expense")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Expense</DialogTitle><DialogDescription>Log a branch operational expense.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Category *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Payee *</Label><Input required value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Amount (RM) *</Label><Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Date *</Label><Input required type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Record Expense"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Finance() {
  const revenue = useQuery({ queryKey: ["finance", "revenue"], queryFn: () => api.get<Revenue>("/finance/revenue") });
  const sales = useQuery({ queryKey: ["finance", "sales"], queryFn: () => api.get<Sale[]>("/finance/sales") });
  const expenses = useQuery({ queryKey: ["finance", "expenses"], queryFn: () => api.get<Expense[]>("/finance/expenses") });
  const recurring = useQuery({ queryKey: ["finance", "recurring"], queryFn: () => api.get<Recurring[]>("/finance/recurring") });
  const alerts = useQuery({ queryKey: ["finance", "alerts"], queryFn: () => api.get<Alert[]>("/finance/alerts") });
  const treatmentCosts = useQuery({ queryKey: ["finance", "treatment-costs"], queryFn: () => api.get<TreatmentCost[]>("/finance/treatment-costs") });
  const topTreatments = useQuery({ queryKey: ["finance", "top-treatments"], queryFn: () => api.get<TopTreatment[]>("/finance/top-treatments") });
  const labPayables = useQuery({ queryKey: ["finance", "lab-payables"], queryFn: () => api.get<LabPayable[]>("/finance/lab-payables") });
  const commissions = useQuery({ queryKey: ["finance", "commissions"], queryFn: () => api.get<Commission[]>("/finance/commissions") });

  const [showExpense, setShowExpense] = useState(false);

  const totalRevenue = revenue.data?.total ?? revenue.data?.amount ?? 0;
  const salesRows = sales.data ?? [];
  const totalExpenses = (expenses.data ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Finance"
        description="Revenue, sales, expenses, recurring, treatment costs, lab payables and commissions (status-layer only)"
        actions={<Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowExpense(true)}><Plus className="h-4 w-4 mr-1.5" /> Record Expense</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Total Revenue" value={rm(totalRevenue, 0)} icon={<TrendingUp className="h-4 w-4" />} loading={revenue.isLoading} />
        <StatCard title="Sales Records" value={salesRows.length} icon={<Receipt className="h-4 w-4" />} loading={sales.isLoading} />
        <StatCard title="Total Expenses" value={rm(totalExpenses, 0)} icon={<CreditCard className="h-4 w-4" />} loading={expenses.isLoading} />
        <StatCard title="Active Alerts" value={(alerts.data ?? []).length} icon={<AlertCircle className="h-4 w-4" />} loading={alerts.isLoading} />
      </div>

      <Tabs defaultValue="sales">
        <TabsList className="bg-white border">
          <TabsTrigger value="sales"><Receipt className="h-3.5 w-3.5 mr-1.5" />Sales</TabsTrigger>
          <TabsTrigger value="expenses"><CreditCard className="h-3.5 w-3.5 mr-1.5" />Expenses</TabsTrigger>
          <TabsTrigger value="recurring"><Repeat className="h-3.5 w-3.5 mr-1.5" />Recurring</TabsTrigger>
          <TabsTrigger value="treatments"><Trophy className="h-3.5 w-3.5 mr-1.5" />Treatments</TabsTrigger>
          <TabsTrigger value="lab"><FlaskConical className="h-3.5 w-3.5 mr-1.5" />Lab Payables</TabsTrigger>
          <TabsTrigger value="commissions"><Percent className="h-3.5 w-3.5 mr-1.5" />Commissions</TabsTrigger>
          <TabsTrigger value="alerts"><AlertCircle className="h-3.5 w-3.5 mr-1.5" />Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <Panel title="Recent Sales">
            {sales.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {salesRows.slice(0, 25).map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-700">{s.saleCode ?? "Sale"}</p>
                    <p className="text-xs text-slate-400">{fmtDate(s.saleDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{rm(s.amount ?? 0)}</span>
                    <StatusBadge status={s.status ?? "pending"} />
                  </div>
                </div>
              ))}
              {!sales.isLoading && !salesRows.length && <EmptyState title="No sales records" description="Sales synced from the POS/external system will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Panel title="Expenses">
            {expenses.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(expenses.data ?? []).map((e) => (
                <div key={e.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-700">{e.payee ?? "Expense"}</p>
                    <p className="text-xs text-slate-400 capitalize">{e.category} · {fmtDate(e.expenseDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{rm(e.amount ?? 0)}</span>
                    <StatusBadge status={e.status ?? "pending"} />
                  </div>
                </div>
              ))}
              {!expenses.isLoading && !(expenses.data ?? []).length && <EmptyState title="No expenses" description="Record the first branch expense to start tracking costs." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="recurring" className="mt-4">
          <Panel title="Recurring Commitments">
            {recurring.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(recurring.data ?? []).map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-700">{r.payee ?? "Recurring"}</p>
                    <p className="text-xs text-slate-400 capitalize">{r.frequency ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{rm(r.amount ?? 0)}</span>
                    <StatusBadge status={r.status ?? "active"} />
                  </div>
                </div>
              ))}
              {!recurring.isLoading && !(recurring.data ?? []).length && <EmptyState title="No recurring commitments" description="Rent, subscriptions and other recurring costs will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="treatments" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top Treatments">
              {topTreatments.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-slate-100">
                {(topTreatments.data ?? []).slice(0, 10).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm text-slate-700">{t.treatmentName ?? t.name ?? "Treatment"}</p>
                    <span className="text-sm font-semibold">{t.count ?? 0}× {t.revenue ? `· ${rm(t.revenue, 0)}` : ""}</span>
                  </div>
                ))}
                {!topTreatments.isLoading && !(topTreatments.data ?? []).length && <EmptyState title="No treatment data" description="Top treatments by volume/revenue will appear here." />}
              </div>
            </Panel>
            <Panel title="Treatment Costs">
              {treatmentCosts.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-slate-100">
                {(treatmentCosts.data ?? []).slice(0, 10).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm text-slate-700">{t.treatmentName ?? "Treatment"}</p>
                    <span className="text-sm font-semibold">{rm(t.cost ?? 0)}</span>
                  </div>
                ))}
                {!treatmentCosts.isLoading && !(treatmentCosts.data ?? []).length && <EmptyState title="No treatment costs" description="Cost configuration per treatment will appear here." />}
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="lab" className="mt-4">
          <Panel title="Lab Payables">
            {labPayables.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(labPayables.data ?? []).map((l) => (
                <div key={l.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-700">{l.labVendor ?? "Lab"}</p>
                    <p className="text-xs text-slate-400">{l.dueDate ? `due ${fmtDate(l.dueDate)}` : "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{rm(l.amount ?? 0)}</span>
                    <StatusBadge status={l.status ?? "pending"} />
                  </div>
                </div>
              ))}
              {!labPayables.isLoading && !(labPayables.data ?? []).length && <EmptyState title="No lab payables" description="Amounts owed to dental labs will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="commissions" className="mt-4">
          <Panel title="Doctor Commissions">
            {commissions.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(commissions.data ?? []).map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-700">Dr. {(c.doctorId ?? "").slice(0, 8)}…</p>
                    <p className="text-xs text-slate-400">{c.period ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{rm(c.amount ?? 0)}</span>
                    <StatusBadge status={c.status ?? "pending"} />
                  </div>
                </div>
              ))}
              {!commissions.isLoading && !(commissions.data ?? []).length && <EmptyState title="No commissions" description="Calculated doctor commissions will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Panel title="Finance Alerts">
            {alerts.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(alerts.data ?? []).map((a) => (
                <div key={a.id} className="py-2.5">
                  <p className="text-sm text-slate-700">{a.message ?? "Alert"}</p>
                  <p className="text-xs text-slate-400 capitalize">{a.severity ?? "info"}</p>
                </div>
              ))}
              {!alerts.isLoading && !(alerts.data ?? []).length && <EmptyState title="No active alerts" description="Finance radar alerts (anomalies, thresholds) will appear here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewExpenseDialog open={showExpense} onClose={() => setShowExpense(false)} />
    </div>
  );
}
