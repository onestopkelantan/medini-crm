import { usePrefs } from "@/hooks/usePrefs";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cpu, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * AiModelStatusCard — sama ada AI sudah boleh menjawab, dan jika tidak, apa
 * yang perlu disediakan.
 *
 * Paparan STATUS sahaja. Kunci API tidak pernah sampai ke pelayar (governance
 * G9: nilai rahsia tidak disimpan atau dipaparkan). Operator nampak endpoint
 * dan nama pemboleh ubah, cukup untuk tahu siapa perlu hubungi.
 */

export interface AiModelStatus {
  configured: boolean;
  endpointHost: string;
  model: string;
  keySource: "MINIMAX_API_KEY" | "AI_PROVIDER_API_KEY" | "none";
  statusLabel: string;
  guidance: string;
}

/* Internal: only this card consumes it. Kept out of the module's exports so
 * the file stays component-only (react-refresh requirement). */
function useAiModelStatus() {
  return useQuery({
    queryKey: ["ai", "whatsapp-model"],
    queryFn: () => api.get<AiModelStatus>("/ai/whatsapp-model"),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function AiModelStatusCard({ compact = false }: { compact?: boolean }) {
  const { t } = usePrefs();
  const query = useAiModelStatus();

  if (query.isLoading) {
    return <Skeleton className={compact ? "h-14 w-full" : "h-24 w-full"} />;
  }

  /* A failure here must never block the prompt editor — the operator can still
   * write and save prompts; only the model test is unavailable. */
  if (query.isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
        <Cpu className="h-3.5 w-3.5 shrink-0" />
        <span>{t("ai.modelUnreadable")}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 rounded-lg"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  const status = query.data;
  if (!status) return null;

  const ok = status.configured;

  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (ok
          ? "border-border bg-accent/60"
          : "border-amber-300 bg-amber-50")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        )}

        <span
          className={
            "text-sm font-medium " + (ok ? "text-teal-900" : "text-amber-900")
          }
        >
          Model AI: {status.statusLabel}
        </span>

        <span className="rounded-md bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {status.model}
        </span>

        <span className="rounded-md bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {status.endpointHost}
        </span>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 rounded-lg"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={"h-3 w-3" + (query.isFetching ? " animate-spin" : "")}
          />
        </Button>
      </div>

      {!compact && (
        <p
          className={
            "mt-1.5 text-xs " + (ok ? "text-foreground" : "text-amber-900")
          }
        >
          {status.guidance}
        </p>
      )}

      {!ok && (
        <p className="mt-1 font-mono text-[11px] text-amber-800">
          Pemboleh ubah: {status.keySource === "none" ? "MINIMAX_API_KEY" : status.keySource}
        </p>
      )}
    </div>
  );
}
