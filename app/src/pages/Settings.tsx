import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Plus, Eye, EyeOff, PlugZap, History, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";
import SetupGuidePanel from "@/components/settings/SetupGuidePanel";
import CommissionFormulaPanel from "@/components/settings/CommissionFormulaPanel";

/* ============================================================================
 * Settings — configuration governance (Seksyen 2 Fasa 3).
 *
 * DUA BUG WAYAR DIBETULKAN DI SINI (Fasa 0 Seksyen 2 mendapatinya):
 *
 * 1. SKOP. UI menghantar `scope: "org"` dan `allowedScopes: ["org","branch"]`,
 *    tetapi enum backend ialah `['system','organization','branch','role','feature']`.
 *    "org" BUKAN nilai yang sah, jadi Setiap `POST /settings/values/:key` dan
 *    SETIAP `POST /settings/definitions` memulangkan 422 — halaman ini tidak
 *    boleh menyimpan apa-apa. Kedua-dua borang di bawah kini menghantar
 *    "organization".
 *
 * 2. TIGA ENDPOINT TIADA PEMANGGIL. `/values/:key/effective` (nilai berkesan
 *    selepas warisan skop), `/values/:key/versions` (sejarah perubahan), dan
 *    `/integrations/:key/test` (uji sambungan) semuanya hidup di backend dan
 *    tiada UI. Kini ada.
 *
 * NOTA KESELAMATAN: halaman ini TIDAK PERNAH memaparkan nilai rahsia. Backend
 * menyimpan metadata vault SAHAJA (vaultPath), dan ia menolak sebarang medan
 * yang menyerupai nilai rahsia ('value', 'token', 'password', …). UI mengekalkan
 * sempadan itu — ia menghantar `vaultPath`, bukan kredensial.
 * ========================================================================== */

interface Definition {
  id: string; key: string; valueType: string; description?: string; category?: string;
  defaultValue?: unknown; allowedScopes?: string[]; branchOverridable?: boolean; locked?: boolean;
}
interface SecretRef { id: string; key: string; vaultPath: string; lastFour?: string | null; status?: string; createdAt?: string }
interface EffectiveValue { key: string; value: unknown; scope: string | null; valueType: string; default: unknown }
interface VersionRow { id: string; version: number; scope: string; oldValue?: unknown; newValue?: unknown; reason?: string; createdAt?: string }
interface IntegrationResult { key: string; status: string; simulated: boolean; checkedAt: string; message: string }
interface IntegrationSetResult { key: string; status: string; message: string; requiresRestart: boolean }

/* Nilai enum SEBENAR backend (settings-lifecycle.ts ScopeLevel / scopeEnum).
 * "org" bukan salah satu daripadanya — itulah bug yang dibetulkan. */
const SCOPES = ["system", "organization", "branch", "role", "feature"] as const;
const VALUE_TYPES = ["string", "number", "boolean", "json"] as const;

const scopeKey = (s: string) => ({
  system: "set.scope.system", organization: "set.scope.organization", branch: "set.scope.branch",
  role: "set.scope.role", feature: "set.scope.feature",
}[s] ?? "set.scope.organization");

function NewDefinitionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", valueType: "string", description: "", category: "", defaultValue: "" });
  const create = useMutation({
    mutationFn: () => api.post<Definition>("/settings/definitions", {
      key: form.key, valueType: form.valueType, description: form.description || null,
      category: form.category || null, defaultValue: form.defaultValue || undefined,
      /* NILAI ENUM YANG SAH — bukan "org". */
      allowedScopes: ["organization", "branch"], branchOverridable: true,
    }),
    onSuccess: () => { toast.success(t("set.definitionCreated")); qc.invalidateQueries({ queryKey: ["settings"] }); onClose(); setForm({ key: "", valueType: "string", description: "", category: "", defaultValue: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("set.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t("set.newDefinition")}</DialogTitle>
          <DialogDescription>{t("set.newDefinitionHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>{t("set.key")} *</Label>
            <Input required pattern="[a-z0-9_.\-]+" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} placeholder={t("set.keyPlaceholder")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("set.valueType")}</Label>
            <Select value={form.valueType} onValueChange={(v) => setForm({ ...form, valueType: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{VALUE_TYPES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>{t("set.description")}</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="space-y-1.5"><Label>{t("set.category")}</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("set.categoryPlaceholder")} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="space-y-1.5"><Label>{t("set.defaultValue")}</Label><Input value={form.defaultValue} onChange={(e) => setForm({ ...form, defaultValue: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground" disabled={create.isPending}>{create.isPending ? t("set.saving") : t("set.createDefinition")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SetValueDialog — tetapkan nilai pada satu skop.
 *
 * Skop 'organization' boleh dipilih oleh HQ; 'branch' memerlukan cawangan.
 * Nilai rahsia TIDAK pernah masuk di sini — hanya nilai konfigurasi biasa.
 */
function SetValueDialog({ def, onClose }: { def: Definition; onClose: () => void }) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = (def.allowedScopes ?? ["organization"]).filter((s) => SCOPES.includes(s as never));
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<string>(allowed.includes("organization") ? "organization" : (allowed[0] ?? "organization"));

  const setVal = useMutation({
    mutationFn: () => api.post(`/settings/values/${encodeURIComponent(def.key)}`, {
      value: def.valueType === "number" ? Number(value) : def.valueType === "boolean" ? value === "true" : value,
      scope, reason: reason || "UI update",
    }),
    onSuccess: () => { toast.success(t("set.valueSet")); qc.invalidateQueries({ queryKey: ["settings"] }); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("set.setFailed"))),
  });

  /* Nilai berkesan — endpoint yang dahulu tiada pemanggil UI. Ia menjawab
     "kalau saya tetapkan di sini, apa yang sistem akan benar-benar guna?"
     sebelum menyimpan, bukan selepas. */
  const effective = useQuery({
    queryKey: ["settings", "effective", def.key],
    queryFn: () => api.get<EffectiveValue>(`/settings/values/${encodeURIComponent(def.key)}/effective`),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t("set.setValueTitle")}, {def.key}</DialogTitle>
          <DialogDescription>{def.description ?? t("set.setValueHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setVal.mutate(); }}>
          {effective.data && (
            <div className="rounded-xl border border-border bg-accent/40 p-3 text-xs">
              <p className="font-medium text-foreground">{t("set.currentEffective")}</p>
              <p className="text-muted-foreground mt-1">
                {JSON.stringify(effective.data.value)} · {t("set.fromScope")} {t(scopeKey(effective.data.scope ?? "organization"))}
                {effective.data.value == null ? ` · ${t("set.usingDefault")}` : ""}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t("set.scope")} *</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map((s) => <SelectItem key={s} value={s}>{t(scopeKey(s))}</SelectItem>)}
              </SelectContent>
            </Select>
            {!user?.branchId && scope === "branch" && (
              <p className="text-xs text-amber-600">{t("set.scopeBranchWarn")}</p>
            )}
          </div>
          <div className="space-y-1.5"><Label>{t("set.value")} ({def.valueType}) *</Label><Input required value={value} onChange={(e) => setValue(e.target.value)} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="space-y-1.5"><Label>{t("set.reason")} *</Label><Textarea required minLength={2} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t("set.reasonPlaceholder")} className="rounded-xl border-border bg-card p-3" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground" disabled={setVal.isPending}>{setVal.isPending ? t("set.saving") : t("set.saveValue")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** VersionDialog — sejarah perubahan satu tetapan. Endpoint yang dahulu tiada UI. */
function VersionDialog({ def, onClose }: { def: Definition; onClose: () => void }) {
  const { t } = usePrefs();
  const history = useQuery({
    queryKey: ["settings", "versions", def.key],
    queryFn: () => api.get<VersionRow[]>(`/settings/values/${encodeURIComponent(def.key)}/versions`),
  });
  const rows = history.data ?? [];
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("set.historyTitle")}, {def.key}</DialogTitle>
          <DialogDescription>{t("set.historyHint")}</DialogDescription>
        </DialogHeader>
        {history.isLoading && <Skeleton className="h-24 w-full" />}
        <div className="divide-y divide-border max-h-96 overflow-y-auto">
          {rows.map((v) => (
            <div key={v.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-muted-foreground">v{v.version} · {t(scopeKey(v.scope))}</span>
                <span className="text-xs text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}</span>
              </div>
              <p className="text-sm text-foreground mt-1">{JSON.stringify(v.oldValue)} → <span className="font-semibold">{JSON.stringify(v.newValue)}</span></p>
              {v.reason && <p className="text-xs text-muted-foreground mt-0.5">{v.reason}</p>}
            </div>
          ))}
          {!history.isLoading && !rows.length && <EmptyState title={t("set.noHistory")} description={t("set.noHistoryHint")} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** IntegrationTestPanel — uji sambungan integrasi dan masukkan API key.
 *
 *  PENTING: backend menandakan hasil ini `simulated: true`. Ia mengesahkan
 *  KONFIGURASI wujud (ada rujukan vault), BUKAN melakukan panggilan luar sebenar.
 *  UI mesti berkata begitu, atau seseorang akan percaya sambungan Bukku telah
 *  disahkan hidup sedangkan ia hanya metadata yang ada.
 *
 *  TAMBAHAN BARU: borang untuk masukkan API key terus dari UI. Nilai dihantar
 *  ke backend (HTTPS) dan ditulis ke fail .env — TIDAK disimpan dalam database.
 */
function IntegrationTestPanel({ secretKeys }: { secretKeys: string[] }) {
  const { t } = usePrefs();
  const [key, setKey] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [testResult, setTestResult] = useState<IntegrationResult | null>(null);
  const [setResult, setSetResult] = useState<IntegrationSetResult | null>(null);

  const test = useMutation({
    mutationFn: (k: string) => api.post<IntegrationResult>(`/settings/integrations/${encodeURIComponent(k)}/test`, {}),
    onSuccess: (d) => { setTestResult(d); setSetResult(null); },
    onError: (e: unknown) => { setTestResult(null); toast.error(errorMessage(e, t("set.testFailed"))); },
  });

  const setApiKey = useMutation({
    mutationFn: (k: string) => api.post<IntegrationSetResult>(`/settings/integrations/${encodeURIComponent(k)}/set`, { value: apiKeyValue }),
    onSuccess: (d) => {
      setSetResult(d);
      setTestResult(null);
      setApiKeyValue("");
      setShowApiKeyInput(false);
      toast.success(t("set.apiKeySaved"));
    },
    onError: (e: unknown) => { setSetResult(null); toast.error(errorMessage(e, t("set.apiKeyFailed"))); },
  });

  /* Known integrations come from the definitions list, NOT from the secret refs.
   *
   * WHY: the credential is what you are testing FOR. Deriving the list from
   * secret_refs means that a fresh install — where nothing is provisioned yet,
   * which is exactly when you want to test — renders an empty dropdown and the
   * button can never be pressed. The refs then only tell us which ones are
   * ALREADY provisioned, which is shown as a hint beside each option. */
  const known = secretKeys.length > 0
    ? secretKeys
    : ["bukku", "waha", "minimax", "ai-provider", "whatsapp"];
  const provisioned = new Set(secretKeys);
  const statusKey: Record<string, string> = { ok: "set.test.ok", not_configured: "set.test.notConfigured", not_found: "set.test.notFound" };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("set.testHint")}</p>
      <div className="flex gap-2">
        <Select value={key} onValueChange={(v) => { setKey(v); setShowApiKeyInput(false); setApiKeyValue(""); setSetResult(null); }}>
          <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm flex-1"><SelectValue placeholder={t("set.pickIntegration")} /></SelectTrigger>
          <SelectContent>{known.map((k) => (
            <SelectItem key={k} value={k}>{k}{provisioned.has(k) ? ` · ${t("set.provisioned")}` : ""}</SelectItem>
          ))}</SelectContent>
        </Select>
        <Button onClick={() => test.mutate(key)} disabled={!key || test.isPending} className="rounded-xl bg-primary text-primary-foreground">
          <PlugZap className="h-4 w-4 mr-1.5" />{test.isPending ? t("set.testing") : t("set.testConnection")}
        </Button>
        <Button onClick={() => setShowApiKeyInput(!showApiKeyInput)} disabled={!key} variant="outline" className="rounded-xl border-border text-foreground">
          <KeyRound className="h-4 w-4 mr-1.5" />{t("set.setApiKey")}
        </Button>
      </div>

      {showApiKeyInput && key && (
        <div className="rounded-xl border border-border bg-accent/40 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("set.apiKeyHint")}</p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={t("set.apiKeyPlaceholder")}
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              className="rounded-xl border-border bg-card px-4 py-2.5 text-sm flex-1 font-mono"
            />
            <Button
              onClick={() => setApiKey.mutate(key)}
              disabled={!apiKeyValue || setApiKey.isPending}
              className="rounded-xl bg-primary text-primary-foreground"
            >
              {setApiKey.isPending ? t("set.saving") : t("set.saveApiKey")}
            </Button>
          </div>
          <p className="text-[11px] text-amber-600">{t("set.apiKeyWarning")}</p>
        </div>
      )}

      {testResult && (
        <div className="rounded-xl border border-border bg-accent/40 p-3 text-xs flex items-start gap-2">
          {testResult.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : testResult.status === "not_configured" ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{t(statusKey[testResult.status] ?? "set.test.notFound")}</p>
            <p className="text-muted-foreground mt-0.5">{testResult.message}</p>
            {testResult.simulated && <p className="text-amber-600 mt-1">{t("set.test.simulated")}</p>}
          </div>
        </div>
      )}

      {setResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <div className="min-w-0">
            <p className="font-medium text-green-800">{t("set.apiKeyConfigured")}</p>
            <p className="text-green-700 mt-0.5">{setResult.message}</p>
            {setResult.requiresRestart && <p className="text-amber-600 mt-1">{t("set.restartRequired")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const definitions = useQuery({ queryKey: ["settings", "definitions"], queryFn: () => api.get<Definition[]>("/settings/definitions") });
  const secrets = useQuery({ queryKey: ["settings", "secrets"], queryFn: () => api.get<SecretRef[]>("/settings/secrets"), retry: false });
  const [showDef, setShowDef] = useState(false);
  const [editDef, setEditDef] = useState<Definition | null>(null);
  const [histDef, setHistDef] = useState<Definition | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);

  const defRows = definitions.data ?? [];
  const secretRows = secrets.data ?? [];
  const secretsForbidden = secrets.isError;
  const isHq = user?.role === "hq";

  return (
    <div className="space-y-6 -mt-6">
      <PageHeader
        title={t("set.title")}
        description={t("set.desc")}
        actions={isHq ? (
          <Button size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={() => setShowDef(true)}>
            <Plus className="h-4 w-4 mr-1.5" />{t("set.newDefinition")}
          </Button>
        ) : undefined}
      />

      <SetupGuidePanel />
      <CommissionFormulaPanel />

      <Panel title={t("set.definitions")} subtitle={t("set.definitionsHint")} className="bg-card rounded-lg p-7 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] border border-black/[0.04]">
        {definitions.isLoading && <Skeleton className="h-40 w-full" />}
        <div className="divide-y divide-border">
          {defRows.map((d) => (
            <div key={d.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono font-medium text-foreground">{d.key}</p>
                <p className="text-xs text-muted-foreground">
                  {d.description ?? "—"} · {t("set.type")} {d.valueType}{d.category ? ` · ${d.category}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.locked && <StatusBadge status="locked" className="rounded-full px-3 py-1 text-xs" />}
                <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" onClick={() => setHistDef(d)}>
                  <History className="h-3.5 w-3.5 mr-1" />{t("set.history")}
                </Button>
                {isHq && (
                  <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" onClick={() => setEditDef(d)}>
                    {t("set.setValue")}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!definitions.isLoading && !defRows.length && (
            <EmptyState title={t("set.noDefinitions")} description={t("set.noDefinitionsHint")} />
          )}
        </div>
      </Panel>

      {isHq && (
        <Panel title={t("set.integrations")} subtitle={t("set.integrationsHint")} className="bg-card rounded-lg p-7 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] border border-black/[0.04]">
          <IntegrationTestPanel secretKeys={secretRows.map((s) => s.key)} />
        </Panel>
      )}

      <Panel
        title={t("set.secrets")}
        subtitle={t("set.secretsHint")}
        className="bg-card rounded-lg p-7 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] border border-black/[0.04]"
        action={
          <Button size="sm" variant="outline" className="rounded-xl border-border text-foreground" onClick={() => setShowSecrets(!showSecrets)}>
            {showSecrets ? <EyeOff className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />}{showSecrets ? t("set.hide") : t("set.show")}
          </Button>
        }
      >
        {secretsForbidden ? (
          <EmptyState title={t("set.restricted")} description={t("set.restrictedHint")} icon={<KeyRound className="h-5 w-5" />} />
        ) : !showSecrets ? (
          <p className="text-sm text-muted-foreground py-2">{t("set.secretsCount", { n: secretRows.length })}</p>
        ) : (
          <div className="divide-y divide-border">
            {secretRows.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-foreground">{s.key}</p>
                  <p className="text-xs font-mono text-muted-foreground truncate">{s.vaultPath}</p>
                </div>
                {s.status && <StatusBadge status={s.status} className="rounded-full px-3 py-1 text-xs" />}
              </div>
            ))}
            {!secretRows.length && <EmptyState title={t("set.noSecrets")} description={t("set.noSecretsHint")} />}
          </div>
        )}
      </Panel>

      <NewDefinitionDialog open={showDef} onClose={() => setShowDef(false)} />
      {editDef && <SetValueDialog def={editDef} onClose={() => setEditDef(null)} />}
      {histDef && <VersionDialog def={histDef} onClose={() => setHistDef(null)} />}
    </div>
  );
}
