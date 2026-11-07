import { dominantColor, recolorGarment } from "./color";
import { rescueMakeupFor, scoreOutfit } from "./outfit";
import { makeupTips } from "./makeup-tips";
import type { AgentEvent, StepId } from "./steps";
import {
  PIECE_LABEL,
  PIECE_ROLES,
  ROLE_GROUP,
  type AnalysisResult,
  type OutfitScore,
  type PieceRole,
  type PieceScore,
  type TryOnStage,
} from "./types";
import {
  clothesTryOn,
  GARMENT_CATEGORY,
  jewelleryTryOn,
  makeupTryOn,
  shoesTryOn,
  skinAnalysis,
  skinTone,
  type CallInfo,
  type CallOpts,
  type ClothingRole,
  type JewelleryRole,
} from "./youcam";

export type { AgentEvent, StepId } from "./steps";

/** A problem with what the user supplied; the message is safe to show to them. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export interface StylistInput {
  face: Buffer;
  /** Full-body photo including the feet; required for bottoms and shoes. */
  body?: Buffer;
  /** Back of the hand/wrist with fingers visible; required for bracelets and rings. */
  hand?: Buffer;
  pieces: { role: PieceRole; image: Buffer }[];
}

type Emit = (e: AgentEvent) => void;

/** Clothing layering order for the full-length chain (shoes are applied last, on the latest image). */
const LAYER_ORDER: PieceRole[] = ["top", "bottom", "jacket"];
/** Pieces that sit next to the face and so affect skin/colour harmony most. */
const FACE_ADJACENT: PieceRole[] = ["top", "jacket"];

/**
 * ROUGH estimate of YouCam units per live (uncached) call. These are placeholders, not published prices:
 * adjust once real billing is known. Cache hits cost nothing and are excluded.
 */
export const UNITS_PER_CALL: Record<CallInfo["api"], number> = {
  skin: 1,
  tone: 1,
  vto: 1,
  makeup: 1,
  shoes: 1,
  jewellery: 1,
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toBuffer = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1] ?? "", "base64");

