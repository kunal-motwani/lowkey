import { dominantColor, recolorGarment } from "./color";
import { bestColorways, rescueMakeup, scoreGarment, type Flattery } from "./flattery";
import { clothesTryOn, makeupTryOn, skinAnalysis, skinTone, type SkinMetrics, type ToneResult } from "./youcam";

export type StepId = "perceive" | "garment" | "score" | "decide" | "recolor" | "rescue" | "explain";
export interface AgentEvent {
  step: StepId;
  status: "running" | "done" | "error" | "skipped";
  api?: string;
  detail?: string;
}
export interface Result {
  garmentHex: string;
  metrics: SkinMetrics;
  tone: ToneResult;
  flattery: Flattery;
  verdict: "buy" | "fix";
  originalTryOn?: string;
  better?: { hex: string; name: string; score: number; image?: string; alternatives: { hex: string; name: string; score: number }[] };
  rescue?: { image?: string; plan: ReturnType<typeof rescueMakeup>; baselineScore: number };
  explanation: string;
  errors: string[];
}

type Emit = (e: AgentEvent) => void;

async function safe<T>(errors: string[], label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    errors.push(`${label}: ${e.message}`);
    return undefined;
  }
}

export async function runStylist(selfie: Buffer, garment: Buffer, emit: Emit): Promise<Result> {
  const errors: string[] = [];

  // 1. Perceive: two YouCam analyses in parallel
  emit({ step: "perceive", status: "running", api: "AI Skin Analysis + skin tone" });
  const [metrics, tone] = await Promise.all([skinAnalysis(selfie), skinTone(selfie)]);
  emit({ step: "perceive", status: "done", detail: `Skin tone ${tone.skin_color} (${tone.source === "youcam" ? "YouCam Skin Tone API" : "local estimate"}); ${Object.keys(metrics).length} skin metrics` });

  // 2. Garment color
  emit({ step: "garment", status: "running", detail: "k-means on centre pixels" });
  const { hex } = await dominantColor(garment);
  emit({ step: "garment", status: "done", detail: `Dominant colour ${hex}` });

  // 3. Score
  emit({ step: "score", status: "running", detail: "Flattery engine (colour theory rules)" });
  const flattery = scoreGarment(hex, tone, metrics);
  emit({ step: "score", status: "done", detail: `Flattery Score ${flattery.score}/100` });

  // 4. Decide
  const verdict = flattery.score >= 70 ? "buy" : "fix";
  emit({ step: "decide", status: "done", detail: verdict === "buy" ? "Buy with confidence" : "Below 70 - planning fixes" });

  // Original try-on (needed in both branches for the side-by-side)
  const originalTryOn = await safe(errors, "Clothes try-on", () => clothesTryOn(selfie, garment));

  const result: Result = { garmentHex: hex, metrics, tone, flattery, verdict, originalTryOn, explanation: "", errors };

  if (verdict === "fix") {
    // 4a. Recolor path
    emit({ step: "recolor", status: "running", api: "AI Clothes Virtual Try-On", detail: "Re-colouring garment locally, ranking colourways" });
    const ways = bestColorways(hex, tone, metrics, 3);
    const top = ways[0];
    result.better = { hex: top.hex, name: top.name, score: top.score, alternatives: ways };
    const recolored = await safe(errors, "Recolor", () => recolorGarment(garment, hex, top.hex));
    if (recolored) result.better.image = await safe(errors, "Clothes try-on (better colour)", () => clothesTryOn(selfie, recolored));
    emit({ step: "recolor", status: result.better.image ? "done" : "error", detail: `Best: ${top.name} ${top.hex} scores ${top.score}` });

    // 4b. Rescue path: makeup on top of the try-on (fall back to the selfie)
    emit({ step: "rescue", status: "running", api: "AI Makeup Virtual Try-On", detail: "Lip + blush + concealer chosen against your top concern" });
    const plan = rescueMakeup(flattery, tone);
    const base = originalTryOn ? Buffer.from(originalTryOn.split(",")[1], "base64") : selfie;
    const img = await safe(errors, "Makeup try-on", () => makeupTryOn(base, plan));
    result.rescue = { image: img, plan, baselineScore: flattery.score };
    emit({ step: "rescue", status: img ? "done" : "error", detail: plan.note });
  } else {
    emit({ step: "recolor", status: "skipped" });
    emit({ step: "rescue", status: "skipped" });
  }

  // 5. Explain
  emit({ step: "explain", status: "running", api: process.env.ANTHROPIC_API_KEY ? "Claude" : "templated" });
  result.explanation = await explain(result);
  emit({ step: "explain", status: "done" });
  return result;
}

function templated(r: Result) {
  const why = r.flattery.reasons[0]?.text ?? "";
  if (r.verdict === "buy") return `Good news: ${why} Go ahead and buy it.`;
  return `${why} ${r.better ? `Try it in ${r.better.name.toLowerCase()} (${r.better.score}/100 for you), or keep this shirt and use the suggested makeup to rebalance.` : ""}`.trim();
}

async function explain(r: Result): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return templated(r);
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
            content: `Write a friendly 2-sentence verdict for a shopper. Do not invent numbers or claim precise optical effects; use words like "can" and "tends to". Data: ${JSON.stringify({
              score: r.flattery.score,
              verdict: r.verdict,
              reasons: r.flattery.reasons.map((x) => x.text),
              betterColour: r.better && { name: r.better.name, score: r.better.score },
              makeupNote: r.rescue?.plan.note,
            })}`,
          },
        ],
      }),
    });
    const j: any = await res.json();
    return j.content?.[0]?.text?.trim() || templated(r);
  } catch {
    return templated(r);
  }
}
