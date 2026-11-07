/**
 * Shared contract for the multi-piece outfit pipeline, explainable scoring, makeup tips and photo checks.
 * Engine, pipeline, capture and UI code are written against these types; change them only deliberately.
 */
import type { SkinMetrics, ToneResult } from "./youcam";

/* ---------- Outfit input ---------- */

export type PieceRole = "top" | "bottom" | "jacket" | "shoes" | "necklace" | "earrings" | "bracelet" | "ring";
export const PIECE_ROLES: PieceRole[] = [
  "top",
  "bottom",
  "jacket",
  "shoes",
  "necklace",
  "earrings",
  "bracelet",
  "ring",
];
export const PIECE_LABEL: Record<PieceRole, string> = {
  top: "Top",
  bottom: "Bottom",
  jacket: "Jacket",
  shoes: "Shoes",
  necklace: "Necklace",
  earrings: "Earrings",
  bracelet: "Bracelet",
  ring: "Ring",
};

export type PieceGroup = "clothing" | "footwear" | "jewellery";
export const ROLE_GROUP: Record<PieceRole, PieceGroup> = {
  top: "clothing",
  bottom: "clothing",
  jacket: "clothing",
  shoes: "footwear",
  necklace: "jewellery",
  earrings: "jewellery",
  bracelet: "jewellery",
  ring: "jewellery",
};

/** Which user photo each role is tried on. `face` = the close-up (chest-up, neck visible), `body` = full length. */
export type SourcePhoto = "face" | "body" | "hand";
export const ROLE_PHOTO: Record<PieceRole, SourcePhoto> = {
  top: "face", // chest-up; the full-body photo is used instead when provided
  jacket: "face", // same as top
  bottom: "body",
  shoes: "body",
  necklace: "face",
  earrings: "face",
  bracelet: "hand",
  ring: "hand",
};

/** Roles that REQUIRE a given photo (the UI and the route reject the request otherwise). */
export const ROLE_REQUIRES: Partial<Record<PieceRole, SourcePhoto>> = {
  bottom: "body",
  shoes: "body",
  bracelet: "hand",
  ring: "hand",
};

/**
 * POST /api/analyze multipart fields:
 *  - face: File (close-up face/shoulders with neck visible, required)   | sampleFace: string (sample file name)
 *  - body: File (full body incl. feet, optional; required for bottom/shoes)
 *  - hand: File (back of the hand/wrist, fingers visible, optional; required for bracelet/ring)
 *  - for each role in PIECE_ROLES: `<role>` File | `<role>Url` string | `sample<Role>` string (e.g. sampleTop, sampleEarrings)
 *  - at least one piece must be present
 */

/* ---------- Explainable scoring ---------- */

export interface RuleEvidence {
  label: string; // e.g. "Dark circles"
  value: string; // e.g. "62/100 (high)"
}

export interface RuleResult {
  rule: string; // stable id, e.g. "sallow-reflection"
  label: string; // human name, e.g. "Yellow-green cast near the eyes"
  appliesTo: PieceRole[]; // roles this rule is evaluated for
  applicable: boolean; // evaluated for this piece at all (e.g. face-reflection rules are skipped for bottoms)
  triggered: boolean; // contributed a non-trivial change
  delta: number; // signed points added to the piece score (negative = penalty, positive = bonus)
  evidence: RuleEvidence[]; // the inputs that drove it
  explanation: string; // plain English, risk-based wording ("can", "tends to"); no precise optical claims
}

export interface Reason {
  rule: string;
  metric: string;
  penalty: number;
  text: string;
}

export interface Counterfactual {
  hex: string;
  name: string;
  score: number;
  delta: number; // score minus the piece's current score
  why: string; // why this colour would score differently
}

export interface PieceScore {
  role: PieceRole;
  hex: string; // dominant colour of the garment image
  score: number; // 0-100
  weight: number; // contribution to the outfit score (face-adjacent pieces weigh more)
  base: number; // starting score before rules
  /** Jewellery only: the detected metal/finish of the piece (heuristic from its dominant colour). */
  metal?: "gold" | "silver" | "rose-gold" | "dark" | "other";
  rules: RuleResult[]; // ALL evaluated rules, triggered or not, so the UI can show a full breakdown
  reasons: Reason[]; // top 2 reasons (existing contract)
  counterfactuals: Counterfactual[]; // up to 3 alternative colourways for this piece
}

export interface OutfitScore {
  score: number; // weighted 0-100
  verdict: "buy" | "fix";
  threshold: number; // 70
  undertone: "warm" | "cool" | "neutral";
  concerns: Record<string, number>; // severity 0-100 (higher = worse)
  pieces: PieceScore[];
  /** 2-4 plain sentences explaining how the verdict was reached, ordered by impact. */
  summary: string[];
}

/* ---------- Makeup ---------- */

export interface MakeupTip {
  area: "base" | "concealer" | "blush" | "lip" | "eyes" | "brows" | "skin-prep";
  tip: string; // actionable advice
  why: string; // the metric / garment colour that led to it
  shade?: string; // optional hex swatch
}

/* ---------- Photo quality ---------- */

export type CheckStatus = "pass" | "warn" | "fail";
export type PhotoMode = "face" | "body" | "hand";

export interface QualityCheck {
  id: string; // e.g. "face-size", "lighting", "sharpness", "resolution", "full-body"
  label: string;
  status: CheckStatus;
  message: string; // what we found
  tip?: string; // what to do about it
}

export interface QualityReport {
  mode: PhotoMode;
  ok: boolean; // no "fail" checks
  checks: QualityCheck[];
}

/* ---------- Pipeline result ---------- */

export interface TryOnStage {
  label: string; // e.g. "Top", "+ Bottom", "+ Jacket"
  roles: PieceRole[]; // cumulative pieces worn in this stage
  image?: string; // data URL; undefined if the try-on failed
  /** "outfit" = full-length chain (clothing + shoes); "closeup" = jewellery on the face/hand photos. */
  group?: "outfit" | "closeup";
}

export interface AnalysisResult {
  metrics: SkinMetrics;
  tone: ToneResult;
  outfit: OutfitScore;
  stages: TryOnStage[]; // layering order: top, + bottom, + jacket (only the pieces provided)
  better?: { role: PieceRole; hex: string; name: string; score: number; image?: string };
  rescue?: {
    image?: string;
    plan: { lip: string; blush: string; concealer: string; note: string };
    baselineScore: number;
  };
  makeupTips: MakeupTip[];
  explanation: string; // LLM or templated 2-sentence verdict
  photoNotes: string[]; // non-blocking notes about the inputs (e.g. "no body photo: chest-up try-on only")
  unitsEstimate: number; // rough YouCam units used by this run (cache hits excluded)
  errors: string[];
}
