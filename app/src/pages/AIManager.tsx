import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import {
  PageHeader,
  Panel,
  EmptyState,
  StatusBadge,
} from "@/components/shared";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { useBranch } from "@/hooks/useBranch";
import {
  Bot,
  ShieldCheck,
  ListChecks,
  ScrollText,
  MessageSquare,
  Save,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Agent {
  id: string;
  key: string;
  name: string;
  icon?: string;
  ownerDomain: string;
  status: string;
  description?: string;
}

interface Guardrail {
  id: string;
  agentId?: string;
  ruleKey: string;
  rule: string;
  level: string;
}

interface ApprovalRule {
  id: string;
  agentId?: string;
  actionKey: string;
  risk: string;
  auto: boolean;
  note?: string;
}

interface Audit {
  id: string;
  agentId?: string;
  createdAt?: string;
  action?: string;
  detail?: string;
}

interface PromptResult {
  branchId: string;
  prompt: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
  configured: boolean;
}

interface Draft {
  prompt: string;
  version: number;
}

const tabClass =
  "rounded-full data-[state=active]:bg-gradient-to-r " +
  "data-[state=active]:from-teal-500 " +
  "data-[state=active]:to-cyan-500 " +
  "data-[state=active]:text-white";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function WhatsappPromptEditor({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const queryKey = ["whatsapp-prompt", branchId];
  const endpoint =
    `/whatsapp/prompt?branchId=${encodeURIComponent(branchId)}`;

  const promptQuery = useQuery({
    queryKey,
    queryFn: () => api.get<PromptResult>(endpoint),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const saved = promptQuery.data;
  const text = draft?.prompt ?? saved?.prompt ?? "";
  const trimmed = text.trim();
  const dirty = draft !== null && text !== (saved?.prompt ?? "");
  const valid = trimmed.length >= 20 && trimmed.length <= 20000;

  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  const save = useMutation({
    mutationFn: (input: Draft) =>
      api.put<PromptResult>(endpoint, input),

    onSuccess: (result) => {
      qc.setQueryData(queryKey, result);
      setDraft(null);
      toast.success("Prompt WhatsApp berjaya disimpan.");
    },

    onError: (error: unknown) => {
      toast.error(
        errorMessage(error, "Prompt tidak dapat disimpan."),
      );
    },
  });

  async function reload() {
    if (
      dirty &&
      !window.confirm(
        "Buang perubahan yang belum disimpan dan muat semula prompt?",
      )
    ) {
      return;
    }

    const result = await promptQuery.refetch();

    if (!result.isError) {
      setDraft(null);
    }
  }

  function savePrompt() {
    if (!saved || !valid || !dirty || save.isPending) return;

    save.mutate({
      prompt: trimmed,
      version: draft?.version ?? saved.version,
    });
  }

  return (
    <Panel>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            Prompt WhatsApp
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Edit arahan, gaya bahasa dan maklumat yang digunakan
            oleh pembantu WhatsApp.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            HQ dan pengurus cawangan boleh menyimpan prompt
            mengikut akses cawangan masing-masing.
          </p>
        </div>

        {promptQuery.isLoading && (
          <Skeleton className="h-72 w-full" />
        )}

        {promptQuery.isError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <p className="text-sm text-red-700">
              {errorMessage(
                promptQuery.error,
                "Prompt tidak dapat dimuatkan.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={promptQuery.isFetching}
              onClick={() => void promptQuery.refetch()}
            >
              Cuba semula
            </Button>
          </div>
        )}

        {saved && (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              <span>Versi: {saved.version}</span>
              <span>
                Dikemas kini:{" "}
                {saved.updatedAt
                  ? fmtDateTime(saved.updatedAt)
                  : "Belum disimpan"}
              </span>
              {dirty && (
                <span className="font-medium text-amber-700">
                  Ada perubahan belum disimpan
                </span>
              )}
            </div>

            {!saved.configured && (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
                Belum ada prompt tersimpan untuk cawangan ini.
                Bot masih menggunakan prompt asal dalam kod.
                Tampal prompt lengkap yang mahu digunakan sebelum
                menekan Simpan.
              </div>
            )}

            <div>
              <label
                htmlFor="whatsapp-prompt"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Arahan bot
              </label>
              <textarea
                id="whatsapp-prompt"
                value={text}
                disabled={save.isPending}
                onChange={(event) => {
                  const value = event.target.value;

                  setDraft((current) => ({
                    prompt: value,
                    version: current?.version ?? saved.version,
                  }));
                }}
                rows={20}
                maxLength={20000}
                spellCheck={false}
                aria-describedby="prompt-help"
                className="w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-sm leading-7 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60"
                placeholder="Tampal prompt lengkap bot WhatsApp di sini..."
              />
              <div
                id="prompt-help"
                className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"
              >
                <span>
                  Minimum 20 aksara. Simpan sebelum menukar cawangan
                  atau meninggalkan halaman.
                </span>
                <span>{text.length.toLocaleString()} / 20,000</span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Prompt mengawal balasan bot. Jadual doktor, cuti,
              slot dan pengesahan booking tetap disemak oleh sistem.
              Menukar waktu operasi dalam teks prompt sahaja tidak
              mengubah aturan slot booking.
            </div>

            {save.isError && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(
                  save.error,
                  "Simpanan gagal. Teks anda masih berada dalam editor.",
                )}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={
                  !dirty ||
                  !valid ||
                  save.isPending ||
                  promptQuery.isFetching
                }
                onClick={savePrompt}
              >
                <Save className="mr-2 h-4 w-4" />
                {save.isPending ? "Menyimpan..." : "Simpan Prompt"}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || promptQuery.isFetching}
                onClick={() => void reload()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Muat Semula
              </Button>

              {dirty && !valid && (
                <span className="text-xs text-amber-700">
                  Prompt mesti mengandungi 20 hingga 20,000 aksara.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function AIManager() {
  const qc = useQueryClient();
  const { branchId } = useBranch();

  const selectedBranch =
    typeof branchId === "string" && uuidPattern.test(branchId)
      ? branchId
      : "";

  const agents = useQuery({
    queryKey: ["ai", "agents"],
    queryFn: () => api.get<Agent[]>("/ai/agents"),
  });

  const guardrails = useQuery({
    queryKey: ["ai", "guardrails"],
    queryFn: () => api.get<Guardrail[]>("/ai/guardrails"),
  });

  const approvals = useQuery({
    queryKey: ["ai", "approvals"],
    queryFn: () => api.get<ApprovalRule[]>("/ai/approval-rules"),
  });

  const audit = useQuery({
    queryKey: ["ai", "audit"],
    queryFn: () => api.get<Audit[]>("/ai/audit?limit=50"),
  });

  const transition = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "enable" | "pause" | "archive";
    }) => api.post(`/ai/agents/${id}/${action}`, {}),

    onSuccess: () => {
      toast.success("Status agent dikemas kini.");
      void qc.invalidateQueries({ queryKey: ["ai"] });
    },

    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Action failed"));
    },
  });

  const agentRows = agents.data ?? [];
  const enabled = agentRows.filter(
    (agent) => agent.status === "enabled",
  ).length;

  return (
    <div className="space-y-6 -mt-6">
      <PageHeader
        title="AI Manager"
        description="Prompt WhatsApp, AI agents, guardrails and audit trail"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          {
            label: "AI Agents",
            value: agentRows.length,
            icon: <Bot className="h-4 w-4" />,
          },
          {
            label: "Enabled",
            value: enabled,
            icon: <Bot className="h-4 w-4" />,
          },
          {
            label: "Guardrails",
            value: (guardrails.data ?? []).length,
            icon: <ShieldCheck className="h-4 w-4" />,
          },
          {
            label: "Approval Rules",
            value: (approvals.data ?? []).length,
            icon: <ListChecks className="h-4 w-4" />,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              {item.label}
              <span className="rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 p-2 text-white">
                {item.icon}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-[#0B132B]">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="prompt">
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-2xl border border-white/60 bg-white/80 p-1.5 shadow-lg shadow-slate-900/5">
          <TabsTrigger className={tabClass} value="prompt">
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            Prompt WhatsApp
          </TabsTrigger>
          <TabsTrigger className={tabClass} value="agents">
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            Agents
          </TabsTrigger>
          <TabsTrigger className={tabClass} value="guardrails">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Guardrails
          </TabsTrigger>
          <TabsTrigger className={tabClass} value="approvals">
            <ListChecks className="mr-1.5 h-3.5 w-3.5" />
            Approval Rules
          </TabsTrigger>
          <TabsTrigger className={tabClass} value="audit">
            <ScrollText className="mr-1.5 h-3.5 w-3.5" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="prompt"
          forceMount
          className="mt-4 data-[state=inactive]:hidden"
        >
          {selectedBranch ? (
            <WhatsappPromptEditor
              key={selectedBranch}
              branchId={selectedBranch}
            />
          ) : (
            <Panel>
              <EmptyState
                title="Pilih satu cawangan"
                description="Gunakan pilihan cawangan di bahagian atas untuk mengurus prompt WhatsApp."
              />
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <Panel>
            {agents.isLoading && <Skeleton className="h-40 w-full" />}
            {agents.isError && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(agents.error, "Gagal memuatkan agents.")}
              </p>
            )}
            <div className="divide-y divide-slate-100">
              {agentRows.map((agent) => (
                <div
                  key={agent.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Bot className="h-5 w-5 shrink-0 text-teal-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {agent.name}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {agent.description ?? agent.ownerDomain}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={agent.status} />
                    {agent.status !== "enabled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={transition.isPending}
                        onClick={() =>
                          transition.mutate({
                            id: agent.id,
                            action: "enable",
                          })
                        }
                      >
                        Enable
                      </Button>
                    )}
                    {agent.status === "enabled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={transition.isPending}
                        onClick={() =>
                          transition.mutate({
                            id: agent.id,
                            action: "pause",
                          })
                        }
                      >
                        Pause
                      </Button>
                    )}
                    {agent.status !== "archived" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600"
                        disabled={transition.isPending}
                        onClick={() =>
                          transition.mutate({
                            id: agent.id,
                            action: "archive",
                          })
                        }
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {agents.isSuccess && !agentRows.length && (
                <EmptyState
                  title="No AI agents"
                  description="Registered AI agents will appear here."
                />
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="guardrails" className="mt-4">
          <Panel>
            {guardrails.isLoading && (
              <Skeleton className="h-40 w-full" />
            )}
            {guardrails.isError && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(
                  guardrails.error,
                  "Gagal memuatkan guardrails.",
                )}
              </p>
            )}
            <div className="divide-y divide-slate-100">
              {(guardrails.data ?? []).map((rule) => (
                <div key={rule.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">
                      {rule.ruleKey}
                    </p>
                    <StatusBadge
                      status={
                        rule.level === "HARD_BLOCK" ? "critical" : "high"
                      }
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {rule.rule}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {rule.agentId
                      ? `Agent ${rule.agentId.slice(0, 8)}...`
                      : "GLOBAL"}
                  </p>
                </div>
              ))}
              {guardrails.isSuccess &&
                !(guardrails.data ?? []).length && (
                  <EmptyState
                    title="No guardrails"
                    description="AI safety guardrails will appear here."
                  />
                )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <Panel>
            {approvals.isLoading && (
              <Skeleton className="h-40 w-full" />
            )}
            {approvals.isError && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(
                  approvals.error,
                  "Gagal memuatkan approval rules.",
                )}
              </p>
            )}
            <div className="divide-y divide-slate-100">
              {(approvals.data ?? []).map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {rule.actionKey}
                    </p>
                    <p className="text-xs text-slate-400">
                      {rule.agentId
                        ? `Agent ${rule.agentId.slice(0, 8)}...`
                        : "GLOBAL"}
                      {rule.note ? ` - ${rule.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        rule.risk === "HIGH"
                          ? "high"
                          : rule.risk === "MEDIUM"
                            ? "medium"
                            : "low"
                      }
                    />
                    <span
                      className={`text-xs font-semibold ${
                        rule.auto
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {rule.auto ? "AUTO" : "MANUAL"}
                    </span>
                  </div>
                </div>
              ))}
              {approvals.isSuccess &&
                !(approvals.data ?? []).length && (
                  <EmptyState
                    title="No approval rules"
                    description="Rules governing which AI actions need human approval."
                  />
                )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Panel>
            {audit.isLoading && <Skeleton className="h-40 w-full" />}
            {audit.isError && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(audit.error, "Gagal memuatkan audit.")}
              </p>
            )}
            <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
              {(audit.data ?? []).map((item) => (
                <div key={item.id} className="py-2.5">
                  <p className="text-sm text-slate-700">
                    {item.action ?? "AI action"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {fmtDateTime(item.createdAt)}
                    {item.agentId
                      ? ` - agent ${item.agentId.slice(0, 8)}...`
                      : ""}
                  </p>
                </div>
              ))}
              {audit.isSuccess && !(audit.data ?? []).length && (
                <EmptyState
                  title="No audit records"
                  description="AI actions and evaluations will be audited here."
                />
              )}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}