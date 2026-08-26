import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Plus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface Definition {
  id: string; key: string; valueType: string; description?: string; category?: string;
  defaultValue?: unknown; allowedScopes?: string[]; branchOverridable?: boolean; locked?: boolean;
}
interface SecretRef { id: string; key: string; vaultPath: string; createdAt?: string }

function NewDefinitionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", valueType: "string", description: "", category: "", defaultValue: "" });
  const create = useMutation({
    mutationFn: () => api.post<Definition>("/settings/definitions", {
      key: form.key, valueType: form.valueType, description: form.description || null,
      category: form.category || null, defaultValue: form.defaultValue || undefined,
      allowedScopes: ["org", "branch"], branchOverridable: true,
    }),
    onSuccess: () => { toast.success("Setting definition created"); qc.invalidateQueries({ queryKey: ["settings"] }); onClose(); setForm({ key: "", valueType: "string", description: "", category: "", defaultValue: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to create definition")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Setting Definition</DialogTitle><DialogDescription>Define a configuration key (org/branch scoped).</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Key *</Label><Input required pattern="[a-z0-9_.\-]+" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} placeholder="e.g. clinic.timezone" /></div>
          <div className="space-y-1.5"><Label>Value type</Label>
            <Select value={form.valueType} onValueChange={(v) => setForm({ ...form, valueType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["string", "number", "boolean", "json"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. general, notifications" /></div>
          <div className="space-y-1.5"><Label>Default value</Label><Input value={form.defaultValue} onChange={(e) => setForm({ ...form, defaultValue: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create Definition"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetValueDialog({ def, onClose }: { def: Definition; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const setVal = useMutation({
    mutationFn: () => api.post(`/settings/values/${encodeURIComponent(def.key)}`, {
      value: def.valueType === "number" ? Number(value) : def.valueType === "boolean" ? value === "true" : value,
      scope: "org", reason: reason || "UI update",
    }),
    onSuccess: () => { toast.success(`Value set for ${def.key}`); qc.invalidateQueries({ queryKey: ["settings"] }); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to set value")),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Set Value — {def.key}</DialogTitle><DialogDescription>{def.description ?? "Update the org-scoped value for this setting."}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setVal.mutate(); }}>
          <div className="space-y-1.5"><Label>Value ({def.valueType}) *</Label><Input required value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reason *</Label><Textarea required minLength={2} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this change being made?" /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={setVal.isPending}>{setVal.isPending ? "Saving…" : "Save Value"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SettingsPage() {
  const definitions = useQuery({ queryKey: ["settings", "definitions"], queryFn: () => api.get<Definition[]>("/settings/definitions") });
  const secrets = useQuery({ queryKey: ["settings", "secrets"], queryFn: () => api.get<SecretRef[]>("/settings/secrets"), retry: false });
  const [showDef, setShowDef] = useState(false);
  const [editDef, setEditDef] = useState<Definition | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);

  const defRows = definitions.data ?? [];
  const secretRows = secrets.data ?? [];
  const secretsForbidden = secrets.isError;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Settings"
        description="Configuration definitions, values and secret references"
        actions={<Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowDef(true)}><Plus className="h-4 w-4 mr-1.5" /> New Definition</Button>}
      />

      <Panel title="Setting Definitions" subtitle="Org/branch configuration keys">
        {definitions.isLoading && <Skeleton className="h-40 w-full" />}
        <div className="divide-y divide-slate-100">
          {defRows.map((d) => (
            <div key={d.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono font-medium text-slate-800">{d.key}</p>
                <p className="text-xs text-slate-400">{d.description ?? "—"} · type {d.valueType}{d.category ? ` · ${d.category}` : ""}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.locked && <StatusBadge status="locked" />}
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setEditDef(d)}>Set Value</Button>
              </div>
            </div>
          ))}
          {!definitions.isLoading && !defRows.length && (
            <EmptyState title="No setting definitions" description="Create the first configuration definition to manage org/branch settings." />
          )}
        </div>
      </Panel>

      <Panel
        title="Secret References"
        subtitle="Vault paths only — secret values are never displayed"
        action={
          <Button size="sm" variant="outline" onClick={() => setShowSecrets(!showSecrets)}>
            {showSecrets ? <EyeOff className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />} {showSecrets ? "Hide" : "Show"}
          </Button>
        }
      >
        {secretsForbidden ? (
          <EmptyState title="Restricted" description="Secret references are HQ-only. Your role does not have access." icon={<KeyRound className="h-5 w-5" />} />
        ) : !showSecrets ? (
          <p className="text-sm text-slate-400 py-2">{secretRows.length} secret reference{secretRows.length === 1 ? "" : "s"} registered. Click Show to reveal vault paths (values remain masked).</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {secretRows.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between">
                <p className="text-sm font-mono text-slate-800">{s.key}</p>
                <p className="text-xs font-mono text-slate-400">{s.vaultPath}</p>
              </div>
            ))}
            {!secretRows.length && <EmptyState title="No secret references" description="Vault secret references will appear here (values never displayed)." />}
          </div>
        )}
      </Panel>

      <NewDefinitionDialog open={showDef} onClose={() => setShowDef(false)} />
      {editDef && <SetValueDialog def={editDef} onClose={() => setEditDef(null)} />}
    </div>
  );
}
