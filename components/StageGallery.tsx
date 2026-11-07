import WizardSafeImg from "@/components/WizardSafeImg";
import { CLOSEUP_FAIL_HINT, safeHex, splitStages } from "@/lib/explain-view";
import type { AnalysisResult } from "@/lib/types";
import { PIECE_LABEL } from "@/lib/types";

function Tile({
  title,
  sub,
  img,
  swatch,
  failedReason,
  closeup,
}: {
  title: string;
  sub?: string;
  img?: string;
  swatch?: string;
  failedReason?: string;
  closeup?: boolean;
}) {
  const failed = !img && Boolean(failedReason !== undefined);
  return (
    <figure
      className="m-0 overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--line)", background: "var(--card)" }}
    >
      {closeup && failed ? (
        <div className="wiz-unavailable aspect-square w-full">
          <span className="font-semibold">Preview unavailable</span>
          <span className="muted text-xs">{CLOSEUP_FAIL_HINT}</span>
        </div>
      ) : (
        <WizardSafeImg src={img} alt={title} className={`${closeup ? "aspect-square" : "aspect-[3/4]"} w-full`} />
      )}
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
            <summary className="muted cursor-pointer">{closeup ? "Reason" : "Why?"}</summary>
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
  const { outfit, closeups } = splitStages(stages);
  const reason = (errors ?? []).length > 0 ? (errors ?? []).join(" ") : "The try-on service did not return an image.";
  if (stages.length === 0 && !result.better && !result.rescue) return null;
  return (
    <section aria-labelledby="stages-h">
      <h2 id="stages-h" className="mb-1 font-bold">
        See it on you
      </h2>
      <p className="muted mb-3 text-sm">
        Pieces are layered in order: top, bottom, jacket, then shoes. Jewellery is shown in close-ups below.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {outfit.map((s, i) => (
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
      {closeups.length > 0 && (
        <div className="mt-5">
          <h3 id="closeups-h" className="mb-2 font-semibold">
            Close-ups
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-labelledby="closeups-h" role="group">
            {closeups.map((s, i) => (
              <Tile
                key={`${s.label}-${i}`}
                title={s.label}
                sub={s.roles.map((r) => PIECE_LABEL[r]).join(" + ")}
                img={s.image}
                failedReason={reason}
                closeup
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
