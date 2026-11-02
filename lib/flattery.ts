import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, rgbToLab } from "./color";
import type { SkinMetrics, ToneResult } from "./youcam";

export type Undertone = "warm" | "cool" | "neutral";

export interface Reason {
  rule: string;
  metric: string; // skin metric that drives it
  penalty: number;
  text: string;
}
export interface Flattery {
  score: number;
  reasons: Reason[]; // top 2
  undertone: Undertone;
  concerns: Record<string, number>; // 0-100 severity (higher = worse)
}

/**
 * Skin Analysis ui_score: higher = healthier. Convert to concern severity (0-100, higher = worse).
 * radiance & moisture are "good" metrics; also inverted so everything reads as severity.
 */
export function concernSeverity(m: SkinMetrics) {
  const inv = (k: string, d = 30) => (m[k] != null ? 100 - m[k] : d);
  return {
    darkCircles: inv("dark_circle_v2"),
    redness: inv("redness"),
    oiliness: inv("oiliness"),
    texture: inv("texture"),
    spots: inv("age_spot"),
    dullness: Math.max(inv("radiance"), inv("moisture") * 0.8),
  };
}

/** Undertone from skin hex: Lab hue angle (b* yellow vs a* red). Skin clusters ~50-65 deg, so the neutral band is wide. */
export function undertoneOf(tone: ToneResult): Undertone {
  const lab = rgbToLab(hexToRgb(tone.skin_color));
  const hueAngle = (Math.atan2(lab.b, lab.a) * 180) / Math.PI; // ~55 neutral; higher = more yellow
  if (hueAngle > 62) return "warm";
  if (hueAngle < 50) return "cool";
  return "neutral";
}

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export function scoreGarment(garmentHex: string, tone: ToneResult, metrics: SkinMetrics): Flattery {
  const c = concernSeverity(metrics);
  const g = rgbToHsl(hexToRgb(garmentHex));
  const gLab = rgbToLab(hexToRgb(garmentHex));
  const sLab = rgbToLab(hexToRgb(tone.skin_color));
  const under = undertoneOf(tone);
  const reasons: Reason[] = [];
  const add = (r: Reason) => r.penalty > 2 && reasons.push(r);

  // 1. Sallow hues (yellow-green / olive / mustard) bounce yellow-green light under the eyes.
  const sallow = clamp(1 - hueDist(g.h, 70) / 45, 0, 1) * clamp(g.s * 1.6, 0.3, 1) * (g.l < 0.78 ? 1 : 0.4);
  add({
    rule: "sallow-reflection",
    metric: "Dark circles",
    penalty: sallow * (12 + c.darkCircles * 0.55),
    text: `Olive/mustard tones throw a yellow-green cast under the eyes, which can make your dark circles (${Math.round(c.darkCircles)}/100) look deeper.`,
  });

  // 2. Saturated reds/pinks/oranges echo redness.
  const warmRed = hueDist(g.h, 5) < 28 || hueDist(g.h, 345) < 20 || hueDist(g.h, 18) < 20 ? 1 : 0;
  add({
    rule: "redness-echo",
    metric: "Redness",
    penalty: warmRed * clamp(g.s * 1.4, 0, 1) * (8 + c.redness * 0.6),
    text: `A saturated red/coral next to the face echoes the redness in your skin (${Math.round(c.redness)}/100) and can amplify it.`,
  });

  // 3. Wash-out: garment lightness close to skin lightness and low chroma contrast, worse with dullness.
  const dL = Math.abs(gLab.L - sLab.L);
  const lowContrast = clamp(1 - dL / 30, 0, 1) * clamp(1 - Math.hypot(gLab.a, gLab.b) / 40, 0.3, 1);
  add({
    rule: "wash-out",
    metric: "Radiance",
    penalty: lowContrast * (8 + c.dullness * 0.6),
    text: `This shade sits close to your skin's lightness and is fairly muted, so with a dullness reading of ${Math.round(c.dullness)}/100 it can wash you out.`,
  });

  // 4. Undertone clash.
  const icy = g.s < 0.5 && g.l > 0.7 && g.h > 170 && g.h < 300;
  const earthy = g.h > 15 && g.h < 70 && g.l < 0.55;
  let clash = 0;
  if (under === "warm" && icy) clash = 1;
  if (under === "cool" && earthy) clash = 1;
  add({
    rule: "undertone-clash",
    metric: "Undertone",
    penalty: clash * 22,
    text: `Your ${under} undertone fights with this ${under === "warm" ? "icy cool pastel" : "warm earthy"} shade, which tends to flatten your complexion.`,
  });

  // Bonus: harmonious (cool skin + jewel/navy, warm skin + warm mid-tones) and good contrast.
  let bonus = 0;
  // Deep blues/jewel tones flatter cool skin most, and are a safe, mildly positive choice on neutral skin.
  if (g.h > 200 && g.h < 280 && g.l < 0.5 && g.s > 0.3) bonus += under === "cool" ? 8 : under === "neutral" ? 4 : 0;
  if (under === "warm" && g.h > 10 && g.h < 50 && g.l > 0.3 && g.l < 0.6 && g.s > 0.25) bonus += 6;
  if (dL > 25 && dL < 55) bonus += 6;

  reasons.sort((a, b) => b.penalty - a.penalty);
  const total = reasons.reduce((s, r) => s + r.penalty, 0);
  const score = Math.round(clamp(84 - total + bonus));
  let top = reasons.slice(0, 2);
  if (!top.length)
    top = [
      {
        rule: "harmony",
        metric: "Undertone",
        penalty: 0,
        text: `This shade works with your ${under} undertone and gives healthy contrast against your skin.`,
      },
    ];
  return { score, reasons: top, undertone: under, concerns: c };
}

/** Candidate colorways: 12 hues at the garment's saturation/lightness, ranked for THIS user. */
export function bestColorways(garmentHex: string, tone: ToneResult, metrics: SkinMetrics, n = 3) {
  const g = rgbToHsl(hexToRgb(garmentHex));
  const cands: { hex: string; score: number; name: string }[] = [];
  const names = ["Red", "Coral", "Amber", "Gold", "Lime", "Green", "Teal", "Cyan", "Blue", "Indigo", "Violet", "Rose"];
  for (let i = 0; i < 12; i++) {
    const h = i * 30;
    if (hueDist(h, g.h) < 20) continue;
    const s = Math.max(0.35, Math.min(0.65, g.s || 0.45));
    const l = Math.max(0.28, Math.min(0.5, g.l));
    const hex = rgbToHex(hslToRgb({ h, s, l }));
    cands.push({ hex, score: scoreGarment(hex, tone, metrics).score, name: names[i] });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, n);
}

/** Makeup that counters the specific problem. */
export function rescueMakeup(f: Flattery) {
  const warm = f.undertone === "warm";
  const top = f.reasons[0]?.rule;
  return {
    lip: warm ? "#c4574a" : "#b0405e",
    blush: top === "redness-echo" ? "#d9a08f" : warm ? "#e0907a" : "#d98a9c",
    // peach/orange-toned corrector neutralizes blue-purple dark circles
    concealer: top === "sallow-reflection" || f.concerns.darkCircles > 45 ? "#f2b48f" : "#f0c9ad",
    note:
      top === "sallow-reflection"
        ? "Peach corrector under the eyes cancels the blue-purple of dark circles so the shirt's cast reads less."
        : top === "redness-echo"
          ? "A soft peach-nude blush keeps cheeks calm instead of stacking red on red."
          : "A warm-berry lip and soft blush add the colour contrast the shirt takes away.",
  };
}
