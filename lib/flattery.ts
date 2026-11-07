import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, rgbToLab } from "./color";
import { ROLE_GROUP } from "./types";
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
export const ROLE_WEIGHT: Record<PieceRole, number> = {
  top: 0.5,
  jacket: 0.35,
  bottom: 0.15,
  shoes: 0.1,
  necklace: 0.1,
  earrings: 0.1,
  bracelet: 0.05,
  ring: 0.05,
};

export type Metal = NonNullable<PieceScore["metal"]>;
const METAL_NAME: Record<Metal, string> = {
  gold: "gold",
  silver: "silver",
  "rose-gold": "rose gold",
  dark: "dark metal",
  other: "other",
};

/**
 * Classify the metal finish of a jewellery piece from its dominant colour. This is a COLOUR heuristic only:
 * it does not detect material and can misjudge gemstone-heavy or heavily lit photos.
 *  - dark: lightness < 0.20
 *  - gold: hue 38-56 deg, saturation >= 0.45, lightness 0.30-0.78
 *  - rose-gold: hue 0-28 or 335-360 deg, saturation 0.20-0.65, lightness 0.45-0.85
 *  - silver (white metal): saturation < 0.15 and lightness >= 0.50, or a faintly blue tint
 *    (hue 180-260, saturation < 0.25) with lightness >= 0.60
 *  - otherwise "other"
 */
export function classifyMetal(hex: string): Metal {
  const g = rgbToHsl(hexToRgb(hex));
  if (g.l < 0.2) return "dark";
  if (g.h >= 38 && g.h <= 56 && g.s >= 0.45 && g.l >= 0.3 && g.l <= 0.78) return "gold";
  if ((g.h <= 28 || g.h >= 335) && g.s >= 0.2 && g.s <= 0.65 && g.l >= 0.45 && g.l <= 0.85) return "rose-gold";
  if (g.s < 0.15 && g.l >= 0.5) return "silver";
  if (g.h >= 180 && g.h <= 260 && g.s < 0.25 && g.l >= 0.6) return "silver";
  return "other";
}

/** Optional context for a piece: the anchor garment colour and every OTHER piece in the outfit. */
export interface PieceContext {
  topHex?: string;
  others?: { role: PieceRole; hex: string }[];
}

/** Representative colourways offered as counterfactuals for shoes and jewellery. */
const SHOE_CANDIDATES = [
  { hex: "#1c1c1c", name: "Black" },
  { hex: "#f2f0ea", name: "White" },
  { hex: "#b08968", name: "Tan" },
  { hex: "#5c4033", name: "Brown" },
  { hex: "#1f2f5c", name: "Navy" },
  { hex: "#8a8a8a", name: "Grey" },
  { hex: "#6d2332", name: "Burgundy" },
];
const METAL_CANDIDATES = [
  { hex: "#c9a227", name: "Gold" },
  { hex: "#c0c0c0", name: "Silver" },
  { hex: "#b76e79", name: "Rose gold" },
];

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
const CLASH_ROLES: PieceRole[] = ["top", "jacket", "bottom", "shoes", "necklace", "earrings"];
const JEWELLERY_ROLES: PieceRole[] = ["necklace", "earrings", "bracelet", "ring"];
const NOT_NEAR_FACE =
  "Not evaluated: trousers/skirts sit far from the face, so their colour has little effect on how your face looks.";
const NOT_NEAR_FACE_SHOES =
  "Not evaluated: shoes sit far from the face, so their colour has little effect on how your face looks.";
