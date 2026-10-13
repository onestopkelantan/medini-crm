import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/hooks/usePrefs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { enhanceImageData, DEFAULT_ENHANCE, type EnhanceParams } from "@/lib/xray-enhance";

/* ============================================================================
 * XrayViewerDialog — lihat X-ray dengan penyesuaian brightness/contrast +
 * SHARPEN (konvolusi unsharp, modul murni lib/xray-enhance — bukan sekadar
 * CSS filter, supaya penajaman benar-benar mempertajam tepi gigi pada
 * sinogram kelabu).
 *
 * Asal gambar: `fileRef` baris imaging (URL http/https atau data:). Editan
 * hanya di canvas — fail asal tidak pernah diubah; "Reset" mengembalikan.
 * ========================================================================== */

interface Props {
  open: boolean;
  onClose: () => void;
  src: string | null;
  title?: string;
}

const SLIDERS: Array<{ key: keyof EnhanceParams; label: string; min: number; max: number }> = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "sharpen", label: "Sharpen", min: 0, max: 200 },
];

export function XrayViewerDialog({ open, onClose, src, title }: Props) {
  const { t } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [params, setParams] = useState<EnhanceParams>({ ...DEFAULT_ENHANCE });
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  /* Muat gambar sekali (atau bila src berubah) ke canvas asal.
 * Reset state di dalam handler async (bukan synchronous di body effect)
 * supaya tiada render berantai. */
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    const reset = { error: false, ready: false };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext("2d")!.drawImage(img, 0, 0);
      setError(reset.error); setReady(true); setParams({ ...DEFAULT_ENHANCE });
    };
    img.onerror = () => { if (!cancelled) setError(true); };
    img.src = src;
    return () => { cancelled = true; };
  }, [open, src]);

  /* Sapukan penyesuaian bila slider bergerak (canvas bekerja dari salinan asal
   * yang disimpan semasa muat — kalau tidak, sharpen atas sharpen = artefak). */
  const originalRef = useRef<ImageData | null>(null);
  useEffect(() => {
    if (open && ready && !originalRef.current) {
      const cv = canvasRef.current!;
      originalRef.current = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height);
    }
  }, [open, ready]);
  useEffect(() => {
    if (!ready || !originalRef.current) return;
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const copy = new ImageData(new Uint8ClampedArray(originalRef.current.data), cv.width, cv.height);
    enhanceImageData(copy, params);
    ctx.putImageData(copy, 0, 0);
  }, [params, ready]);

  const isPristine = params.brightness === 0 && params.contrast === 0 && params.sharpen === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? t("xray.viewerTitle")}</DialogTitle>
          <DialogDescription>{t("xray.viewerDesc")}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("xray.loadError")}
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border bg-black">
            <canvas ref={canvasRef} className="mx-auto max-h-[60vh] w-auto" />
          </div>
        )}

        <div className="space-y-2.5">
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0 text-muted-foreground">{t(`xray.${s.key}`)}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                value={params[s.key]}
                onChange={(e) => setParams((p) => ({ ...p, [s.key]: Number(e.target.value) }))}
                className="h-1.5 flex-1 accent-primary"
                aria-label={t(`xray.${s.key}`)}
              />
              <span className="w-10 text-right font-mono text-xs text-muted-foreground">{params[s.key]}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={isPristine} onClick={() => setParams({ ...DEFAULT_ENHANCE })}>
            {t("xray.reset")}
          </Button>
          <Button size="sm" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default XrayViewerDialog;
