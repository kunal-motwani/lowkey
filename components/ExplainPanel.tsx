import {
  buildWaterfall,
  clampScore,
  formatDelta,
  formatEvidence,
  mutedReason,
  ruleState,
  safeHex,
  scoreTone,
  weightPercents,
} from "@/lib/explain-view";
import type { Counterfactual, OutfitScore, PieceScore, RuleResult } from "@/lib/types";
import { PIECE_LABEL } from "@/lib/types";

function DeltaBadge({ delta }: { delta: number }) {
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const icon = dir === "up" ? "▲" : dir === "down" ? "▼" : "●";
  return (
    <span className={`wf-delta wf-${dir}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{formatDelta(delta)}</span>
      <span className="sr-only">{dir === "up" ? " points, helps" : dir === "down" ? " points, hurts" : " points"}</span>
    </span>
  );
}

function RuleRow({ rule, segment }: { rule: RuleResult; segment?: { left: number; width: number } }) {
  const state = ruleState(rule);
  const muted = state !== "triggered";
  const evidence = (rule.evidence ?? []).map(formatEvidence).filter(Boolean);
  const dir = rule.delta > 0 ? "up" : "down";
  return (
    <li className={`wf-rule ${muted ? "wf-muted" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words text-sm font-semibold">{rule.label}</span>
        {state === "triggered" ? (
          <DeltaBadge delta={rule.delta} />
        ) : (
          <span className="muted shrink-0 text-xs">{state === "quiet" ? "No change" : "Skipped"}</span>
        )}
      </div>
      {state === "triggered" && segment && (
        <div className="wf-track" aria-hidden="true">
          <span
            className={`wf-bar wf-bar-${dir}`}
            style={{ left: `${segment.left}%`, width: `${Math.max(1.5, segment.width)}%` }}
          />
        </div>
      )}
      {state === "triggered" ? (
        rule.explanation && <p className="mt-1 text-sm">{rule.explanation}</p>
      ) : (
        <p className="muted mt-1 text-xs">{mutedReason(rule)}</p>
      )}
      {evidence.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0" aria-label="Evidence">
          {evidence.map((e, i) => (
            <li key={`${e}-${i}`} className="chip !py-0.5 !text-xs">
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Counterfactuals({ items }: { items: Counterfactual[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-semibold">What would change this</h4>
      <ul className="m-0 list-none space-y-2 p-0">
        {items.map((c, i) => (
          <li key={`${c.hex}-${i}`} className="flex items-start gap-3 text-sm">
            <i
              aria-hidden="true"
              className="mt-0.5 inline-block h-6 w-6 shrink-0 rounded-full border"
              style={{ background: safeHex(c.hex), borderColor: "var(--line)" }}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2">
                <b>{c.name}</b>
                <span className="muted">{clampScore(c.score)}/100</span>
                <DeltaBadge delta={c.delta} />
              </div>
              <div className="muted text-xs">{c.why}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PieceBreakdown({ piece, percent, threshold }: { piece: PieceScore; percent: number; threshold: number }) {
  const wf = buildWaterfall(piece);
  const bySeg = new Map(wf.segments.map((s) => [s.rule, s]));
  const rules = wf.segments
    .map((s) => (piece.rules ?? []).find((r) => r.rule === s.rule))
    .filter((r): r is RuleResult => Boolean(r));
  const tone = scoreTone(clampScore(piece.score), threshold);
  return (
    <article className="card" aria-label={`${PIECE_LABEL[piece.role]} breakdown`}>
      <header className="flex items-center gap-3">
        <i
          aria-hidden="true"
          className="inline-block h-9 w-9 shrink-0 rounded-lg border"
          style={{ background: safeHex(piece.hex), borderColor: "var(--line)" }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{PIECE_LABEL[piece.role]}</h3>
          <p className="muted text-xs">Counts for {percent}% of the outfit score</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold" style={{ color: `var(--${tone})` }}>
            {clampScore(piece.score)}
          </div>
          <div className="muted text-xs">piece score</div>
        </div>
      </header>

      <div className="mt-4" role="group" aria-label="Score build-up">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Start (base)</span>
          <span>{Math.round(wf.base)}</span>
        </div>
        <div className="wf-track" aria-hidden="true">
          <span className="wf-bar wf-bar-base" style={{ left: 0, width: `${wf.baseWidth}%` }} />
        </div>
      </div>

      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {rules.map((r) => (
          <RuleRow key={r.rule} rule={r} segment={bySeg.get(r.rule)} />
        ))}
      </ul>
      {rules.length === 0 && <p className="muted mt-3 text-sm">No rules were recorded for this piece.</p>}

      {wf.adjustment !== 0 && (
        <p className="muted mt-2 text-xs">Adjusted {formatDelta(wf.adjustment)} to keep the score between 0 and 100.</p>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Final piece score</span>
          <span className="font-bold">{Math.round(wf.final)}</span>
        </div>
        <div className="wf-track" aria-hidden="true">
          <span className="wf-bar wf-bar-final" style={{ left: 0, width: `${wf.finalWidth}%` }} />
        </div>
      </div>

      <Counterfactuals items={piece.counterfactuals ?? []} />
    </article>
  );
}

export default function ExplainPanel({ outfit }: { outfit: OutfitScore }) {
  const pieces = outfit.pieces ?? [];
  const percents = weightPercents(pieces.map((p) => p.weight));
  const threshold = outfit.threshold || 70;
  return (
    <section aria-labelledby="why-h" className="space-y-3">
      <div>
        <h2 id="why-h" className="font-bold">
          Why this verdict
        </h2>
        <p className="muted text-sm">
          Every piece starts from a base score. Each rule then adds or removes points, and you can see exactly which.
        </p>
      </div>

      {pieces.length === 0 && <p className="muted text-sm">No piece breakdown was returned for this run.</p>}
      {pieces.map((p, i) => (
        <PieceBreakdown key={p.role} piece={p} percent={percents[i]} threshold={threshold} />
      ))}

      <details className="card">
        <summary className="cursor-pointer font-semibold">How to read this</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p>
            This is a transparent rule set, not a black box. Each rule compares a reading from your photo (such as dark
            circles or redness) with the colour of the garment, and adds or removes a fixed number of points.
          </p>
          <p>
            The outfit score is a weighted average of the piece scores. Pieces nearer your face weigh more, which is why
            a top or jacket counts for more than a bottom. A score of {threshold} or more reads as &quot;buy with
            confidence&quot;; below that reads as &quot;think twice&quot;.
          </p>
          <p>
            Honest limits: readings are estimates from one photo and depend on lighting and your camera. Colours on
            screen and in a product photo may differ from real life. Flattr is a styling aid, not medical advice, and
            says nothing about health conditions.
          </p>
        </div>
      </details>
    </section>
  );
}
