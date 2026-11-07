"use client";
import type { RefObject } from "react";

import ExplainPanel from "@/components/ExplainPanel";
import MakeupTipsList from "@/components/MakeupTipsList";
import ScoreRing from "@/components/ScoreRing";
import StageGallery from "@/components/StageGallery";
import WizardTimeline from "@/components/WizardTimeline";
import { clampScore, metalLabel, safeHex } from "@/lib/explain-view";
import type { AgentEvent, StepId } from "@/lib/steps";
import type { AnalysisResult } from "@/lib/types";
import { PIECE_LABEL } from "@/lib/types";

export default function WizardResult({
  result,
  steps,
  headingRef,
  onAgain,
}: {
  result: AnalysisResult;
  steps: Partial<Record<StepId, AgentEvent>>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAgain: () => void;
}) {
  const o = result.outfit;
  const buy = o.verdict === "buy";
  const score = clampScore(o.score);
  const concerns = Object.entries(o.concerns ?? {}).filter(([, v]) => typeof v === "number");
  const lvl = (v: number) => (v >= 55 ? "high" : v >= 35 ? "moderate" : "low");
  const notes = result.photoNotes ?? [];
  const errors = result.errors ?? [];
  return (
    <section className="space-y-5 pt-2" aria-label="Your result">
      <div className="card flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <ScoreRing score={score} threshold={o.threshold || 70} />
        <div className="min-w-0">
          <div className="muted text-sm">Outfit flattery score</div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-extrabold outline-none"
            style={{ color: buy ? "var(--good)" : "var(--fg)" }}
          >
            <span aria-hidden="true">{buy ? "✓ " : "⚠ "}</span>
            {buy ? "Buy with confidence" : "Think twice"}
          </h1>
          {result.explanation && <p className="mt-2 text-sm">{result.explanation}</p>}
          {(o.summary ?? []).length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-left text-sm">
              {o.summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-bold">What your skin says today</h2>
        <div className="flex flex-wrap gap-2">
          {concerns.map(([k, v]) => (
            <span key={k} className="chip">
              {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: {lvl(v)}
            </span>
          ))}
          {o.undertone && <span className="chip">{o.undertone} undertone</span>}
          {result.tone?.skin_color && (
            <span className="chip">
              <i
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border"
                style={{ background: safeHex(result.tone.skin_color) }}
              />
              skin {result.tone.skin_color}
            </span>
          )}
          {(o.pieces ?? []).map((p) => (
            <span key={p.role} className="chip">
              <i
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border"
                style={{ background: safeHex(p.hex) }}
              />
              {PIECE_LABEL[p.role]} {p.hex}
              {p.metal ? `, ${metalLabel(p.metal).toLowerCase()}` : ""}
            </span>
          ))}
        </div>
      </div>

      <ExplainPanel outfit={o} />
      <StageGallery result={result} errors={errors} />
      <MakeupTipsList tips={result.makeupTips} />

      {notes.length > 0 && (
        <div className="card" role="note">
          <h2 className="mb-1 font-bold">Photo notes</h2>
          <ul className="muted m-0 list-disc space-y-1 pl-5 text-sm">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">
            Some previews were unavailable ({errors.length})
          </summary>
          <p className="muted mt-2 text-xs">The score and reasons above are not affected.</p>
          <ul className="muted m-0 mt-1 list-disc space-y-1 pl-5 text-xs">
            {errors.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details>
        <summary className="cursor-pointer font-bold">Agent timeline</summary>
        <div className="mt-2">
          <WizardTimeline steps={steps} />
        </div>
      </details>

      <button type="button" onClick={onAgain} className="btn w-full">
        Check another outfit
      </button>
    </section>
  );
}
