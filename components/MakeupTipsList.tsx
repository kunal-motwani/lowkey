import { groupTips, safeHex } from "@/lib/explain-view";
import type { MakeupTip } from "@/lib/types";

export default function MakeupTipsList({ tips }: { tips: MakeupTip[] | undefined }) {
  const groups = groupTips(tips);
  if (groups.length === 0) return null;
  return (
    <section className="card" aria-labelledby="tips-h">
      <h2 id="tips-h" className="mb-1 font-bold">
        Makeup tips for this look
      </h2>
      <p className="muted mb-3 text-sm">Each tip says what it is reacting to, so you can skip what does not apply.</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.area}>
            <h3 className="mb-1 text-sm font-semibold">{g.label}</h3>
            <ul className="m-0 list-none space-y-2 p-0">
              {g.tips.map((t, i) => (
                <li key={`${g.area}-${i}`} className="flex items-start gap-3 text-sm">
                  {t.shade ? (
                    <span className="mt-0.5 inline-flex shrink-0 flex-col items-center">
                      <i
                        aria-hidden="true"
                        className="inline-block h-6 w-6 rounded-full border"
                        style={{ background: safeHex(t.shade), borderColor: "var(--line)" }}
                      />
                      <span className="sr-only">Suggested shade {t.shade}</span>
                    </span>
                  ) : (
                    <span aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div>{t.tip}</div>
                    <div className="muted text-xs">Why: {t.why}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