const NOT_NEAR_FACE_JEWELLERY =
  "Not evaluated: jewellery is small, so its colour has little effect on how your skin looks; its metal and stone colour are judged by their own rules instead.";

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
  "shoe-harmony": "Shoe harmony",
  "metal-undertone-match": "Metal vs undertone",
  "jewellery-vs-neckline": "Metal vs top colour",
  "accent-balance": "Accent balance",
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
function evaluate(role: PieceRole, hex: string, tone: ToneResult, metrics: SkinMetrics, context?: PieceContext): Core {
  const c = concernSeverity(metrics);
  const g = rgbToHsl(hexToRgb(hex));
  const gLab = rgbToLab(hexToRgb(hex));
  const sLab = rgbToLab(hexToRgb(tone.skin_color));
  const under = undertoneOf(tone);
  const face = role === "top" || role === "jacket";
  const jewellery = ROLE_GROUP[role] === "jewellery";
  const isClothing = ROLE_GROUP[role] === "clothing";
  const metal = jewellery ? classifyMetal(hex) : undefined;
  const others = (context?.others ?? []).filter((o) => o.role !== role);
  const naText = role === "shoes" ? NOT_NEAR_FACE_SHOES : jewellery ? NOT_NEAR_FACE_JEWELLERY : NOT_NEAR_FACE;
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
    off: string,
    na: string = naText
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
      explanation: !applicable ? na : triggered ? on : off,
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
  // Half strength for pieces far from the face; jewellery only counts when it is a strongly coloured stone.
  const stoneLike = metal === "other" && g.s >= 0.55;
  const clashApplicable = !jewellery || ((role === "necklace" || role === "earrings") && stoneLike);
  const clashWeight = role === "bottom" || role === "shoes" || jewellery ? 0.5 : 1;
  const farNote =
    role === "bottom" || role === "shoes"
      ? " (counted at half strength because it is further from your face)"
      : jewellery
        ? " (counted at half strength because it is a small accent)"
        : "";
  penalty(
    "undertone-clash",
    "Undertone clash",
    CLASH_ROLES,
    clashApplicable,
    clash * 22 * clashWeight,
    [{ label: "Undertone", value: under }, garmentEv],
    `Your ${under} undertone fights with this ${under === "warm" ? "icy cool pastel" : "warm earthy"} shade, which tends to flatten your complexion${farNote}.`,
    `Not triggered: this shade does not fight your ${under} undertone.`,
    jewellery
      ? "Not evaluated: this is a metal finish or a hand piece, not a strongly coloured stone near the face, so undertone clash is skipped."
      : naText
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
    naText
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
    naText
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
    naText
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
  if (!isClothing) {
    // Shoes and jewellery have their own pairing rules below.
  } else if (hasCtx) {
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

  // ---- Shoes ----
  if (role === "shoes") {
    const clothing = others
      .filter((o) => ROLE_GROUP[o.role] === "clothing")
      .map((o) => ({ ...o, ...rgbToHsl(hexToRgb(o.hex)) }));
    const hasTop = clothing.some((o) => o.role === "top");
    const hasBottom = clothing.some((o) => o.role === "bottom");
    const neutralShoe = isNeutralColour(g);
    const strongShoe = !neutralShoe && g.s >= 0.5;
    const colourful = clothing.filter((o) => !isNeutralColour(o));
    const match = colourful.find((o) => hueDist(o.h, g.h) <= 30);
    const competing = colourful.filter((o) => o.s >= 0.5 && hueDist(o.h, g.h) >= 50).sort((a, b) => b.s - a.s)[0];
    let d = 0;
    let text = "Muted or mid-saturation shoes rarely compete with the rest of the outfit.";
    if (neutralShoe) text = "Neutral shoes are a safe choice with almost any outfit.";
    else if (strongShoe && match) {
      d = 3;
      text = `Saturated shoes that echo the ${PIECE_NAME[match.role]} hue tend to look intentional and cohesive.`;
    } else if (strongShoe && competing) {
      d = -(5 + 3 * clamp((Math.min(g.s, competing.s) - 0.5) / 0.5));
      text = `Saturated shoes next to a saturated ${PIECE_NAME[competing.role]} in a different hue are two competing accents, which tends to look busy.`;
    } else if (strongShoe) {
      d = 2;
      text =
        "The shoes are the single colour accent in an otherwise quiet outfit, which tends to read as a deliberate pop of colour.";
    }
    const hasClothing = clothing.length > 0;
    rules.push({
      rule: "shoe-harmony",
      label: "Shoe harmony with the outfit",
      appliesTo: ["shoes"],
      applicable: hasClothing,
      triggered: hasClothing && d !== 0,
      delta: hasClothing ? d : 0,
      evidence: hasClothing
        ? [colourEv("Shoes", hex), ...clothing.map((o) => colourEv(PIECE_NAME[o.role], o.hex))]
        : [],
      explanation: hasClothing ? text : "Not evaluated: there is no clothing piece to compare the shoes with.",
    });
    const earthyShoe = g.h >= 15 && g.h <= 50 && g.s < 0.65 && g.l < 0.6;
    const tie = neutralShoe || earthyShoe;
    const tieOk = hasTop && hasBottom;
    rules.push({
      rule: "shoe-neutral-tie",
      label: "Neutral or earthy shoes tie the outfit together",
      appliesTo: ["shoes"],
      applicable: tieOk,
      triggered: tieOk && tie,
      delta: tieOk && tie ? 2 : 0,
      evidence: tieOk ? [colourEv("Shoes", hex)] : [],
      explanation: !tieOk
        ? "Not evaluated: this needs both a top and a bottom for the shoes to tie together."
        : tie
          ? "Neutral or earthy shoes tend to bridge the top and the bottom, so the outfit reads as one look."
          : "No bonus: these shoes are a distinct colour rather than a neutral or earthy tone that bridges top and bottom.",
    });
  }

  // ---- Jewellery ----
  if (jewellery && metal) {
    const recognised = metal === "gold" || metal === "silver" || metal === "rose-gold";
    const mName = METAL_NAME[metal];
    let md = 0;
    if (recognised) {
      if (under === "neutral") md = 3;
      else if (under === "warm") md = metal === "gold" ? 4 : metal === "rose-gold" ? 3 : -5;
      else md = metal === "silver" ? 4 : metal === "rose-gold" ? -2 : -5;
    }
    rules.push({
      rule: "metal-undertone-match",
      label: "Metal and undertone match",
      appliesTo: JEWELLERY_ROLES,
      applicable: recognised,
      triggered: recognised && md !== 0,
      delta: md,
      evidence: [
        { label: "Undertone", value: under },
        { label: "Detected metal", value: `${mName} (${hex})` },
      ],
      explanation: !recognised
        ? "Not evaluated: the colour does not read as gold, silver or rose gold (it may be a dark finish or a coloured stone), so the metal guideline is skipped."
        : under === "neutral"
          ? `A neutral undertone is usually comfortable with any metal, so ${mName} earns only a small bonus.`
          : md > 0
            ? `A common styling guideline is that ${mName} tends to flatter a ${under} undertone.`
            : `A common styling guideline pairs ${under} undertones with ${under === "warm" ? "gold or rose gold" : "silver"}, so ${mName} tends to read slightly less harmonious here. This is a guideline, not a law, and many people wear it well.`,
    });

    if (role === "necklace" || role === "earrings") {
      const t = context?.topHex ? rgbToHsl(hexToRgb(context.topHex)) : undefined;
      const applicable = recognised && !!t;
      let jd = 0;
      let jtext = "No strong pairing effect between this metal and the top colour.";
      if (t && context?.topHex) {
        const tLab = rgbToLab(hexToRgb(context.topHex));
        const lGap = Math.abs(tLab.L - gLab.L);
        const good =
          metal === "gold"
            ? t.l < 0.5 && (t.s < 0.15 || (t.h >= 50 && t.h <= 280))
            : metal === "silver"
              ? t.l < 0.6 && (t.s < 0.15 || (t.h >= 170 && t.h <= 300 && t.s > 0.3))
              : t.l < 0.55 && (t.s < 0.25 || (t.h >= 180 && t.h <= 300));
        if (lGap < 12) {
          jd = -3;
          jtext = `${mName} is close in lightness to the top, so it tends to blend in rather than stand out (a tonal look is a style choice, so this is small).`;
        } else if (good) {
          jd = 3;
          jtext = `${mName} tends to read clearly against this deeper or cooler top colour.`;
        }
      }
      rules.push({
        rule: "jewellery-vs-neckline",
        label: "Metal against your top colour",
        appliesTo: ["necklace", "earrings"],
        applicable,
        triggered: applicable && jd !== 0,
        delta: applicable ? jd : 0,
        evidence: applicable ? [colourEv("Metal", hex), colourEv("Top", context!.topHex!)] : [],
        explanation: applicable
          ? jtext
          : recognised
            ? "Not evaluated: there is no clothing piece to compare the metal with."
            : "Not evaluated: the colour does not read as gold, silver or rose gold.",
      });
    } else {
      rules.push({
        rule: "jewellery-vs-neckline",
        label: "Metal against your top colour",
        appliesTo: ["necklace", "earrings"],
        applicable: false,
        triggered: false,
        delta: 0,
        evidence: [],
        explanation: "Not evaluated: this rule is only used for pieces worn near the neckline (necklace, earrings).",
      });
    }

    if (role === "bracelet" || role === "ring") {
      const isAccent = (r: PieceRole, h: string) => {
        const x = rgbToHsl(hexToRgb(h));
        return !isNeutralColour(x) && x.s >= 0.5 && (ROLE_GROUP[r] !== "jewellery" || classifyMetal(h) === "other");
      };
      const pool = [
        { role, hex },
        ...others.filter((o) => o.role === "shoes" || ROLE_GROUP[o.role] === "jewellery"),
      ].filter((o) => isAccent(o.role, o.hex));
      const clusters: number[] = [];
      for (const o of pool) {
        const h = rgbToHsl(hexToRgb(o.hex)).h;
        if (!clusters.some((c) => hueDist(c, h) < 40)) clusters.push(h);
      }
      const selfAccent = isAccent(role, hex);
      const over = clusters.length >= 3;
      rules.push({
        rule: "accent-balance",
        label: "Accent balance across jewellery and shoes",
        appliesTo: ["bracelet", "ring"],
        applicable: true,
        triggered: over && selfAccent,
        delta: over && selfAccent ? -3 : 0,
        evidence: [{ label: "Competing colour accents", value: `${clusters.length} (more than 2 can look busy)` }],
        explanation: over
          ? selfAccent
            ? "Note: with this piece there are three or more differently coloured accents across your jewellery and shoes, which tends to look busy. Small adjustment."
            : "Note: your jewellery and shoes already carry three or more differently coloured accents, but this piece is a plain metal so it is not penalised."
          : "No more than two competing colour accents across your jewellery and shoes.",
      });
    } else {
      rules.push({
        rule: "accent-balance",
        label: "Accent balance across jewellery and shoes",
        appliesTo: ["bracelet", "ring"],
        applicable: false,
        triggered: false,
        delta: 0,
        evidence: [],
        explanation: "Not evaluated: accent balance is checked on the bracelet and ring only.",
      });
    }
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
      text: isClothing
        ? `This shade works with your ${under} undertone and gives healthy contrast against your skin.`
        : `Nothing about this ${PIECE_NAME[role]} counts against your ${under} undertone or the rest of the outfit.`,
    });

  return {
    piece: {
      role,
      hex,
      score,
      weight: ROLE_WEIGHT[role],
      base: BASE_SCORE,
      ...(metal ? { metal } : {}),
      rules,
      reasons,
      counterfactuals: [],
    },
    undertone: under,
    concerns: c,
  };
}

const PIECE_NAME: Record<PieceRole, string> = {
  top: "top",
  bottom: "bottom",
  jacket: "jacket",
  shoes: "shoes",
  necklace: "necklace",
  earrings: "earrings",
  bracelet: "bracelet",
  ring: "ring",
};

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
  context?: PieceContext
): PieceScore {
  const { piece } = evaluate(role, hex, tone, metrics, context);
  const group = ROLE_GROUP[role];
  const pool =
    group === "clothing"
      ? candidates(hex)
      : group === "footwear"
        ? SHOE_CANDIDATES.filter((c) => {
            const a = rgbToLab(hexToRgb(c.hex));
            const b = rgbToLab(hexToRgb(hex));
            return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b) >= 10;
          })
        : METAL_CANDIDATES.filter((c) => classifyMetal(c.hex) !== classifyMetal(hex));
  const counterfactuals: Counterfactual[] = pool
    .map((cand) => {
      const s = evaluate(role, cand.hex, tone, metrics, context).piece;
      const why = whyDiffers(piece, s);
      return {
        hex: cand.hex,
        name: cand.name,
        score: s.score,
        delta: s.score - piece.score,
        why: group === "jewellery" ? `A ${cand.name.toLowerCase()} finish ${why}` : why,
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
