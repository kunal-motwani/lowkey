import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, rgbToLab } from "./color";
import type { Counterfactual, PieceRole, PieceScore, Reason, RuleEvidence, RuleResult } from "./types";
import type { SkinMetrics, ToneResult } from "./youcam";

export type { Reason };
export type Undertone = "warm" | "cool" | "neutral";

export interface Flattery {
  score: number;
  reasons: Reason[]; // top 2
  undertone: Undertone;
  concerns: Record<string, number>; // 0-100 severity (higher = worse)
}

/** Starting score before any rule is applied. */
export const BASE_SCORE = 84;

/**
 * Suggested contribution of each piece to the outfit score. Face-adjacent pieces matter most because
 * colour near the face is what reflects onto skin. scoreOutfit normalises these over the pieces provided.
 */
export const ROLE_WEIGHT: Record<PieceRole, number> = { top: 0.5, jacket: 0.35, bottom: 0.15 };

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

const FACE_ROLES: PieceRole[] = ["top", "jacket"];
const ALL_ROLES: PieceRole[] = ["top", "jacket", "bottom"];
const NOT_NEAR_FACE =
  "Not evaluated: trousers/skirts sit far from the face, so their colour has little effect on how your face looks.";

/** Human band for a 0-100 severity. */
export const band = (v: number) => (v >= 55 ? "high" : v >= 35 ? "moderate" : "low");
const sev = (label: string, v: number): RuleEvidence => ({
  label,
  value: `${Math.round(v)}/100 (${band(v)})`,
});
const colourEv = (label: string, hex: string): RuleEvidence => {
  const g = rgbToHsl(hexToRgb(hex));
  return {
    label,
    value: `${hex} (hue ${Math.round(g.h)} deg, saturation ${g.s.toFixed(2)}, lightness ${g.l.toFixed(2)})`,
  };
};

/** Rule id -> metric name used on Reason objects. */
const RULE_METRIC: Record<string, string> = {
  "sallow-reflection": "Dark circles",
  "redness-echo": "Redness",
  "wash-out": "Radiance",
  "undertone-clash": "Undertone",
  "pair-harmony": "Colour pairing",
};

const isNeutralColour = (g: { s: number; l: number }) => g.s < 0.15 || g.l < 0.1 || g.l > 0.92;

/** Evaluate how a garment colour sits next to another piece. Returns a signed delta. */
function pairDelta(hex: string, otherHex: string) {
  const a = rgbToHsl(hexToRgb(hex));
  const b = rgbToHsl(hexToRgb(otherHex));
  const la = rgbToLab(hexToRgb(hex));
  const lb = rgbToLab(hexToRgb(otherHex));
  const dE = Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
  const dL = Math.abs(la.L - lb.L);
  const dh = hueDist(a.h, b.h);
  const neutral = isNeutralColour(a) || isNeutralColour(b);
  let delta = 0;
  let kind: string;
  if (dE < 12) {
    delta = -3;
    kind = "nearly identical";
  } else if (neutral) {
    kind = "neutral pairing";
  } else if (dh >= 50 && dh <= 140 && Math.min(a.s, b.s) > 0.5) {
    delta = -(6 + 6 * clamp((Math.min(a.s, b.s) - 0.5) / 0.5));
    kind = "clashing saturated hues";
  } else if (dh <= 40) {
    delta = dL >= 12 ? 2 : 0;
    kind = "analogous";
  } else if (dh >= 150) {
    delta = Math.min(a.s, b.s) < 0.5 ? 2 : 0;
    kind = "complementary";
  } else {
    kind = "mixed";
  }
  return { delta, kind, dE, dL, dh };
}

interface Core {
  piece: PieceScore;
  undertone: Undertone;
  concerns: ReturnType<typeof concernSeverity>;
}

