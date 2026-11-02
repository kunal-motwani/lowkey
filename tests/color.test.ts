import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  dominantColor,
  hexToRgb,
  hslToRgb,
  recolorGarment,
  rgbToHex,
  rgbToHsl,
  rgbToLab,
  type RGB,
} from "../lib/color";
import { onBackground, solid } from "./helpers";

describe("colour conversions", () => {
  it("round-trips hex <-> rgb", () => {
    for (const hex of ["#000000", "#ffffff", "#7d8239", "#f0705a", "#1f2f5c"]) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });

  it("clamps and rounds in rgbToHex", () => {
    expect(rgbToHex([-5, 300, 127.6])).toBe("#00ff80");
  });

  it("round-trips rgb <-> hsl within rounding", () => {
    const samples: RGB[] = [
      [125, 130, 57],
      [240, 112, 90],
      [31, 47, 92],
      [200, 200, 200],
      [0, 0, 0],
      [255, 255, 255],
    ];
    for (const rgb of samples) {
      const back = hslToRgb(rgbToHsl(rgb));
      back.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThan(1));
    }
  });

  it("computes known hsl values", () => {
    expect(rgbToHsl([255, 0, 0])).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(rgbToHsl([0, 0, 255]).h).toBeCloseTo(240);
    expect(rgbToHsl([128, 128, 128]).s).toBe(0);
  });

  it("computes known Lab values", () => {
    const white = rgbToLab([255, 255, 255]);
    expect(white.L).toBeCloseTo(100, 0);
    expect(Math.abs(white.a)).toBeLessThan(0.5);
    expect(Math.abs(white.b)).toBeLessThan(0.5);
    expect(rgbToLab([0, 0, 0]).L).toBeCloseTo(0, 1);
    const red = rgbToLab([255, 0, 0]);
    expect(red.a).toBeGreaterThan(70);
    expect(red.L).toBeCloseTo(53.2, 0);
  });
});

describe("dominantColor", () => {
  it("finds the colour of a solid image", async () => {
    const { hex } = await dominantColor(await solid("#7d8239"));
    expect(hex).toBe("#7d8239");
  });

  it("ignores a white background around the garment", async () => {
    const { rgb } = await dominantColor(await onBackground("#1f2f5c", "#ffffff", 400));
    const target = hexToRgb("#1f2f5c");
    rgb.forEach((v, i) => expect(Math.abs(v - target[i])).toBeLessThan(6));
  });

  it("falls back to grey when every pixel is background", async () => {
    const { hex } = await dominantColor(await solid("#ffffff"));
    expect(hex).toBe("#808080");
  });
});

describe("recolorGarment", () => {
  it("shifts hue to the target while keeping the luminance structure", async () => {
    // Horizontal lightness gradient of an olive hue.
    const w = 64,
      h = 16;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const l = 0.3 + (0.4 * x) / (w - 1);
        const [r, g, b] = hslToRgb({ h: 65, s: 0.5, l });
        const i = (y * w + x) * 3;
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
    const src = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer();
    const out = await recolorGarment(src, "#7d8239", "#1f4fa5");
    const { data } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number) => {
      const i = (8 * w + x) * 3;
      return rgbToHsl([data[i], data[i + 1], data[i + 2]]);
    };
    const left = px(2),
      right = px(w - 3);
    // hue moved towards blue, and lighter pixels stay lighter than darker ones
    expect(Math.abs(left.h - rgbToHsl(hexToRgb("#1f4fa5")).h)).toBeLessThan(15);
    expect(right.l).toBeGreaterThan(left.l + 0.15);
  });

  it("leaves white background pixels untouched", async () => {
    const out = await recolorGarment(await onBackground("#7d8239", "#ffffff", 100), "#7d8239", "#1f4fa5");
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(100);
    expect(data[0]).toBeGreaterThan(245);
    const mid = (50 * 100 + 50) * 3;
    expect(data[mid + 2]).toBeGreaterThan(data[mid]);
  });
});
