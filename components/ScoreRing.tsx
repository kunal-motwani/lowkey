import { clampScore, scoreTone } from "@/lib/explain-view";

const TONE_VAR = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" } as const;

export default function ScoreRing({
  score,
  threshold = 70,
  label = "Flattery score",
  className = "h-32 w-32 shrink-0 sm:h-36 sm:w-36",
}: {
  score: number;
  threshold?: number;
  label?: string;
  className?: string;
}) {
  const pct = clampScore(score);
  const C = 2 * Math.PI * 52;
  const col = TONE_VAR[scoreTone(pct, threshold)];
  const tick = (threshold / 100) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={`${label} ${pct} out of 100`}>
      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke={col}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * C} ${C}`}
        transform="rotate(-90 60 60)"
      />
      <line
        x1={60 + 45 * Math.cos(tick)}
        y1={60 + 45 * Math.sin(tick)}
        x2={60 + 59 * Math.cos(tick)}
        y2={60 + 59 * Math.sin(tick)}
        stroke="currentColor"
        strokeWidth="2"
      />
      <text x="60" y="68" textAnchor="middle" fontSize="30" fontWeight="800" fill="currentColor">
        {pct}
      </text>
    </svg>
  );
}
