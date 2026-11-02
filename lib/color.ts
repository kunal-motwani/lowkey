import sharp from "sharp";

export type RGB = [number, number, number];
export interface Lab { L: number; a: number; b: number }
export interface Hsl { h: number; s: number; l: number }

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const rgbToHex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export function rgbToLab([r, g, b]: RGB): Lab {
  const f = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (B * 0.9505 + G * 0.1192 + R * 0.0193) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return { L: 116 * t(Y) - 16, a: 500 * (t(X) - t(Y)), b: 200 * (t(Y) - t(Z)) };
}

export function rgbToHsl([r, g, b]: RGB): Hsl {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Dominant garment color: k-means on center-region pixels, ignoring near-white / near-black background. */
export async function dominantColor(img: Buffer, k = 4): Promise<{ hex: string; rgb: RGB }> {
  const meta = await sharp(img).metadata();
  const w = meta.width ?? 200, h = meta.height ?? 200;
  const crop = await sharp(img)
    .extract({ left: Math.floor(w * 0.25), top: Math.floor(h * 0.25), width: Math.floor(w * 0.5), height: Math.floor(h * 0.5) })
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const px: RGB[] = [];
  for (let i = 0; i < crop.length; i += 3) {
    const p: RGB = [crop[i], crop[i + 1], crop[i + 2]];
    const mx = Math.max(...p), mn = Math.min(...p);
    if (mn > 235) continue; // near-white backdrop
    if (mx < 18) continue; // near-black
    px.push(p);
  }
  if (!px.length) return { hex: "#808080", rgb: [128, 128, 128] };
  let cent: RGB[] = Array.from({ length: k }, (_, i) => px[Math.floor((i * px.length) / k)]);
  let counts: number[] = [];
  for (let it = 0; it < 12; it++) {
    const sums = cent.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cent.forEach((c, i) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++;
    }
    counts = sums.map((s) => s[3]);
    cent = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[i]));
  }
  const best = counts.indexOf(Math.max(...counts));
  const rgb = cent[best].map(Math.round) as RGB;
  return { hex: rgbToHex(rgb), rgb };
}

/**
 * Recolor a garment image by shifting hue (preserves shading/luminance).
 * Only pixels that are "garment-like" (saturated enough or mid-lightness) are shifted,
 * so skin/background stay put on flat-lay product shots.
 */
export async function recolorGarment(img: Buffer, fromHex: string, toHex: string): Promise<Buffer> {
  const from = rgbToHsl(hexToRgb(fromHex)), to = rgbToHsl(hexToRgb(toHex));
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const sRatio = from.s > 0.05 ? to.s / from.s : 1;
  for (let i = 0; i < data.length; i += 3) {
    const hsl = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
    let dh = Math.abs(hsl.h - from.h);
    dh = Math.min(dh, 360 - dh);
    if (hsl.l > 0.93 || hsl.l < 0.05) continue; // background / deep shadow
    if (from.s > 0.12 && (dh > 40 || hsl.s < 0.08)) continue; // not the garment hue
    const nl = Math.max(0, Math.min(1, hsl.l + (to.l - from.l) * 0.6));
    const ns = Math.max(0, Math.min(1, hsl.s * (from.s > 0.05 ? sRatio : 1) + (from.s <= 0.05 ? to.s * 0.8 : 0)));
    const [r, g, b] = hslToRgb({ h: to.h, s: ns, l: nl });
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
