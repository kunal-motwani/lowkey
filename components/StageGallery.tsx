import WizardSafeImg from "@/components/WizardSafeImg";
import { safeHex } from "@/lib/explain-view";
import type { AnalysisResult } from "@/lib/types";
import { PIECE_LABEL } from "@/lib/types";

function Tile({
  title,
  sub,
  img,
  swatch,
  failedReason,
}: {
  title: string;
  sub?: string;
  img?: string;
  swatch?: string;
  failedReason?: string;
}) {
  return (
    <figure
      className="m-0 overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--line)", background: "var(--card)" }}
    >
      <WizardSafeImg src={img} alt={title} className="aspect-[3/4] w-full" />
      <figcaption className="p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <b className="min-w-0 break-words">{title}</b>
          <span className="flex shrink-0 items-center gap-1">
            {swatch && (
              <i
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border"
                style={{ background: safeHex(swatch) }}
              />
            )}
            {sub}
          </span>
        </div>
        {failedReason && !img && (
          <details className="mt-1">
            <summary className="muted cursor-pointer">Why?</summary>
            <p className="muted mt-1 break-words">{failedReason}</p>
          </details>
        )}
      </figcaption>
    </figure>
  );
}

/** Layered try-on stages plus the optional better-colour and makeup-rescue looks. */
export default function StageGallery({ result, errors }: { result: AnalysisResult; errors?: string[] }) {
  const stages = result.stages ?? [];
  const reason = (errors ?? []).length > 0 ? (errors ?? []).join(" ") : "The try-on service did not return an image.";
  if (stages.length === 0 && !result.better && !result.rescue) return null;
  return (
    <section aria-labelledby="stages-h">
      <h2 id="stages-h" className="mb-1 font-bold">
        See it on you
      </h2>
      <p className="muted mb-3 text-sm">Pieces are layered in order: top, then bottom, then jacket over the top.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stages.map((s, i) => (
          <Tile
            key={`${s.label}-${i}`}
            title={s.label}
            sub={s.roles.map((r) => PIECE_LABEL[r]).join(" + ")}
            img={s.image}
            failedReason={reason}
          />
        ))}
        {result.better && (
          <Tile
            title={`Better: ${result.better.name}`}
            sub={`${PIECE_LABEL[result.better.role]} ${result.better.score}/100`}
            img={result.better.image}
            swatch={result.better.hex}
            failedReason={reason}
          />
        )}
        {result.rescue && (
          <Tile
            title="Rescue with makeup"
            sub={`was ${result.rescue.baselineScore}/100`}
            img={result.rescue.image}
            failedReason={reason}
          />
        )}
      </div>
      {result.rescue?.plan?.note && <p className="muted mt-2 text-sm">{result.rescue.plan.note}</p>}
    </section>
  );
}
