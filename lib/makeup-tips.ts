import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, rgbToLab } from "./color";
import { undertoneOf } from "./flattery";
import { ROLE_GROUP } from "./types";
import type { MakeupTip, OutfitScore } from "./types";
import type { SkinMetrics, ToneResult } from "./youcam";

const MAX_TIPS = 7;

function hueName(h: number, s: number, l: number): string {
  if (s < 0.15 || l < 0.1 || l > 0.92) return l < 0.25 ? "dark neutral" : l > 0.8 ? "light neutral" : "grey neutral";
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange/coral";
  if (h < 70) return "yellow/mustard";
  if (h < 100) return "olive/yellow-green";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 295) return "purple";
  return "pink/magenta";
}

/** Lighter version of a hex (for a lifting concealer swatch). */
function lighten(hex: string, by: number) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: Math.min(0.9, hsl.l + by) }));
}

/**
 * 4-7 deterministic, brand-free makeup tips. Every tip's `why` cites the metric or garment colour behind it.
 * These are cosmetic colour-theory suggestions, not skincare or medical advice.
 */
export function makeupTips(outfit: OutfitScore, tone: ToneResult, metrics: SkinMetrics): MakeupTip[] {
  const c = outfit.concerns;
  const under = outfit.undertone ?? undertoneOf(tone);
  const skinLab = rgbToLab(hexToRgb(tone.skin_color));
  // Clothing closest to the face drives colour-matching decisions (jewellery/shoes only if nothing else is given).
  const byWeight = [...outfit.pieces].sort((a, b) => b.weight - a.weight);
  const anchor = byWeight.find((p) => ROLE_GROUP[p.role] === "clothing") ?? byWeight[0];
  // Jewellery: prefer pieces worn near the face when choosing the metal to echo.
  const jewelOrder = ["necklace", "earrings", "bracelet", "ring"];
  const jewels = outfit.pieces
    .filter((p) => ROLE_GROUP[p.role] === "jewellery")
    .sort((a, b) => jewelOrder.indexOf(a.role) - jewelOrder.indexOf(b.role));
  const metalPiece = jewels.find((p) => p.metal === "gold" || p.metal === "rose-gold" || p.metal === "silver");
  const warmMetal = metalPiece?.metal === "gold" || metalPiece?.metal === "rose-gold";
  const metalWord = metalPiece?.metal === "rose-gold" ? "rose gold" : metalPiece?.metal;
  const metalWhy = metalPiece ? `your ${metalPiece.role} reads as ${metalWord} (${metalPiece.hex})` : "";
  const boldColour = (p: { hex: string; metal?: string }) => {
    const x = rgbToHsl(hexToRgb(p.hex));
    return p.metal === "dark" || (p.metal === "other" && x.s >= 0.5);
  };
  const boldNecklace = jewels.find((p) => p.role === "necklace" && boldColour(p));
  const colouredEarrings = jewels.find((p) => p.role === "earrings" && p.metal === "other");
  const earringsMetal = jewels.find(
    (p) => p.role === "earrings" && (p.metal === "gold" || p.metal === "rose-gold" || p.metal === "silver")
  );
  const g = anchor ? rgbToHsl(hexToRgb(anchor.hex)) : { h: 0, s: 0, l: 0.5 };
  const family = hueName(g.h, g.s, g.l);
  const garmentDesc = anchor ? `your ${anchor.role} (${anchor.hex}, ${family})` : "your outfit";
  const satRedLike = g.s >= 0.4 && (g.h < 25 || g.h >= 335) && g.l > 0.2 && g.l < 0.85;
  const satPink = g.s >= 0.4 && g.h >= 295 && g.h < 345;
  const satOrange = g.s >= 0.4 && g.h >= 15 && g.h < 45;
  const sallowGarment = g.s >= 0.25 && g.h >= 50 && g.h < 100;
  const isNeutral = g.s < 0.15 || g.l < 0.1 || g.l > 0.92;
  const radiance = metrics.radiance;

  const tips: MakeupTip[] = [];

  // Concealer / colour-correction.
  if (c.darkCircles >= 45) {
    tips.push({
      area: "concealer",
      tip: `Dab a peach or orange-toned corrector on the blue-purple part of the under-eye, then cover with a concealer close to your skin tone.${sallowGarment ? " Take extra care blending because a yellow-green garment can make the area look deeper." : ""} This is a cosmetic colour-theory suggestion, so adjust to taste.`,
      why: `Dark circles read ${Math.round(c.darkCircles)}/100 severity${sallowGarment ? ` and ${garmentDesc} sits in the yellow-green range` : ""}.`,
      shade: "#f2b48f",
    });
  } else {
    tips.push({
      area: "concealer",
      tip: "Use a light-reflecting concealer one shade brighter than your base, only at the inner corners of the eyes, for a fresh look.",
      why: `Dark circles read only ${Math.round(c.darkCircles)}/100 severity, so no colour corrector is needed.`,
      shade: lighten(tone.skin_color, 0.08),
    });
  }

  // Skin prep: redness first.
  if (c.redness >= 45) {
    tips.push({
      area: "skin-prep",
      tip: `Apply a thin layer of green-tinted primer only where skin looks reddest, or neutralise with a light colour corrector, then apply foundation over it.${satRedLike ? " This matters more with a red garment nearby, since the two can amplify each other." : ""}`,
      why: `Redness reads ${Math.round(c.redness)}/100 severity${satRedLike ? ` and ${garmentDesc} is a saturated red` : ""}.`,
      shade: "#c9dfc2",
    });
  }

  // Skin prep: oiliness / dullness.
  const oily = c.oiliness >= 45;
  const dull = c.dullness >= 45;
  if (oily || dull) {
    const bits: string[] = [];
    if (oily)
      bits.push(
        "a mattifying primer on the T-zone and a blotting sheet during the day rather than layering more powder"
      );
    if (dull)
      bits.push(
        "a hydrating prep (a light moisturiser or hydrating mist) before makeup, finished with a subtle luminizer on the high points of the cheeks"
      );
    tips.push({
      area: "skin-prep",
      tip: `Use ${bits.join("; and ")}.`,
      why:
        [
          oily ? `Oiliness reads ${Math.round(c.oiliness)}/100 severity` : "",
          dull
            ? `dullness reads ${Math.round(c.dullness)}/100 severity${radiance != null ? ` (radiance score ${Math.round(radiance)})` : ""}`
            : "",
        ]
          .filter(Boolean)
          .join(" and ") + ".",
    });
  } else {
    tips.push({
      area: "skin-prep",
      tip: "Skin looks balanced, so keep prep light: a thin moisturiser and, if you like, a hint of luminizer on the cheekbones to enhance it.",
      why: `Oiliness (${Math.round(c.oiliness)}/100) and dullness (${Math.round(c.dullness)}/100) severities are both low.`,
    });
  }

  // Base shade by skin lightness.
  const L = skinLab.L;
  const depth = L >= 72 ? "light" : L >= 55 ? "medium" : "deep";
  tips.push({
    area: "base",
    tip: `Choose a base from the ${depth} range with a ${under} undertone, and test it along the jawline in daylight so it blends into your neck.`,
    why: `Your skin tone ${tone.skin_color} has a lightness of L* ${L.toFixed(0)} (${depth}) and a ${under} undertone.`,
    shade: tone.skin_color,
  });

  // Blush: undertone-driven, softened if skin is red or the garment is red-like.
  let blush = under === "warm" ? "#e8997f" : under === "cool" ? "#d98a9c" : "#e09a8e";
  let blushTip = `A ${under === "warm" ? "peach/apricot" : under === "cool" ? "rose/pink" : "soft rose-peach"} blush follows your ${under} undertone.`;
  let blushWhy = `${under} undertone`;
  if (c.redness >= 45 || satRedLike || satOrange) {
    blush = "#d9a08f";
    blushTip = "Choose a muted peach-nude or dusty rose blush and blend it softly so it does not stack red on red.";
    blushWhy = `${c.redness >= 45 ? `redness reads ${Math.round(c.redness)}/100 severity` : ""}${c.redness >= 45 && (satRedLike || satOrange) ? " and " : ""}${satRedLike || satOrange ? `${garmentDesc} is a saturated warm colour` : ""}`;
  } else if (satPink) {
    blush = "#d9a08f";
    blushTip = "Keep blush a soft, slightly warmer nude-rose so it does not compete with the pink garment.";
    blushWhy = `${garmentDesc} is a saturated pink`;
  }
  const strongGarment = c.redness >= 45 || satRedLike || satOrange || satPink;
  if (metalPiece && !strongGarment) {
    blush = warmMetal ? "#e8997f" : "#d98a9c";
    blushTip = warmMetal
      ? `A peach or apricot blush tends to echo your ${metalWord} jewellery and keeps the look cohesive.`
      : `A soft rose-pink blush tends to sit well beside your silver jewellery.`;
    blushWhy = `${metalWhy}, alongside a ${under} undertone`;
  }
  if (boldNecklace) {
    blushTip += " Keep the application light because your necklace is the bold element.";
    blushWhy += `; your necklace (${boldNecklace.hex}) is a bold piece`;
  }
  tips.push({ area: "blush", tip: blushTip, why: blushWhy, shade: blush });

  // Lip: undertone, but never matching/fighting a saturated garment.
  let lip = under === "warm" ? "#c4574a" : under === "cool" ? "#b0405e" : "#bf4f55";
  let lipTip = `A ${under === "warm" ? "warm coral-red or terracotta" : under === "cool" ? "berry or blue-red" : "rosewood or soft red"} lip suits your ${under} undertone.`;
  let lipWhy = `${under} undertone`;
  if (satRedLike || satPink || satOrange) {
    lip = "#b57a72";
    lipTip = "Go for a softer rose-nude lip so your mouth does not compete with the garment colour.";
    lipWhy = `${garmentDesc} is already a strong colour`;
  } else if (!isNeutral && !satRedLike) {
    lipWhy = `${under} undertone, and ${garmentDesc} leaves room for a colour accent`;
  } else {
    lipWhy = `${under} undertone, and ${garmentDesc} is neutral so the lip can carry the colour`;
  }
  if (metalPiece && !(satRedLike || satPink || satOrange)) {
    lip = warmMetal ? "#c4574a" : "#a8405f";
    lipTip = warmMetal
      ? `A warm coral or terracotta lip tends to echo your ${metalWord} jewellery.`
      : "A cooler berry lip tends to pair nicely with your silver jewellery.";
    lipWhy = `${metalWhy}, with a ${under} undertone`;
  }
  tips.push({ area: "lip", tip: lipTip, why: lipWhy, shade: lip });

  // Eyes: liner / shadow tone that pops against the garment (colour-wheel suggestion).
  let liner: string;
  let linerName: string;
  if (isNeutral) {
    liner = under === "cool" ? "#4a3b52" : "#5b3a29";
    linerName = under === "cool" ? "deep plum-grey" : "warm chocolate brown";
  } else if (g.h < 25 || g.h >= 335) {
    liner = "#2f4a3a";
    linerName = "deep forest green";
  } else if (g.h < 70) {
    liner = "#4b3a6b";
    linerName = "deep violet";
  } else if (g.h < 160) {
    liner = "#5a2d4f";
    linerName = "plum or aubergine";
  } else if (g.h < 255) {
    liner = "#9a5b2e";
    linerName = "warm bronze or copper";
  } else if (g.h < 295) {
    liner = "#7a6a2f";
    linerName = "olive-gold";
  } else {
    liner = "#2f4a4a";
    linerName = "deep teal";
  }
  let eyeTip = `Try ${linerName} liner or shadow along the lash line; ${isNeutral ? "with a neutral garment it adds a touch of colour and definition" : `it sits opposite ${family} on the colour wheel, which tends to make the eyes stand out`}.`;
  let eyeWhy = `${garmentDesc} is ${family}; this is a colour-wheel suggestion, not a measured effect.`;
  if (colouredEarrings) {
    liner = under === "cool" ? "#4a3b52" : "#5b3a29";
    eyeTip = `Keep eye makeup soft and neutral, a ${under === "cool" ? "taupe or plum-grey" : "warm brown"} shadow with a thin liner, so it does not fight your coloured earrings.`;
    eyeWhy = `Your earrings (${colouredEarrings.hex}) are a strong colour near the eyes.`;
  } else if (earringsMetal) {
    const w = earringsMetal.metal === "silver" ? "a soft silver-grey" : "a champagne-gold";
    eyeTip += ` A touch of ${w} shimmer on the lid can echo your earrings.`;
    eyeWhy += ` Your earrings read as ${earringsMetal.metal === "rose-gold" ? "rose gold" : earringsMetal.metal} (${earringsMetal.hex}).`;
  }
  tips.push({ area: "eyes", tip: eyeTip, why: eyeWhy, shade: liner });

  // Brows.
  const hair = tone.hair_color;
  const brow = hair ?? (under === "warm" ? "#6b4a32" : under === "cool" ? "#5a4d48" : "#5f4a3b");
  tips.push({
    area: "brows",
    tip: hair
      ? "Fill brows with short hair-like strokes in a shade one step softer than your hair colour so they frame the face without looking heavy."
      : `Fill brows in a soft ${under === "warm" ? "warm brown" : under === "cool" ? "ash taupe" : "neutral brown"} so they frame the face without looking heavy.`,
    why: hair ? `Your detected hair colour is ${hair}.` : `${under} undertone with no hair colour detected.`,
    shade: brow,
  });

  // Keep within 4-7 tips; drop lowest-priority (brows, then eyes) if over the cap.
  return tips.slice(0, MAX_TIPS);
}
