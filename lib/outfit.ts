import { ROLE_WEIGHT, concernSeverity, rescueMakeup, scorePiece, undertoneOf } from "./flattery";
import type { Flattery } from "./flattery";
import { PIECE_LABEL } from "./types";
import type { OutfitScore, PieceRole, PieceScore } from "./types";
import type { SkinMetrics, ToneResult } from "./youcam";

export const BUY_THRESHOLD = 70;

/** Order used to pick the anchor piece other pieces are paired against. */
const ANCHOR_ORDER: PieceRole[] = ["top", "jacket", "bottom"];

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

/**
 * Outfit score = weighted mean of piece scores. Weights come from ROLE_WEIGHT (top 0.5, jacket 0.35,
 * bottom 0.15), normalised over the pieces actually provided so they always sum to 1.
 * The anchor (top, else jacket, else bottom) is passed as pairing context to the other pieces.
 */
export function scoreOutfit(
  pieces: { role: PieceRole; hex: string }[],
  tone: ToneResult,
  metrics: SkinMetrics
): OutfitScore {
  if (!pieces || pieces.length === 0) throw new Error("scoreOutfit needs at least one piece (top, bottom or jacket).");
  const roles = pieces.map((p) => p.role);
  if (new Set(roles).size !== roles.length) throw new Error("scoreOutfit received the same piece role more than once.");

  const anchorRole = ANCHOR_ORDER.find((r) => roles.includes(r))!;
  const anchorHex = pieces.find((p) => p.role === anchorRole)!.hex;
  const totalWeight = pieces.reduce((s, p) => s + ROLE_WEIGHT[p.role], 0);

  const scored: PieceScore[] = ANCHOR_ORDER.flatMap((role) => {
    const p = pieces.find((x) => x.role === role);
    if (!p) return [];
    const s = scorePiece(role, p.hex, tone, metrics, role === anchorRole ? undefined : { topHex: anchorHex });
    return [{ ...s, weight: ROLE_WEIGHT[role] / totalWeight }];
  });

  const score = Math.round(scored.reduce((s, p) => s + p.weight * p.score, 0));
  const out: OutfitScore = {
    score,
    verdict: score >= BUY_THRESHOLD ? "buy" : "fix",
    threshold: BUY_THRESHOLD,
    undertone: undertoneOf(tone),
    concerns: concernSeverity(metrics),
    pieces: scored,
    summary: [],
  };
  out.summary = buildSummary(out);
  return out;
}

/** The most impactful applicable rule for a piece (largest |delta|), or undefined if nothing fired. */
function biggestFactor(p: PieceScore) {
  return p.rules.filter((r) => r.applicable && r.triggered).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
}

function buildSummary(o: OutfitScore): string[] {
  const label = (p: PieceScore) => PIECE_LABEL[p.role].toLowerCase();
  const out: string[] = [];
  out.push(
    `Your outfit scores ${o.score}/100 against a threshold of ${o.threshold}, so we would say ${o.verdict === "buy" ? "buy it" : "fix it first"}.`
  );

  // Piece that costs the outfit the most points relative to a perfect piece.
  const pull = (p: PieceScore) => p.weight * (100 - p.score);
  const dominant = [...o.pieces].sort((a, b) => pull(b) - pull(a))[0];
  out.push(
    o.pieces.length === 1
      ? `The ${label(dominant)} is the only piece, so it sets the whole score (${dominant.score}/100).`
      : `The ${label(dominant)} moved the score most: it scored ${dominant.score}/100 and, at a weight of ${dominant.weight.toFixed(2)}, costs the outfit about ${Math.round(pull(dominant))} points compared with a perfect piece.`
  );

  const factors = o.pieces.map((p) => {
    const f = biggestFactor(p);
    return f ? `${label(p)}: ${f.label.toLowerCase()} (${signed(f.delta)})` : `${label(p)}: no strong rule fired`;
  });
  out.push(`Biggest factor per piece - ${factors.join("; ")}.`);

  const cfPiece = [...o.pieces].filter((p) => p.counterfactuals.length).sort((a, b) => pull(b) - pull(a))[0];
  const cf = cfPiece?.counterfactuals[0];
  if (cfPiece && cf && cf.delta > 0) {
    const newScore = Math.round(o.pieces.reduce((s, p) => s + p.weight * (p === cfPiece ? cf.score : p.score), 0));
    out.push(
      `Swapping the ${label(cfPiece)} for a ${cf.name.toLowerCase()} (${cf.hex}) could lift it by ${signed(cf.delta)} on that piece (${cf.why}), taking the outfit to about ${newScore}.`
    );
  } else {
    out.push(
      o.verdict === "buy"
        ? "Nothing here needs changing; small makeup tweaks can still help."
        : "No alternative colour scored clearly higher, so makeup adjustments are the best lever."
    );
  }
  return out;
}

/** Makeup plan that counters the biggest face-adjacent penalty in the outfit. */
export function rescueMakeupFor(outfit: OutfitScore): { lip: string; blush: string; concealer: string; note: string } {
  const faceFirst = [...outfit.pieces].sort((a, b) => b.weight - a.weight);
  const reasons = faceFirst
    .flatMap((p) => p.reasons.filter((r) => r.penalty > 0).map((r) => ({ ...r, penalty: r.penalty * p.weight })))
    .sort((a, b) => b.penalty - a.penalty);
  const f: Flattery = {
    score: outfit.score,
    reasons: reasons.length ? reasons.slice(0, 2) : (faceFirst[0]?.reasons ?? []),
    undertone: outfit.undertone,
    concerns: outfit.concerns,
  };
  return rescueMakeup(f);
}
