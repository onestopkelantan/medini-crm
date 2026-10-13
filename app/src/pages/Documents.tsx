import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine, Upload, FileText, Image as ImageIcon, FileCheck2, Search, Archive, Eye, Download } from "lucide-react";
import { toast } from "sonner";

import { api, errorMessage, tokenStore } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useScope } from "@/hooks/useScope";
import { PageHeader, Panel, EmptyState, BackLink } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { XrayViewerDialog } from "@/components/clinical/XrayViewerDialog";

/* ============================================================================
 * Documents & X-Ray — 9 Okt 2026. Halaman ini ialah placeholder "Coming Soon"
 * sejak T1 walaupun BACKEND-nya sudah PENUH: upload (S3/Garage, 20MB, MIME
 * putih), senarai + tapisan, presigned URL, arkib, audit. Hari ini UI-nya
 * dipasangkan pada enjin yang ada - tiada kerja backend diperlukan.
 *
 * CIRI:
 *  - Senarai dokumen: carian tajuk/nama fail + tapisan kategori + status
 *  - Muat naik: fail (20MB; PNG/JPEG/WebP/GIF/PDF) + kategori + pesakit
 *    pilihan + tajuk; token auth dibaca dr tokenStore utk FormData
 *  - Pratonton: IMEJ melalui XrayViewerDialog sedia ada (brightness/
 *    contrast/SHARP konvolusi sebenar - penajaman X-ray sebenar, bukan
 *    CSS filter); PDF dalam iframe presigned
 *  - Muat turun (presigned dgn nama fail) + Arkib
 * ========================================================================== */

interface DocumentRow {
  id: string;
  title: string;
  category: string | null;
  patientId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
}
interface PatientRow { id: string; mrn: string; name: string }

const CATEGORIES = ["xray", "cbct", "opg", "photo", "before_after", "consent", "document"] as const;