export async function runStylist(input: StylistInput, emit: Emit): Promise<AnalysisResult> {
  const { face, body, hand } = input;
  if (!input.pieces.length) throw new InputError("Add at least one piece (clothing, shoes or jewellery).");
  const has = (r: PieceRole) => input.pieces.some((p) => p.role === r);
  if ((has("bottom") || has("shoes")) && !body) {
    throw new InputError("Add a full-body photo (head to feet) to try on bottoms and shoes");
  }
  if ((has("bracelet") || has("ring")) && !hand) {
    throw new InputError("Add a photo of the back of your hand to try on bracelets and rings");
  }
  const pieceImages = new Map<PieceRole, Buffer>(input.pieces.map((p) => [p.role, p.image]));
  const roles = PIECE_ROLES.filter((r) => pieceImages.has(r));
  const clothing = LAYER_ORDER.filter((r) => pieceImages.has(r));

  const errors: string[] = [];
  let units = 0;
  const track = (): CallOpts => ({
    onCall: (i) => {
      if (!i.cached) units += UNITS_PER_CALL[i.api];
    },
  });
  const step = (s: StepId, status: AgentEvent["status"], api?: string, detail?: string) =>
    emit({ step: s, status, ...(api ? { api } : {}), ...(detail ? { detail } : {}) });

  // 1. Perceive: two YouCam analyses on the FACE photo, in parallel
  step("perceive", "running", "AI Skin Analysis + skin tone");
  const [metrics, tone] = await Promise.all([skinAnalysis(face, track()), skinTone(face, track())]);
  step(
    "perceive",
    "done",
    undefined,
    `Skin tone ${tone.skin_color} (${tone.source === "youcam" ? "YouCam Skin Tone API" : "local estimate"}); ${Object.keys(metrics).length} skin metrics`
  );

  // 2. Garment colours
  step("garments", "running", undefined, "k-means on centre pixels");
  const hexes = new Map<PieceRole, string>();
  await Promise.all(roles.map(async (r) => hexes.set(r, (await dominantColor(pieceImages.get(r)!)).hex)));
  step("garments", "done", undefined, roles.map((r) => `${PIECE_LABEL[r]} ${hexes.get(r)}`).join(", "));

  // 3. Score
  step("score", "running", undefined, "Explainable rules per piece");
  const outfit: OutfitScore = scoreOutfit(
    roles.map((r) => ({ role: r, hex: hexes.get(r)! })),
    tone,
    metrics
  );
  step("score", "done", undefined, `Outfit score ${outfit.score}/100`);

  // 4. Decide
  step("decide", "done", undefined, outfit.verdict === "buy" ? "Buy with confidence" : "Below 70 - planning fixes");

  // 5. Try-on. Full-length chain ("outfit"): top -> bottom -> jacket -> shoes, each output feeds the next.
  // Then jewellery close-ups ("closeup"): necklace/earrings on the chest-up image, bracelet/ring on the hand photo.
  const photoNotes: string[] = [];
  if (!body && clothing.length > 0) photoNotes.push("No body photo: chest-up try-on only");
  step("tryon", "running", "AI Clothes / Shoes / Jewellery Virtual Try-On", `${roles.length} piece(s), layered`);
  const stages: TryOnStage[] = [];
  const runStage = async (
    group: "outfit" | "closeup",
    chain: PieceRole[],
    role: PieceRole,
    person: Buffer,
    call: () => Promise<string>
  ): Promise<Buffer> => {
    const label = chain.length === 0 ? PIECE_LABEL[role] : `+ ${PIECE_LABEL[role]}`;
    const worn = [...chain, role];
    try {
      const image = await call();
      stages.push({ label, roles: worn, image, group });
      return toBuffer(image);
    } catch (e) {
      errors.push(`Try-on (${PIECE_LABEL[role]}): ${msg(e)}`);
      stages.push({ label, roles: worn, group });
      return person;
    }
  };

  // Outfit chain on the full-length image (or the face photo when there is no body photo).
  let person: Buffer = body ?? face;
  const outfitChain: PieceRole[] = [];
  const outfitRoles: PieceRole[] = [...clothing, ...(pieceImages.has("shoes") ? (["shoes"] as PieceRole[]) : [])];
  for (const role of outfitRoles) {
    const garment = pieceImages.get(role)!;
    const base = person;
    person = await runStage("outfit", outfitChain, role, base, () =>
      role === "shoes"
        ? shoesTryOn(base, garment, track())
        : clothesTryOn(base, garment, GARMENT_CATEGORY[role as ClothingRole], track())
    );
    outfitChain.push(role);
  }
  const outfitStages = stages.slice();

  // Close-up base: the chest-up try-on image when the outfit chain ran on the face photo, else the plain face photo
  // (no extra paid calls just to build it).
  const lastOutfit = [...outfitStages].reverse().find((s) => s.image);
  const chestUp = !body && lastOutfit?.image ? toBuffer(lastOutfit.image) : face;
  const closeupChain: PieceRole[] = !body && lastOutfit ? [...lastOutfit.roles] : [];
  if (body && clothing.length > 0 && (pieceImages.has("necklace") || pieceImages.has("earrings"))) {
    photoNotes.push("Necklace and earrings are shown on your face photo, not on the clothed try-on");
  }
  let neck: Buffer = chestUp;
  for (const role of ["necklace", "earrings"] as const) {
    if (!pieceImages.has(role)) continue;
    const base = neck;
    const jewel = pieceImages.get(role)!;
    neck = await runStage("closeup", closeupChain, role, base, () => jewelleryTryOn(role, base, jewel, track()));
    closeupChain.push(role);
  }
  // Hand chain: bracelet then ring on the hand photo.
  let handImg: Buffer = hand ?? face;
  const handChain: PieceRole[] = [];
  for (const role of ["bracelet", "ring"] as const) {
    if (!pieceImages.has(role)) continue;
    const base = handImg;
    const jewel = pieceImages.get(role)!;
    handImg = await runStage("closeup", handChain, role, base, () =>
      jewelleryTryOn(role as JewelleryRole, base, jewel, track())
    );
    handChain.push(role);
  }
  const okStages = stages.filter((s) => s.image).length;
  step("tryon", okStages === 0 ? "error" : "done", undefined, `${okStages}/${stages.length} stages rendered`);

  let better: AnalysisResult["better"];
  let rescue: AnalysisResult["rescue"];

  if (outfit.verdict === "fix") {
    // 6. Recolor the weakest face-adjacent piece that has a counterfactual
    step("recolor", "running", "AI Clothes Virtual Try-On", "Re-colouring the weakest piece locally");
    const candidates = outfit.pieces
      .filter((p) => FACE_ADJACENT.includes(p.role) && p.counterfactuals.length > 0)
      .sort((a, b) => a.score - b.score);
    const target: PieceScore | undefined = candidates[0];
    if (!target) {
      step("recolor", "skipped", undefined, "No face-adjacent piece with a better colour");
    } else {
      const cf = [...target.counterfactuals].sort((a, b) => b.score - a.score)[0];
      const b: NonNullable<AnalysisResult["better"]> = {
        role: target.role,
        hex: cf.hex,
        name: cf.name,
        score: cf.score,
      };
      better = b;
      try {
        const recolored = await recolorGarment(pieceImages.get(target.role)!, target.hex, cf.hex);
        b.image = await clothesTryOn(face, recolored, GARMENT_CATEGORY[target.role as ClothingRole], track());
      } catch (e) {
        errors.push(`Recolor try-on: ${msg(e)}`);
      }
      step(
        "recolor",
        b.image ? "done" : "error",
        undefined,
        `${PIECE_LABEL[target.role]} in ${cf.name.toLowerCase()} ${cf.hex} scores ${cf.score}`
      );
    }

    // 7. Rescue: face-adjacent pieces on the face photo, then makeup on top; never aborts the run
    const plan = rescueMakeupFor(outfit);
    step("rescue", "running", "AI Makeup Virtual Try-On", plan.note);
    let rescueBase: Buffer = face;
    try {
      const adj = roles.filter((r) => FACE_ADJACENT.includes(r));
      const last = outfitStages[outfitStages.length - 1];
      if (!body && last?.image) {
        rescueBase = toBuffer(last.image); // the base person was the face photo: reuse the stage image
      } else if (adj.length > 0) {
        let p = face;
        for (const r of adj)
          p = toBuffer(await clothesTryOn(p, pieceImages.get(r)!, GARMENT_CATEGORY[r as ClothingRole], track()));
        rescueBase = p;
      }
    } catch (e) {
      errors.push(`Rescue try-on: ${msg(e)}`);
      rescueBase = face;
    }
    let image: string | undefined;
    try {
      image = await makeupTryOn(rescueBase, plan, track());
    } catch (e) {
      errors.push(`Makeup try-on: ${msg(e)}`);
    }
    rescue = { image, plan, baselineScore: outfit.score };
    step("rescue", image ? "done" : "error", undefined, plan.note);
  } else {
    step("recolor", "skipped");
    step("rescue", "skipped");
  }

  // 8. Makeup tips
  step("tips", "running", undefined, "Matching tips to your skin and the colours");
  let tips: AnalysisResult["makeupTips"] = [];
  try {
    tips = makeupTips(outfit, tone, metrics);
  } catch (e) {
    errors.push(`Makeup tips: ${msg(e)}`);
  }
  step("tips", "done", undefined, `${tips.length} tips`);

  // 9. Explain
  step("explain", "running", process.env.ANTHROPIC_API_KEY ? "Claude" : "templated");
  const explanation = await explain(outfit, better, rescue);
  step("explain", "done");

  return {
    metrics,
    tone,
    outfit,
    stages,
    better,
    rescue,
    makeupTips: tips,
    explanation,
    photoNotes,
    unitsEstimate: units,
    errors,
  };
}