/** Evaluate every rule for one piece (no counterfactuals). */
function evaluate(
  role: PieceRole,
  hex: string,
  tone: ToneResult,
  metrics: SkinMetrics,
  context?: { topHex?: string }
): Core {
  const c = concernSeverity(metrics);
  const g = rgbToHsl(hexToRgb(hex));
  const gLab = rgbToLab(hexToRgb(hex));
  const sLab = rgbToLab(hexToRgb(tone.skin_color));
  const under = undertoneOf(tone);
  const face = role !== "bottom";
  const rules: RuleResult[] = [];
  const garmentEv = colourEv("Garment colour", hex);

  /** Penalties of 2 points or less are ignored (existing behaviour). */
  const penalty = (
    rule: string,
    label: string,
    appliesTo: PieceRole[],
    applicable: boolean,
    p: number,
    evidence: RuleEvidence[],
    on: string,
    off: string
  ) => {
    const triggered = applicable && p > 2;
    rules.push({
      rule,
      label,
      appliesTo,
      applicable,
      triggered,
      delta: triggered ? -p : 0,
      evidence: applicable ? evidence : [],
      explanation: !applicable ? NOT_NEAR_FACE : triggered ? on : off,
    });
  };
  const bonus = (
    rule: string,
    label: string,
    appliesTo: PieceRole[],
    applicable: boolean,
    b: number,
    evidence: RuleEvidence[],
    on: string,
    off: string,
    naText: string
  ) => {
    const triggered = applicable && b > 0;
    rules.push({
      rule,
      label,
      appliesTo,
      applicable,
      triggered,
      delta: triggered ? b : 0,
      evidence: applicable ? evidence : [],
      explanation: !applicable ? naText : triggered ? on : off,
    });
  };

  // 1. Sallow hues (yellow-green / olive / mustard) can bounce yellow-green light under the eyes.
  const sallowFactor = clamp(1 - hueDist(g.h, 70) / 45, 0, 1) * clamp(g.s * 1.6, 0.3, 1) * (g.l < 0.78 ? 1 : 0.4);
  penalty(
    "sallow-reflection",
    "Yellow-green cast near the eyes",
    FACE_ROLES,
    face,
    sallowFactor * (12 + c.darkCircles * 0.55),
    [sev("Dark circles", c.darkCircles), garmentEv],
    `Olive/mustard tones can throw a yellow-green cast under the eyes, which tends to make your dark circles (${Math.round(c.darkCircles)}/100) look deeper.`,
    "Not triggered: this shade is not in the yellow-green range that tends to add a cast under the eyes."
  );

  // 2. Saturated reds/pinks/oranges echo redness.
  const warmRed = hueDist(g.h, 5) < 28 || hueDist(g.h, 345) < 20 || hueDist(g.h, 18) < 20 ? 1 : 0;
  penalty(
    "redness-echo",
    "Red-on-red echo",
    FACE_ROLES,
    face,
    warmRed * clamp(g.s * 1.4, 0, 1) * (8 + c.redness * 0.6),
    [sev("Redness", c.redness), garmentEv],
    `A saturated red/coral next to the face echoes the redness in your skin (${Math.round(c.redness)}/100) and can amplify it.`,
    "Not triggered: this shade is not a saturated red/coral/pink that tends to echo redness."
  );

  // 3. Wash-out: garment lightness close to skin lightness and low chroma contrast, worse with dullness.
  const dL = Math.abs(gLab.L - sLab.L);
  const lowContrast = clamp(1 - dL / 30, 0, 1) * clamp(1 - Math.hypot(gLab.a, gLab.b) / 40, 0.3, 1);
  penalty(
    "wash-out",
    "Wash-out against your skin",
    FACE_ROLES,
    face,
    lowContrast * (8 + c.dullness * 0.6),
    [
      sev("Dullness", c.dullness),
      {
        label: "Lightness gap (L*)",
        value: `${dL.toFixed(0)} points (garment ${gLab.L.toFixed(0)}, skin ${sLab.L.toFixed(0)})`,
      },
    ],
    `This shade sits close to your skin's lightness and is fairly muted, so with a dullness reading of ${Math.round(c.dullness)}/100 it can wash you out.`,
    "Not triggered: this shade has enough lightness or colour contrast with your skin to avoid a wash-out."
  );

  // 4. Undertone clash (full strength near the face, half strength for bottoms).
  const icy = g.s < 0.5 && g.l > 0.7 && g.h > 170 && g.h < 300;
  const earthy = g.h > 15 && g.h < 70 && g.l < 0.55;
  let clash = 0;
  if (under === "warm" && icy) clash = 1;
  if (under === "cool" && earthy) clash = 1;
  const clashWeight = role === "bottom" ? 0.5 : 1;
  penalty(
    "undertone-clash",
    "Undertone clash",
    ALL_ROLES,
    true,
    clash * 22 * clashWeight,
    [{ label: "Undertone", value: under }, garmentEv],
    `Your ${under} undertone fights with this ${under === "warm" ? "icy cool pastel" : "warm earthy"} shade, which tends to flatten your complexion${role === "bottom" ? " (counted at half strength because it is further from your face)" : ""}.`,
    `Not triggered: this shade does not fight your ${under} undertone.`
  );

  // Bonuses (top / jacket): deep blues/jewel tones flatter cool skin, are a safe mildly positive choice on neutral skin.
  const jewel = g.h > 200 && g.h < 280 && g.l < 0.5 && g.s > 0.3;
  bonus(
    "cool-jewel-harmony",
    "Deep blue / jewel-tone harmony",
    FACE_ROLES,
    face,
    jewel ? (under === "cool" ? 8 : under === "neutral" ? 4 : 0) : 0,
    [{ label: "Undertone", value: under }, garmentEv],
    `Deep blue/jewel tones tend to suit a ${under} undertone and make skin look clearer.`,
    "No bonus: this is not a deep blue/jewel tone on a cool or neutral undertone.",
    NOT_NEAR_FACE
  );
  const warmMid = under === "warm" && g.h > 10 && g.h < 50 && g.l > 0.3 && g.l < 0.6 && g.s > 0.25;
  bonus(
    "warm-mid-tone-harmony",
    "Warm mid-tone harmony",
    FACE_ROLES,
    face,
    warmMid ? 6 : 0,
    [{ label: "Undertone", value: under }, garmentEv],
    "Warm mid-tones tend to echo a warm undertone and look cohesive near the face.",
    "No bonus: this is not a warm mid-tone on a warm undertone.",
    NOT_NEAR_FACE
  );
  const contrastOk = dL > 25 && dL < 55;
  bonus(
    "healthy-contrast",
    "Healthy lightness contrast",
    FACE_ROLES,
    face,
    contrastOk ? 6 : 0,
    [{ label: "Lightness gap (L*)", value: `${dL.toFixed(0)} points (healthy range 25-55)` }],
    "The garment is clearly lighter or darker than your skin, which tends to frame the face rather than blend into it.",
    "No bonus: the lightness gap to your skin is outside the 25-55 range.",
    NOT_NEAR_FACE
  );

  // Bottom-only harmony bonus (half-strength style of the above).
  const neutralBottom = g.s < 0.15;
  const alignedBottom =
    (under === "cool" && jewel) ||
    (under === "warm" && g.h > 10 && g.h < 50 && g.s > 0.25) ||
    (under === "neutral" && g.l < 0.4);
  bonus(
    "bottom-harmony",
    "Bottom harmony",
    ["bottom"],
    role === "bottom",
    neutralBottom || alignedBottom ? 3 : 0,
    [{ label: "Undertone", value: under }, garmentEv],
    neutralBottom
      ? "Neutral bottoms tend to pair comfortably with any undertone."
      : `This bottom sits in a family that tends to agree with your ${under} undertone.`,
    "No bonus: this bottom is neither a neutral nor in a family that particularly echoes your undertone.",
    "Not evaluated: this bonus is only used for bottoms."
  );

  // Pairing with the anchor piece (usually the top).
  const hasCtx = !!context?.topHex && role !== "top";
  if (hasCtx) {
    const p = pairDelta(hex, context!.topHex!);
    const triggered = p.delta !== 0;
    rules.push({
      rule: "pair-harmony",
      label: "Pairing with your top",
      appliesTo: ["jacket", "bottom"],
      applicable: true,
      triggered,
      delta: p.delta,
      evidence: [
        colourEv("This piece", hex),
        colourEv("Top", context!.topHex!),
        { label: "Hue gap", value: `${Math.round(p.dh)} deg` },
        { label: "Lightness gap (L*)", value: `${p.dL.toFixed(0)} points` },
      ],
      explanation:
        p.kind === "nearly identical"
          ? "These two colours are very close, so the outfit can look flat without some contrast (a tonal look is a style choice, so this is a small adjustment)."
          : p.kind === "clashing saturated hues"
            ? "Two strongly saturated hues that are neither neighbours nor opposites on the colour wheel tend to compete for attention, which can look busy."
            : p.delta > 0
              ? p.kind === "analogous"
                ? "Neighbouring hues with some lightness difference tend to look cohesive."
                : "Opposite hues with one of them muted tend to look balanced."
              : `Neutral or ${p.kind} pairing: no strong reason to adjust.`,
    });
  } else {
    rules.push({
      rule: "pair-harmony",
      label: "Pairing with your top",
      appliesTo: ["jacket", "bottom"],
      applicable: false,
      triggered: false,
      delta: 0,
      evidence: [],
      explanation: "Not evaluated: there is no other piece to pair this one with.",
    });
  }

  const total = rules.reduce((s, r) => s + r.delta, 0);
  const score = Math.round(clamp(BASE_SCORE + total));

  const reasons: Reason[] = rules
    .filter((r) => r.applicable && r.triggered && r.delta < 0)
    .map((r) => ({ rule: r.rule, metric: RULE_METRIC[r.rule] ?? r.label, penalty: -r.delta, text: r.explanation }))
    .sort((a, b) => b.penalty - a.penalty)
    .slice(0, 2);
  if (!reasons.length)
    reasons.push({
      rule: "harmony",
      metric: "Undertone",
      penalty: 0,
      text: `This shade works with your ${under} undertone and gives healthy contrast against your skin.`,
    });

  return {
    piece: { role, hex, score, weight: ROLE_WEIGHT[role], base: BASE_SCORE, rules, reasons, counterfactuals: [] },
    undertone: under,
    concerns: c,
  };
}

