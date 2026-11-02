import sharp from "sharp";
import { rgbToHex } from "./color";

/**
 * Local skin-tone estimate used when the YouCam Skin Tone API is unavailable.
 * Samples the central face region, keeps skin-like pixels (YCbCr gate), takes the per-channel median.
 */
export async function localSkinTone(img: Buffer): Promise<{ skin_color: string }> {
  const meta = await sharp(img).metadata();
  const w = meta.width ?? 400,
    h = meta.height ?? 400;
  const raw = await sharp(img)
    .extract({
      left: Math.floor(w * 0.3),
      top: Math.floor(h * 0.2),
      width: Math.floor(w * 0.4),
      height: Math.floor(h * 0.4),
    })
    .resize(48, 48, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const R: number[] = [],
    G: number[] = [],
    B: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i],
      g = raw[i + 1],
      b = raw[i + 2];
    const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > 60) {
      R.push(r);
      G.push(g);
      B.push(b);
    }
  }
  const med = (a: number[]) => (a.sort((x, y) => x - y), a[Math.floor(a.length / 2)]);
  if (R.length < 30) return { skin_color: "#d9a07c" }; // too few skin pixels: neutral-warm default
  return { skin_color: rgbToHex([med(R), med(G), med(B)]) };
}
