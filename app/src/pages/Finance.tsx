import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { canWriteFinance } from "@/lib/permissions";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, StatCard, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rm, fmtDate } from "@/lib/format";
import { downloadCsv, datedCsvName } from "@/lib/csv";
import { TrendingUp, Receipt, AlertCircle, Plus, CreditCard, Repeat, FlaskConical, Percent, Trophy, Link2, Wallet, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { BukkuSyncTab } from "@/components/finance/BukkuSyncTab";
import { PatientBalancesTab } from "@/components/finance/PatientBalancesTab";

interface Revenue { total?: number; amount?: number }
interface Sale { id: string; amount?: number; status?: string; saleDate?: string; saleCode?: string }
interface Expense { id: string; category?: string; payee?: string; amount?: number; expenseDate?: string; status?: string }
interface Recurring { id: string; payee?: string; amount?: number; status?: string; frequency?: string }
interface TreatmentCost { id: string; treatmentName?: string; cost?: number }
interface TopTreatment { id: string; name?: string; treatmentName?: string; count?: number; revenue?: number }
interface LabPayable { id: string; labVendor?: string; amount?: number; status?: string; dueDate?: string }
interface Commission { id: string; doctorId?: string; amount?: number; status?: string; period?: string }
interface Alert { id: string; message?: string; severity?: string }

/* THESE MUST EQUAL THE BACKEND LIST, CHARACTER FOR CHARACTER.
 *
 * The backend validates with `isExpenseCategory` against
 *   ['Utilities','Payroll','Doctor Commission','Insurance','Taxes & Government',
 *    'Premises','Maintenance','Supplies','Professional Services','Lab Fees','Operations']
 * and this file previously offered a DIFFERENT list in lowercase
 * (`rent, utilities, salaries, supplies, lab, ...`). Not one value matched: every
 * expense recorded from this screen was refused with "unknown expense category", so
 * the form could not succeed for any input. The validation is a strict equality check
 * on a capitalised set — there is no normalisation server-side, deliberately, because
 * guessing what "lab" meant would silently misfile money.
 *
 * Treat a mismatch here as a bug of the same severity as a wrong amount.
 */
const EXPENSE_CATEGORIES = [
  "Utilities", "Payroll", "Doctor Commission", "Insurance", "Taxes & Government",
  "Premises", "Maintenance", "Supplies", "Professional Services", "Lab Fees", "Operations",
];

function NewExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  /* THE DEFAULT MUST BE A VALUE THE SERVER ACCEPTS TOO.
   *
   * Fixing the dropdown's OPTION LIST was not enough. The form STARTS with a category
   * already chosen, and it was still the old lowercase `"supplies"`. A Radix Select whose
   * value is not among its items renders nothing, so the screen LOOKED like it had a
   * category while the state held a string the server rejects — the form then failed with
   * "unknown expense category" even though every visible option was valid.
   *
   * The earlier API test proved the LIST matched; only pressing the button proved the
   * DEFAULT did not. Initialise from the list itself so the two cannot differ. */
  const [form, setForm] = useState({ category: EXPENSE_CATEGORIES[0], payee: "", amount: "", expenseDate: new Date().toISOString().slice(0, 10), notes: "" });
  const create = useMutation({
    mutationFn: () => api.post<Expense>("/finance/expenses", {
      branchId, category: form.category, payee: form.payee,
      /* `amount` is a DECIMAL STRING on the wire (moneySchema accepts /^\d+(\.\d{1,4})?$/).
       * Sending `Number(...)` was refused with "Expected string, received number" — a
       * second independent reason this form could never succeed. Normalise to 2 decimals
       * so an operator typing "12.5" records 12.50 and not 12.5000 or 12.5. */
      amount: Number(form.amount).toFixed(2), expenseDate: form.expenseDate, notes: form.notes || null,
    }),
    onSuccess: () => { toast.success(t("msg.expenseRecorded")); qc.invalidateQueries({ queryKey: ["finance"] }); onClose(); setForm({ category: EXPENSE_CATEGORIES[0], payee: "", amount: "", expenseDate: new Date().toISOString().slice(0, 10), notes: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.expenseFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("fin.recordExpense")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("fin.expenseDesc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Category *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("fin.payee")} *</Label>
            <Input required value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("fin.amount")} (RM) *</Label>
              <Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("fin.date")} *</Label>
              <Input required type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          {/* AN EXPENSE MUST LAND IN A NAMED BRANCH.
           *
           * `branchId` comes from the branch switcher, and for HQ it is **null** whenever
           * "All Branches" is selected — which is the DEFAULT. So the commonest HQ path
           * filled the form and failed: "Expected string, received null". An expense with
           * no branch is not a smaller expense, it is unattributable.
           *
           * The reason is stated and the button is held, rather than letting the person
           * submit and read a validation error about a field the form never showed. */}
          {!branchId && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              PLACEHOLDER_MARK
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={create.isPending || !branchId}>
              {create.isPending ? t("common.saving") : t("fin.recordExpense")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
 * CALCULATE COMMISSION (P2)
 *
 * The finance screen could LIST commissions but never CREATE one: the commission
 * engine, its ledger and the `POST /finance/commissions/calculate` endpoint all
 * existed, yet no screen called them. A dentist's pay could therefore only be
 * produced by hand, outside the product.
 *
 * THE IMPORTANT PART IS NOT THE FORM — IT IS THE CHECKBOX.
 *
 * Typing a revenue figure makes the commission unauditable: nothing in the clinic
 * can be checked against it. Ticking "derive from recorded costs" asks the server
 * to SUM that doctor's own treatment charges instead, so the number is traceable
 * to real rows. It defaults to ON, because the auditable path should be the easy
 * one — a person who wants to override has to actively untick it.
 */
function CalculateCommissionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const { t } = usePrefs();

  /* Same source the rest of the app uses for the doctor list. */
  const doctors = useQuery({
    queryKey: ["doctor-registration", "doctors", branchId],
    queryFn: () => api.get<Array<{ id: string; name?: string }>>(`/doctor-registration/doctors/list?branchId=${branchId ?? ""}`),
    enabled: open && !!branchId,
  });

  const [form, setForm] = useState({
    doctorId: "",
    /* Default to the CURRENT month: a commission is normally run for the period
     * just finished, and an empty period would fail validation for no reason. */
    period: new Date().toISOString().slice(0, 7),
    derive: true,
    grossRevenue: "",
  });

  const create = useMutation({
    mutationFn: () => api.post<Commission>("/finance/commissions/calculate", {
      branchId,
      doctorId: form.doctorId,
      period: form.period,
      deriveFromCosts: form.derive,
      /* Only sent when NOT deriving — the server rejects neither, but sending a
       * stale typed value alongside derive:true would invite confusion about
       * which figure was used. The audit trail records the source either way. */
      ...(form.derive ? {} : { grossRevenue: Number(form.grossRevenue).toFixed(2) }),
    }),
    onSuccess: () => {
      toast.success(t("fin.commissionCalculated"));
      qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    /* The server returns 409 when a ledger already exists for this doctor+period
     * (idempotency, not an error). Surfacing the real message matters: "already
     * calculated" tells the operator to look at the list, not to retry. */
    onError: (e: unknown) => toast.error(errorMessage(e, t("fin.commissionFailed"))),
  });

  const canSubmit = !!branchId && !!form.doctorId && !!form.period && (form.derive || !!form.grossRevenue);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">
            {t("fin.calculateCommission")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("fin.calculateCommissionHint")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("fin.doctor")} *</Label>
            <Select value={form.doctorId} onValueChange={(v) => setForm({ ...form, doctorId: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm">
                <SelectValue placeholder={t("fin.pickDoctor")} />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name ?? d.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("fin.period")} *</Label>
            {/* A month input, so the value can only ever be YYYY-MM, the one
                format the server scopes a sum by. A free-text field would let an
                operator enter "Oct 2026" and silently receive an ALL-TIME figure. */}
            <Input required type="month" value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
              className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <input type="checkbox" checked={form.derive}
              onChange={(e) => setForm({ ...form, derive: e.target.checked, grossRevenue: e.target.checked ? "" : form.grossRevenue })}
              className="mt-0.5" />
            <span className="text-foreground">
              {t("fin.deriveFromCosts")}
              <span className="block text-xs text-muted-foreground">{t("fin.deriveFromCostsHint")}</span>
            </span>
          </label>

          {!form.derive && (
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("fin.grossRevenue")} *</Label>
              <Input required type="number" min="0" step="0.01" value={form.grossRevenue}
                onChange={(e) => setForm({ ...form, grossRevenue: e.target.value })}
                className="rounded-xl border-border bg-card px-4 py-2.5" />
              <p className="text-xs text-muted-foreground">{t("fin.manualRevenueWarning")}</p>
            </div>
          )}

          {!branchId && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("fin.pickBranchFirst")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}
              className="rounded-xl border-border text-foreground hover:bg-muted">
              {t("common.cancel")}
            </Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={create.isPending || !canSubmit}>
              {create.isPending ? t("common.saving") : t("fin.calculateCommission")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Finance() {
  /* Skop cawangan (pemilik 10 Okt): semua query kini menghantar branchId
   * dari pemilih cabang header — HQ di "All Branches" nampak gabungan,
   * HQ pilih satu cawangan nampak angka cawangan itu sahaja. Sebelum ini
   * branchId tidak dihantar langsung, jadi pemilih cabang tidak memberi
   * apa-apa kesan pada halaman Kewangan.
   * branchId === null (All Branches) → tiada param, backend pulangkan semua. */
  const { branchId } = useBranch();
  const scopeParam = branchId ? `?branchId=${branchId}` : "";
  const revenue = useQuery({ queryKey: ["finance", "revenue", branchId], queryFn: () => api.get<Revenue>(`/finance/revenue${scopeParam}`) });
  const sales = useQuery({ queryKey: ["finance", "sales", branchId], queryFn: () => api.get<Sale[]>(`/finance/sales${scopeParam}`) });
  const expenses = useQuery({ queryKey: ["finance", "expenses", branchId], queryFn: () => api.get<Expense[]>(`/finance/expenses${scopeParam}`) });
  const recurring = useQuery({ queryKey: ["finance", "recurring", branchId], queryFn: () => api.get<Recurring[]>(`/finance/recurring${scopeParam}`) });
  const alerts = useQuery({ queryKey: ["finance", "alerts", branchId], queryFn: () => api.get<Alert[]>(`/finance/alerts${scopeParam}`) });
  const treatmentCosts = useQuery({ queryKey: ["finance", "treatment-costs", branchId], queryFn: () => api.get<TreatmentCost[]>(`/finance/treatment-costs${scopeParam}`) });
  const topTreatments = useQuery({ queryKey: ["finance", "top-treatments", branchId], queryFn: () => api.get<TopTreatment[]>(`/finance/top-treatments${scopeParam}`) });
  const labPayables = useQuery({ queryKey: ["finance", "lab-payables", branchId], queryFn: () => api.get<LabPayable[]>(`/finance/lab-payables${scopeParam}`) });
  const commissions = useQuery({ queryKey: ["finance", "commissions", branchId], queryFn: () => api.get<Commission[]>(`/finance/commissions${scopeParam}`) });

  /* The role is needed to decide what this page MAY OFFER. The server stays the
   * authority; this only prevents a control being shown that can only fail. */
  const { user } = useAuth();
  const { t } = usePrefs();
  const [showExpense, setShowExpense] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const [tab, setTab] = useState("sales");

  /* DECIMAL columns arrive as STRINGS from MySQL ('5500.0000'). Adding them
   * directly does string concatenation ('05500.0000890.0000…') and rm()
   * renders RMNaN — the on-screen bug. Coerce EVERY summand, and treat a
   * non-numeric/empty value as 0 rather than poisoning the total. */
  const totalRevenue = Number(revenue.data?.total ?? revenue.data?.amount ?? 0) || 0;
  const salesRows = sales.data ?? [];
  const totalExpenses = (expenses.data ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

  /* Export the ACTIVE tab, not a fixed dataset.
   *
   * The tabs hold unrelated shapes (sales, expenses, lab payables…), so one
   * combined file would be a spreadsheet of five different tables stacked —
   * readable by neither Excel nor a person. The tab the reader is looking at is
   * what they want out; the label says which one it was.
   *
   * Values go through the same `rm`/`fmtDate` the table uses, so the file and the
   * screen cannot disagree. `Tab` has no data of its own, so it exports nothing
   * and says so rather than emitting an empty file. */
  const exportActiveTab = () => {
    const cols = (head: string[]) => head;
    const filename = `kewangan-${tab}`;
    let rows: unknown[][] = [];

    switch (tab) {
      case "sales":
        rows = [cols([t("fin.recentSales"), t("rep.period")]), ...salesRows.map((s) => [s.saleCode ?? "", fmtDate(s.saleDate)])];
        break;
      case "expenses":
        rows = [
          cols([t("fin.expenses"), "Kategori", t("rep.period")]),
          ...(expenses.data ?? []).map((e) => [e.payee ?? "", e.category ?? "", fmtDate(e.expenseDate)]),
        ];
        break;
      case "recurring":
        rows = [
          cols([t("fin.recurringCommitments"), t("fin.period")]),
          ...(recurring.data ?? []).map((r) => [r.payee ?? "", r.frequency ?? ""]),
        ];
        break;
      case "treatments":
        rows = [cols([t("fin.topTreatments"), t("rep.appts")]), ...(topTreatments.data ?? []).map((x) => [x.treatmentName ?? x.name ?? "", x.count ?? 0])];
        break;
      case "lab":
        rows = [
          cols([t("fin.labPayables"), "Tarikh"]),
          ...(labPayables.data ?? []).map((l) => [l.labVendor ?? "", l.dueDate ? fmtDate(l.dueDate) : ""]),
        ];
        break;
      case "commissions":
        rows = [
          cols([t("fin.doctorCommissions"), t("fin.period")]),
          ...(commissions.data ?? []).map((c) => [`${t("fin.doctor")} ${(c.doctorId ?? "").slice(0, 8)}`, c.period ?? ""]),
        ];
        break;
      case "alerts":
        rows = [
          cols([t("fin.financeAlerts"), "Tahap"]),
          ...(alerts.data ?? []).map((a) => [a.message ?? "", a.severity ?? "info"]),
        ];
        break;
      default:
        /* Bukku Sync owns its own state and renders its own component — there is
         * nothing here to export, and an empty download would look like a bug. */
        toast.info(t("fin.exportNone"));
        return;
    }

    downloadCsv(datedCsvName(filename), rows);
    toast.success(t("fin.exportDone"));
  };

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("fin.title")}
        description={t("fin.desc")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportActiveTab} className="rounded-xl">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t("fin.exportCsv")}
            </Button>
            {/* TOMBOL MENGIKUTI TAB AKTIF (audit UX): "Rekod Perbelanjaan" hanya
             * relevan pada tab expenses — sebelum ini ia melekat di header untuk
             * SEMUA 8 tab, mengelirukan pembaca yang berada di Sales/Balances
             * (keluhan: "tombolnya tetap ada walau ganti section"). Tab lain
             * tidak mendapat tombol tulis: komisi ada tombol sendiri di
             * panelnya, balances ada Imbas Kutipan, bukku hanya baca. */}
            {canWriteFinance(user?.role) && tab === "expenses" ? (
              <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowExpense(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("fin.recordExpense")}
              </Button>
            ) : canWriteFinance(user?.role) && tab === "recurring" ? (
              <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowCommission(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("fin.calculateCommission")}
              </Button>
            ) : canWriteFinance(user?.role) ? (
              <span className="text-xs text-muted-foreground">
                {t("fin.hqOnlyWrite")}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title={t("fin.totalRevenue")} value={rm(totalRevenue, 0)} icon={<TrendingUp className="h-4 w-4" />} loading={revenue.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
        <StatCard title={t("fin.salesRecords")} value={salesRows.length} icon={<Receipt className="h-4 w-4" />} loading={sales.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
        <StatCard title={t("fin.totalExpenses")} value={rm(totalExpenses, 0)} icon={<CreditCard className="h-4 w-4" />} loading={expenses.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
        <StatCard title={t("fin.activeAlerts")} value={(alerts.data ?? []).length} icon={<AlertCircle className="h-4 w-4" />} loading={alerts.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card border border-border rounded-lg p-1 shadow-md flex flex-wrap gap-1">
          <TabsTrigger value="sales" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Receipt className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.sales")}
          </TabsTrigger>
          <TabsTrigger value="expenses" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.expenses")}
          </TabsTrigger>
          <TabsTrigger value="recurring" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Repeat className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.recurring")}
          </TabsTrigger>
          <TabsTrigger value="treatments" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Trophy className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.treatments")}
          </TabsTrigger>
          <TabsTrigger value="lab" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.lab")}
          </TabsTrigger>
          <TabsTrigger value="commissions" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Percent className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.commissions")}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <AlertCircle className="h-3.5 w-3.5 mr-1.5" />{t("fin.tab.alerts")}
          </TabsTrigger>
          <TabsTrigger value="balances" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Wallet className="h-3.5 w-3.5 mr-1.5" />{t("fin.balancesTab")}
          </TabsTrigger>
          <TabsTrigger value="bukku" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Link2 className="h-3.5 w-3.5 mr-1.5" />{t("fin.bukkuTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bukku" className="mt-4">
          <BukkuSyncTab />
        </TabsContent>

        {/* P4: branch-level chase list, who owes, how much, what is late.
            Money actions stay in Patient360 (patient's file open). */}
        <TabsContent value="balances" className="mt-4">
          <PatientBalancesTab />
        </TabsContent>

        <TabsContent value="sales" className="mt-4">
          <Panel title={t("fin.recentSales")} subtitle={t("fin.recentSalesSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {sales.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {salesRows.slice(0, 25).map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{s.saleCode ?? "Sale"}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(s.saleDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{rm(s.amount ?? 0)}</span>
                    <StatusBadge status={s.status ?? "pending"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                  </div>
                </div>
              ))}
              {!sales.isLoading && !salesRows.length && <EmptyState title={t("fin.empty.sales")} description={t("fin.empty.salesHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Panel title={t("fin.expenses")} subtitle={t("fin.expensesSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {expenses.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(expenses.data ?? []).map((e) => (
                <div key={e.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{e.payee ?? "Expense"}</p>
                    <p className="text-xs text-muted-foreground capitalize">{e.category} · {fmtDate(e.expenseDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{rm(e.amount ?? 0)}</span>
                    <StatusBadge status={e.status ?? "pending"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                  </div>
                </div>
              ))}
              {!expenses.isLoading && !(expenses.data ?? []).length && <EmptyState title={t("fin.empty.expenses")} description={t("fin.empty.expensesHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="recurring" className="mt-4">
          <Panel title={t("fin.recurringCommitments")} subtitle={t("fin.recurringSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {recurring.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(recurring.data ?? []).map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.payee ?? "Recurring"}</p>
                    <p className="text-xs text-muted-foreground capitalize">{r.frequency ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{rm(r.amount ?? 0)}</span>
                    <StatusBadge status={r.status ?? "active"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                  </div>
                </div>
              ))}
              {!recurring.isLoading && !(recurring.data ?? []).length && <EmptyState title={t("fin.empty.recurring")} description={t("fin.empty.recurringHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="treatments" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("fin.topTreatments")} subtitle={t("fin.topTreatmentsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {topTreatments.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border">
                {(topTreatments.data ?? []).slice(0, 10).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{t.treatmentName ?? t.name ?? "Treatment"}</p>
                    <span className="text-sm font-semibold text-foreground">{t.count ?? 0}× {t.revenue ? `· ${rm(t.revenue, 0)}` : ""}</span>
                  </div>
                ))}
                {!topTreatments.isLoading && !(topTreatments.data ?? []).length && <EmptyState title={t("fin.empty.treatments")} description={t("fin.empty.treatmentsHint")} />}
              </div>
            </Panel>
            <Panel title={t("fin.treatmentCosts")} subtitle={t("fin.treatmentCostsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {treatmentCosts.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border">
                {(treatmentCosts.data ?? []).slice(0, 10).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{t.treatmentName ?? "Treatment"}</p>
                    <span className="text-sm font-semibold text-foreground">{rm(t.cost ?? 0)}</span>
                  </div>
                ))}
                {!treatmentCosts.isLoading && !(treatmentCosts.data ?? []).length && <EmptyState title={t("fin.empty.costs")} description={t("fin.empty.costsHint")} />}
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="lab" className="mt-4">
          <Panel title={t("fin.labPayables")} subtitle={t("fin.labPayablesSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {labPayables.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(labPayables.data ?? []).map((l) => (
                <div key={l.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{l.labVendor ?? "Lab"}</p>
                    <p className="text-xs text-muted-foreground">{l.dueDate ? `due ${fmtDate(l.dueDate)}` : "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{rm(l.amount ?? 0)}</span>
                    <StatusBadge status={l.status ?? "pending"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                  </div>
                </div>
              ))}
              {!labPayables.isLoading && !(labPayables.data ?? []).length && <EmptyState title={t("fin.empty.lab")} description={t("fin.empty.labHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="commissions" className="mt-4">
          <Panel title={t("fin.doctorCommissions")} subtitle={t("fin.commissionsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {/* P2, the screen could LIST commissions but never create one. This
                is the button that was missing: without it a doctor's pay could
                only be produced outside the product. */}
            {canWriteFinance(user?.role) && (
              <div className="mb-3 flex justify-end">
                <Button onClick={() => setShowCommission(true)}
                  className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="mr-1.5 h-4 w-4" /> {t("fin.calculateCommission")}
                </Button>
              </div>
            )}
            {commissions.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(commissions.data ?? []).map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Dr. {(c.doctorId ?? "").slice(0, 8)}…</p>
                    <p className="text-xs text-muted-foreground">{c.period ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{rm(c.amount ?? 0)}</span>
                    <StatusBadge status={c.status ?? "pending"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                  </div>
                </div>
              ))}
              {!commissions.isLoading && !(commissions.data ?? []).length && <EmptyState title={t("fin.empty.commissions")} description={t("fin.empty.commissionsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Panel title={t("fin.financeAlerts")} subtitle={t("fin.financeAlertsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {alerts.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(alerts.data ?? []).map((a) => (
                <div key={a.id} className="py-2.5">
                  <p className="text-sm font-semibold text-foreground">{a.message ?? "Alert"}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.severity ?? "info"}</p>
                </div>
              ))}
              {!alerts.isLoading && !(alerts.data ?? []).length && <EmptyState title={t("fin.empty.alerts")} description={t("fin.empty.alertsHint")} />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewExpenseDialog open={showExpense} onClose={() => setShowExpense(false)} />
      <CalculateCommissionDialog open={showCommission} onClose={() => setShowCommission(false)} />
    </div>
  );
}