const COLOUR_NAMES = [
  "Red",
  "Coral",
  "Amber",
  "Gold",
  "Lime",
  "Green",
  "Teal",
  "Cyan",
  "Blue",
  "Indigo",
  "Violet",
  "Rose",
];

/** Candidate colourways: 12 hues at the garment's saturation/lightness (skipping near hues). */
function candidates(hex: string) {
  const g = rgbToHsl(hexToRgb(hex));
  const out: { hex: string; name: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const h = i * 30;
    if (hueDist(h, g.h) < 20) continue;
    const s = Math.max(0.35, Math.min(0.65, g.s || 0.45));
    const l = Math.max(0.28, Math.min(0.5, g.l));
    out.push({ hex: rgbToHex(hslToRgb({ h, s, l })), name: COLOUR_NAMES[i] });
  }
  return out;
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

/** Describe which rules change between the current piece and a candidate colour. */
function whyDiffers(cur: PieceScore, cand: PieceScore): string {
  const parts = cand.rules
    .map((r) => {
      const before = cur.rules.find((x) => x.rule === r.rule);
      return { r, before, d: r.delta - (before?.delta ?? 0) };
    })
    .filter((x) => Math.abs(x.d) >= 1)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 2)
    .map(({ r, before, d }) => {
      const name = r.label.toLowerCase();
      if (d > 0)
        return before && before.delta < 0 ? `avoids the ${name} rule (${signed(d)})` : `adds ${name} (${signed(d)})`;
      return before && before.delta > 0 ? `loses ${name} (${signed(d)})` : `brings in ${name} (${signed(d)})`;
    });
  return parts.length ? parts.join("; ") : "scores similarly; no rule changes by more than a point";
}