const categoryIcon = (cat: string | null) => {
  if (cat === "xray" || cat === "cbct" || cat === "opg") return ScanLine;
  if (cat === "photo" || cat === "before_after") return ImageIcon;
  if (cat === "consent") return FileCheck2;
  return FileText;
};

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Documents() {
  const { t } = usePrefs();
  const scope = useScope();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* Borang muat naik */
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("xray");
  const [patientId, setPatientId] = useState("");

  const docs = useQuery({
    queryKey: ["documents", "all"],
    queryFn: () => api.get<DocumentRow[]>("/documents?limit=200"),
  });
  const patients = useQuery({
    queryKey: ["patients", "for-documents"],
    queryFn: () => api.get<PatientRow[]>("/patients?limit=200"),
    staleTime: 60_000,
  });

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("category", category);
      if (title.trim()) fd.append("title", title.trim());
      if (patientId) fd.append("patientId", patientId);
      if (scope.branchId) fd.append("branchId", scope.branchId);
      /* FormData tidak boleh melalui api.post (JSON); fetch terus dgn
       * token akses dr tokenStore (sumber kebenaran tunggal token). */
      return fetch("/api/v1/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenStore.getAccessToken()}` },
        body: fd,
      }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({} as Record<string, unknown>));
          const msg = (e as { error?: { message?: string }; message?: string });
          throw new Error(msg.error?.message ?? msg.message ?? `Upload failed (${r.status})`);
        }
        return r.json();
      });
    },
    onSuccess: () => {
      toast.success(t("doc.uploaded"));
      setUploadOpen(false);
      setFile(null); setTitle(""); setCategory("xray"); setPatientId("");
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("doc.uploadFailed"))),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.patch(`/documents/${id}/status`, { status: "archived", ...scope }),
    onSuccess: () => { toast.success(t("doc.archived")); qc.invalidateQueries({ queryKey: ["documents"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("doc.actionFailed"))),
  });

  /* Pratonton: presigned URL inline utk <img> X-ray atau iframe PDF. */
  const openPreview = async (doc: DocumentRow) => {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    try {
      const d = await api.get<DocumentRow & { url: string }>(`/documents/${doc.id}`);
      setPreviewUrl(d.url);
    } catch (e) {
      toast.error(errorMessage(e, t("doc.previewFailed")));
      setPreviewDoc(null);
    }
  };

  const download = async (doc: DocumentRow) => {
    try {
      const d = await api.get<DocumentRow & { url: string }>(`/documents/${doc.id}?download=1`);
      const a = document.createElement("a");
      a.href = d.url;
      a.download = doc.fileName;
      a.click();
    } catch (e) {
      toast.error(errorMessage(e, t("doc.previewFailed")));
    }
  };

  const rows = useMemo(() => {
    let list = docs.data ?? [];
    if (catFilter !== "all") list = list.filter((d) => d.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.title.toLowerCase().includes(q) || d.fileName.toLowerCase().includes(q));
    }
    return list;
  }, [docs.data, catFilter, search]);

  const patientName = (id: string | null) =>
    id ? (patients.data ?? []).find((p) => p.id === id)?.name ?? id.slice(0, 8) : "—";

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("doc.title")}
        description={t("doc.desc")}
        actions={<BackLink to="/clinical" />}
      />

      {/* Bar kawalan + senarai */}
      <Panel className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("doc.searchPh")}
              className="pl-9"
              aria-label={t("doc.searchPh")}
            />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-44 rounded-xl border border-input bg-card shadow-sm" aria-label={t("doc.catFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("doc.allCats")}</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{t(`doc.cat.${c}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="btn-brand shrink-0" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" aria-hidden /> {t("doc.uploadBtn")}
          </Button>
        </div>

        {docs.isLoading && <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
        {docs.isError && <p className="mt-4 text-sm text-red-600">{errorMessage(docs.error, t("doc.previewFailed"))}</p>}
        {!docs.isLoading && !docs.isError && rows.length === 0 && (
          <div className="mt-4">
            <EmptyState title={t("doc.emptyTitle")} description={t("doc.emptyHint")} />
          </div>
        )}
        {rows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colTitle")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colCat")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colPatient")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colSize")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colDate")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("doc.colStatus")}</th>
                  <th className="px-3 py-2 text-right font-semibold text-foreground">{t("doc.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const Icon = categoryIcon(d.category);
                  return (
                    <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <span className="max-w-56 truncate font-medium text-foreground">{d.title}</span>
                        </div>
                        <p className="max-w-56 truncate text-xs text-muted-foreground">{d.fileName}</p>
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline">{t(`doc.cat.${d.category ?? "document"}`)}</Badge></td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">{patientName(d.patientId)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtSize(d.sizeBytes)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{d.createdAt?.slice(0, 10)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={d.status === "active" ? "default" : "secondary"}>{d.status}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button size="sm" variant="outline" className="mr-1 h-8 px-2 text-xs" onClick={() => openPreview(d)} title={t("doc.preview")} aria-label={t("doc.preview")}>
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button size="sm" variant="outline" className="mr-1 h-8 px-2 text-xs" onClick={() => download(d)} title={t("doc.download")} aria-label={t("doc.download")}>
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        {d.status === "active" && (
                          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => archive.mutate(d.id)} title={t("doc.archive")} aria-label={t("doc.archive")} disabled={archive.isPending}>
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ===== Dialog muat naik ===== */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("doc.uploadBtn")}</DialogTitle>
            <DialogDescription>{t("doc.uploadDesc")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("doc.fileLabel")} *</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="rounded-xl border border-input bg-card"
              />
              <p className="text-xs text-muted-foreground">{t("doc.fileHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">{t("doc.colCat")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full rounded-xl border border-input bg-card shadow-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`doc.cat.${c}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">{t("doc.colPatient")}</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger className="w-full rounded-xl border border-input bg-card shadow-sm"><SelectValue placeholder={t("doc.noPatient")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("doc.noPatient")}</SelectItem>
                    {(patients.data ?? []).slice(0, 100).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} · {p.mrn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("doc.colTitle")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("doc.titlePh")} className="rounded-xl border border-input bg-card" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" className="btn-brand" disabled={upload.isPending || !file}>
                {upload.isPending ? t("common.loading") : t("doc.uploadBtn")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Pratonton: X-ray/imej -> XrayViewerDialog (sharpen sebenar);
             PDF -> iframe presigned ===== */}
      {previewDoc && (previewDoc.mimeType?.startsWith("image/") ?? false) && (
        <XrayViewerDialog
          open={!!previewDoc}
          onClose={() => { setPreviewDoc(null); setPreviewUrl(null); }}
          src={previewUrl}
          title={previewDoc.title}
        />
      )}
      {previewDoc && previewDoc.mimeType === "application/pdf" && (
        <Dialog open onOpenChange={(o) => { if (!o) { setPreviewDoc(null); setPreviewUrl(null); } }}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{previewDoc.title}</DialogTitle>
              <DialogDescription>{previewDoc.fileName}</DialogDescription>
            </DialogHeader>
            {previewUrl ? (
              <iframe src={previewUrl} className="h-[70vh] w-full rounded-lg border border-border" title={previewDoc.title} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
