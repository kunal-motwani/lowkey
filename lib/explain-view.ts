/** Pure view-model helpers for the explainable result screen. No React, no server imports. */
import type { MakeupTip, PieceScore, RuleEvidence, RuleResult } from "./types";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Returns a safe CSS hex colour or the fallback. */
export function safeHex(hex: string | undefined | null, fallback = "#9ca3af"): string {
  return typeof hex === "string" && HEX_RE.test(hex.trim()) ? hex.trim() : fallback;
}

export function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** "+5", "-3" or "0". Uses an ASCII minus so it is easy to test and read aloud. */
export function formatDelta(n: unknown): string {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  if (v > 0) return `+${v}`;
  if (v < 0) return `-${Math.abs(v)}`;
  return "0";
}

export type Direction = "up" | "down" | "flat";
export function direction(n: number): Direction {
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

export type ScoreTone = "good" | "warn" | "bad";
export function scoreTone(score: number, threshold = 70): ScoreTone {
  if (score >= threshold) return "good";
  if (score >= threshold - 20) return "warn";
  return "bad";
}

export function formatEvidence(e: Partial<RuleEvidence> | null | undefined): string {
  const label = (e?.label ?? "").trim();
  const value = (e?.value ?? "").trim();
  if (label && value) return `${label}: ${value}`;
  return label || value;
}

/** Integer percentages (largest remainder) that always sum to exactly 100. Empty input gives []; all-zero gets an even split. */
export function weightPercents(weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const raw = total > 0 ? clean.map((w) => (w / total) * 100) : clean.map(() => 100 / n);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Triggered rules first (largest |delta| first), then evaluated-but-quiet rules, then not-applicable ones. Stable. */
export function orderRules(rules: RuleResult[] | undefined): RuleResult[] {
  const rank = (r: RuleResult) => (r.applicable && r.triggered ? 0 : r.applicable ? 1 : 2);
  return (rules ?? [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = rank(a.r);
      const rb = rank(b.r);
      if (ra !== rb) return ra - rb;
      if (ra === 0) {
        const d = Math.abs(b.r.delta ?? 0) - Math.abs(a.r.delta ?? 0);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    })
    .map((x) => x.r);
}

export type RuleState = "triggered" | "quiet" | "not-applicable";
export function ruleState(r: RuleResult): RuleState {
  return !r.applicable ? "not-applicable" : r.triggered ? "triggered" : "quiet";
}

/** Muted reason line for rules that did not change the score. Empty string for triggered rules. */
export function mutedReason(r: RuleResult): string {
  const state = ruleState(r);
  if (state === "triggered") return "";
  const why = (r.explanation ?? "").trim();
  if (state === "not-applicable") return `Not evaluated: ${why || "this rule does not apply to this piece."}`;
  return `Not triggered: ${why || "your readings were within the comfortable range."}`;
}

export interface WaterfallSegment {
  rule: string;
  label: string;
  state: RuleState;
  delta: number;
  start: number; // running total before this rule
  end: number; // running total after this rule
  left: number; // % position on the track
  width: number; // % width on the track
  direction: Direction;
}

export interface Waterfall {
  base: number;
  final: number;
  segments: WaterfallSegment[];
  /** Difference between the final score and the raw running total (clamping/rounding), 0 when none. */
  adjustment: number;
  domain: [number, number];
  baseWidth: number;
  finalWidth: number;
}

/** Builds waterfall segments from base through each triggered rule's delta to the final score. Only triggered rules move the total. */
export function buildWaterfall(piece: Pick<PieceScore, "base" | "score" | "rules">): Waterfall {
  const base = Number.isFinite(piece.base) ? piece.base : 0;
  const final = Number.isFinite(piece.score) ? piece.score : base;
  let running = base;
  const raw: Omit<WaterfallSegment, "left" | "width">[] = [];
  for (const r of orderRules(piece.rules)) {
    const state = ruleState(r);
    const delta = state === "triggered" && Number.isFinite(r.delta) ? r.delta : 0;
    const start = running;
    running = start + delta;
    raw.push({ rule: r.rule, label: r.label, state, delta, start, end: running, direction: direction(delta) });
  }
  const adjustment = Math.round((final - running) * 10) / 10;
  const values = [base, final, ...raw.flatMap((s) => [s.start, s.end])];
  let lo = Math.max(0, Math.floor(Math.min(...values) - 5));
  let hi = Math.min(100, Math.ceil(Math.max(...values) + 5));
  if (hi - lo < 10) {
    lo = Math.max(0, lo - 5);
    hi = Math.min(100, hi + 5);
  }
  const span = Math.max(1, hi - lo);
  const pct = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100;
  const segments = raw.map((s) => {
    const a = pct(Math.min(s.start, s.end));
    const b = pct(Math.max(s.start, s.end));
    return { ...s, left: a, width: s.state === "triggered" ? Math.max(1.5, b - a) : 0 };
  });
  return { base, final, segments, adjustment, domain: [lo, hi], baseWidth: pct(base), finalWidth: pct(final) };
}

export const TIP_AREA_ORDER: MakeupTip["area"][] = ["skin-prep", "base", "concealer", "eyes", "brows", "blush", "lip"];
export const TIP_AREA_LABEL: Record<MakeupTip["area"], string> = {
  "skin-prep": "Skin prep",
  base: "Base",
  concealer: "Concealer",
  eyes: "Eyes",
  brows: "Brows",
  blush: "Blush",
  lip: "Lips",
};

export interface TipGroup {
  area: MakeupTip["area"];
  label: string;
  tips: MakeupTip[];
}

/** Groups tips by area in a sensible application order; unknown areas are kept at the end. */
export function groupTips(tips: MakeupTip[] | undefined): TipGroup[] {
  const map = new Map<string, MakeupTip[]>();
  for (const t of tips ?? []) {
    if (!t || !t.tip) continue;
    const list = map.get(t.area) ?? [];
    list.push(t);
    map.set(t.area, list);
  }
  const known = TIP_AREA_ORDER.filter((a) => map.has(a));
  const unknown = [...map.keys()].filter((a) => !TIP_AREA_ORDER.includes(a as MakeupTip["area"]));
  return [...known, ...(unknown as MakeupTip["area"][])].map((area) => ({
    area,
    label: TIP_AREA_LABEL[area] ?? String(area),
    tips: map.get(area) ?? [],
  }));
}

/** Where a pipeline failure message most likely belongs in the wizard (1 face, 2 body, 3 pieces, 4 review). */
export function stepForError(message: string): 1 | 2 | 3 | 4 {
  const m = message.toLowerCase();
  if (/full[- ]body|body photo|\bbody\b/.test(m)) return 2;
  if (/\bface\b|selfie|close-up/.test(m)) return 1;
  if (/garment|\btop\b|bottom|jacket|link|url|product|piece|image address/.test(m)) return 3;
  return 4;
}
