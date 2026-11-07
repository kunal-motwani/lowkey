import type { AgentEvent, StepId } from "@/lib/steps";
import { STEP_LABEL, STEP_ORDER } from "@/lib/steps";

const STATUS_TEXT: Record<string, string> = {
  pending: "waiting",
  running: "in progress",
  done: "done",
  error: "unavailable",
  skipped: "skipped",
};

export default function WizardTimeline({
  steps,
  live = false,
}: {
  steps: Partial<Record<StepId, AgentEvent>>;
  live?: boolean;
}) {
  return (
    <ol
      className="card m-0 list-none space-y-3"
      {...(live ? { "aria-live": "polite" as const, "aria-relevant": "additions text" as const } : {})}
    >
      {STEP_ORDER.map((k) => {
        const s = steps[k];
        const st = s?.status ?? "pending";
        const dot =
          st === "done"
            ? "var(--good)"
            : st === "running"
              ? "var(--accent)"
              : st === "error"
                ? "var(--bad)"
                : st === "skipped"
                  ? "var(--muted)"
                  : "color-mix(in srgb, var(--fg) 18%, transparent)";
        return (
          <li key={k} className={`flex items-start gap-3 ${st === "skipped" ? "opacity-60" : ""}`}>
            <span
              aria-hidden="true"
              className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${st === "running" ? "animate-pulse" : ""}`}
              style={{ background: dot }}
            />
            <div className="min-w-0 text-sm">
              <div className={`font-semibold ${st === "skipped" ? "muted" : ""}`}>
                {STEP_LABEL[k]}
                <span className={st === "skipped" ? "muted ml-2 text-xs font-normal" : "sr-only"}>
                  {st === "skipped" ? "(skipped)" : `: ${STATUS_TEXT[st] ?? st}`}
                </span>
                {s?.api && <span className="chip ml-2 !px-2 !py-0.5 !text-[10px] font-medium">{s.api}</span>}
              </div>
              {s?.detail && <div className="muted break-words">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
