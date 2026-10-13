import { describe, it, expect } from "vitest";
import {
  clamp255,
  contrastFactor,
  applyTone,
  enhanceImageData,
  DEFAULT_ENHANCE,
} from "@/lib/xray-enhance";

/* ImageData tiruan (node tiada DOM): cukup shape {width,height,data}. */
function fakeImage(width: number, height: number, fill: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill; data[i + 1] = fill; data[i + 2] = fill; data[i + 3] = 255;
  }
  return { width, height, data, colorSpace: "srgb" } as unknown as ImageData;
}

describe("clamp255", () => {
  it("menghadkan ke 0..255 dan membundarkan", () => {
    expect(clamp255(-20)).toBe(0);
    expect(clamp255(300)).toBe(255);
    expect(clamp255(127.6)).toBe(128);
  });
});

describe("contrastFactor", () => {
  it("0 = tiada perubahan (1.0)", () => {
    expect(contrastFactor(0)).toBeCloseTo(1.0);
  });
  it("positif > 1, negatif < 1, dihadkan", () => {
    expect(contrastFactor(50)).toBeGreaterThan(1);
    expect(contrastFactor(-50)).toBeLessThan(1);
    expect(contrastFactor(999)).toBe(contrastFactor(100));
  });
});

describe("applyTone", () => {
  it("brightness +40 mencerahkan piksel neutral", () => {
    const img = fakeImage(1, 1, 128);
    applyTone(img.data, { brightness: 40, contrast: 0, sharpen: 0 });
    expect(img.data[0]).toBeGreaterThan(128);
  });
  it("param sifar = tiada perubahan", () => {
    const img = fakeImage(1, 1, 90);
    applyTone(img.data, DEFAULT_ENHANCE);
    expect(img.data[0]).toBe(90);
  });
  it("alpha tidak disentuh", () => {
    const img = fakeImage(1, 1, 100);
    applyTone(img.data, { brightness: 50, contrast: 50, sharpen: 0 });
    expect(img.data[3]).toBe(255);
  });
});

describe("enhanceImageData, sharpen (kernel unsharp)", () => {
  it("bintik terang di tengah gelap makin tajam (nilai tengah naik)", () => {
    const img = fakeImage(3, 3, 100);
    const mid = (1 * 3 + 1) * 4;
    img.data[mid] = 200; img.data[mid + 1] = 200; img.data[mid + 2] = 200;
    const before = img.data[mid];
    enhanceImageData(img, { brightness: 0, contrast: 0, sharpen: 100 });
    expect(img.data[mid]).toBeGreaterThan(before);
  });
  it("sharpen 0 = piksel tidak bergerak", () => {
    const img = fakeImage(5, 5, 150);
    const copy = new Uint8ClampedArray(img.data);
    enhanceImageData(img, DEFAULT_ENHANCE);
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });
  it("gambar rata kekal rata (sharpen pada rata = identity)", () => {
    const img = fakeImage(4, 4, 120);
    enhanceImageData(img, { brightness: 0, contrast: 0, sharpen: 80 });
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(120);
    }
  });
});