function templated(outfit: OutfitScore, better: AnalysisResult["better"]) {
  const why = outfit.summary[0] ?? "";
  if (outfit.verdict === "buy") return `Good news: ${why} Go ahead and buy it.`;
  const alt = better
    ? `Try the ${PIECE_LABEL[better.role].toLowerCase()} in ${better.name.toLowerCase()} (${better.score}/100 for you), or keep it and use the suggested makeup to rebalance.`
    : "";
  return `${why} ${alt}`.trim();
}

async function explain(
  outfit: OutfitScore,
  better: AnalysisResult["better"],
  rescue: AnalysisResult["rescue"]
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return templated(outfit, better);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 160,
        messages: [
          {
            role: "user",
            content: `Write a friendly 2-sentence verdict for a shopper. Do not invent numbers or claim precise optical effects; use words like "can" and "tends to". Data: ${JSON.stringify(
              {
                score: outfit.score,
                verdict: outfit.verdict,
                summary: outfit.summary,
                pieces: outfit.pieces.map((p) => ({ piece: p.role, group: ROLE_GROUP[p.role], score: p.score })),
                betterColour: better && { piece: better.role, name: better.name, score: better.score },
                makeupNote: rescue?.plan.note,
              }
            )}`,
          },
        ],
      }),
    });
    const j = (await res.json()) as { content?: { text?: string }[] };
    return j.content?.[0]?.text?.trim() || templated(outfit, better);
  } catch {
    return templated(outfit, better);
  }
}
