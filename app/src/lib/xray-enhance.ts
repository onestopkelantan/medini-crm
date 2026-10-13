/**
 * xray-enhance — penyesuaian gambar X-ray di canvas (murni, tanpa DOM).
 *
 * Pemetaan per piksel untuk brightness/contrast + convolution 3x3 untuk
 * sharpen (kernel unsharp standar). Dipisah dari komponen supaya boleh
 * diuji unit (environment node) — komponen hanya menyuntik ImageData.
 *
 * Semua integer dibulatkan sekali di hujung; clamp 0..255 menjaga piksel sah.
 */

export interface EnhanceParams {
  /** -100..100 (0 = tiada perubahan) */
  brightness: number;
  /** -100..100 (0 = tiada perubahan) */
  contrast: number;
  /** 0..200 (0 = tiada penajaman) */
  sharpen: number;
}

export const DEFAULT_ENHANCE: EnhanceParams = { brightness: 0, contrast: 0, sharpen: 0 };

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Faktor kontras dari skala -100..100 → 0..2 (1 = tiada perubahan). */
export function contrastFactor(contrast: number): number {
  const c = Math.max(-100, Math.min(100, contrast));
  return (259 * (c + 255)) / (255 * (259 - c));
}

/** Terapkan brightness + contrast pada ImageData (mutasi in-place). */
export function applyTone(data: Uint8ClampedArray, p: EnhanceParams): void {
  if (p.brightness === 0 && p.contrast === 0) return;
  const cf = contrastFactor(p.contrast);
  const b = p.brightness * 2.55;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (data[i + c]! - 128) * cf + 128 + b;
      data[i + c] = clamp255(v);
    }
  }
}

/**
 * Sharpen: convolution 3x3 kernel unsharp.
 *   [ 0  -a   0 ]
 *   [ -a 1+4a -a ]     a = sharpen/100
 *   [ 0  -a   0 ]
 * Tepi gambar (piksel tanpa jiran penuh) dibiarkan asal — konvolusi pada
 * piksel tepi akan menghasilkan artefak gelap pada sinogram kecil.
 */
export function applySharpen(img: ImageData, p: EnhanceParams): void {
  if (p.sharpen <= 0) return;
  const a = p.sharpen / 100;
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const center = 1 + 4 * a;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const up = ((y - 1) * w + x) * 4 + c;
        const dn = ((y + 1) * w + x) * 4 + c;
        const lf = (y * w + (x - 1)) * 4 + c;
        const rt = (y * w + (x + 1)) * 4 + c;
        const v = center * src[idx + c]! - a * (src[up]! + src[dn]! + src[lf]! + src[rt]!);
        data[idx + c] = clamp255(v);
      }
    }
  }
}

/** Pipeline penuh: tone dulu (murah), kemudian sharpen (mahal). */
export function enhanceImageData(img: ImageData, p: EnhanceParams): ImageData {
  applyTone(img.data, p);
  applySharpen(img, p);
  return img;
}