/**
 * Score one garment piece. Every rule is evaluated and returned (triggered or not) so the UI can show a full
 * breakdown. score = clamp(base + sum(rule deltas), 0, 100), rounded.
 */
export function scorePiece(
  role: PieceRole,
  hex: string,
  tone: ToneResult,
  metrics: SkinMetrics,
  context?: { topHex?: string }
): PieceScore {
  const { piece } = evaluate(role, hex, tone, metrics, context);
  const counterfactuals: Counterfactual[] = candidates(hex)
    .map((cand) => {
      const s = evaluate(role, cand.hex, tone, metrics, context).piece;
      return {
        hex: cand.hex,
        name: cand.name,
        score: s.score,
        delta: s.score - piece.score,
        why: whyDiffers(piece, s),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { ...piece, counterfactuals };
}

/** Backward-compatible single-garment scoring (treated as a top). */
export function scoreGarment(garmentHex: string, tone: ToneResult, metrics: SkinMetrics): Flattery {
  const { piece, undertone, concerns } = evaluate("top", garmentHex, tone, metrics);
  return { score: piece.score, reasons: piece.reasons, undertone, concerns };
}

/** Candidate colorways ranked for THIS user. */
export function bestColorways(garmentHex: string, tone: ToneResult, metrics: SkinMetrics, n = 3) {
  return candidates(garmentHex)
    .map((c) => ({ ...c, score: scoreGarment(c.hex, tone, metrics).score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
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
