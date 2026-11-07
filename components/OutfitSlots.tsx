"use client";
import WizardSafeImg, { useObjectUrl } from "@/components/WizardSafeImg";
import type { PieceRole } from "@/lib/types";
import { PIECE_LABEL, PIECE_ROLES } from "@/lib/types";

export interface PieceInput {
  file: File | null;
  url: string;
  sample: string | null;
}
export type OutfitInput = Record<PieceRole, PieceInput>;

export const EMPTY_PIECE: PieceInput = { file: null, url: "", sample: null };
export const EMPTY_OUTFIT: OutfitInput = {
  top: EMPTY_PIECE,
  bottom: EMPTY_PIECE,
  jacket: EMPTY_PIECE,
};

export function pieceFilled(p: PieceInput): boolean {
  return Boolean(p.file || p.url.trim() || p.sample);
}

const SAMPLES = [
  { id: "olive-tee.jpg", label: "Olive tee" },
  { id: "coral-top.jpg", label: "Coral top" },
  { id: "navy-shirt.jpg", label: "Navy shirt" },
];

const ROLE_HELP: Record<PieceRole, string> = {
  top: "Shirt, tee, blouse or knit. It sits closest to your face, so it has the biggest effect.",
  bottom:
    "Trousers, jeans or a skirt. Needs a photo of someone wearing it (not a flat product photo) and requires the full-body photo from step 2.",
  jacket: "Blazer, coat or overshirt. It is layered over the top.",
};

function Slot({ role, value, onChange }: { role: PieceRole; value: PieceInput; onChange: (v: PieceInput) => void }) {
  const label = PIECE_LABEL[role];
  const objUrl = useObjectUrl(value.file);
  const preview = objUrl ?? (value.sample ? `/samples/${value.sample}` : null);
  const filled = pieceFilled(value);
  const linkId = `slot-${role}-url`;
  return (
    <fieldset className="card m-0 min-w-0" aria-describedby={`slot-${role}-help`}>
      <legend className="sr-only">{label} slot</legend>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold">{label}</h3>
        {filled && (
          <button
            type="button"
            className="btn-ghost !min-h-[36px] !px-3 !text-xs"
            onClick={() => onChange(EMPTY_PIECE)}
          >
            Remove<span className="sr-only"> {label}</span>
          </button>
        )}
      </div>
      <p id={`slot-${role}-help`} className="muted mb-3 text-sm">
        {ROLE_HELP[role]}
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2" role="group" aria-label={`Sample ${label.toLowerCase()} garments`}>
        {SAMPLES.map((s) => (
          <button
            type="button"
            key={s.id}
            aria-pressed={value.sample === s.id}
            onClick={() => onChange({ file: null, url: "", sample: s.id })}
            className="overflow-hidden rounded-xl border-2 text-center"
            style={{ borderColor: value.sample === s.id ? "var(--accent)" : "var(--line)" }}
          >
            <WizardSafeImg src={`/samples/${s.id}`} alt={s.label} className="aspect-[3/4] w-full" />
            <span className="block py-1 text-xs">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn">
          Upload image
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            aria-label={`Upload a ${label.toLowerCase()} image`}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f) onChange({ file: f, url: "", sample: null });
              e.target.value = "";
            }}
          />
        </label>
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={linkId} className="sr-only">
            {label} product page or image link
          </label>
          <input
            id={linkId}
            type="url"
            inputMode="url"
            value={value.url}
            className="input w-full"
            placeholder="or paste product page or image link"
            onChange={(e) => onChange({ file: null, url: e.target.value, sample: null })}
          />
        </div>
      </div>
      <p className="muted mt-2 text-xs">
        Product pages are supported. Amazon often blocks us: if it fails, paste the image address or upload the photo.
      </p>

      {value.file && preview && (
        <div className="mt-3 flex items-center gap-3">
          <WizardSafeImg src={preview} alt={`Your ${label.toLowerCase()} preview`} className="thumb h-20 w-16" />
          <span className="muted break-all text-xs">{value.file.name}</span>
        </div>
      )}
      {value.url.trim() && <p className="muted mt-2 break-all text-xs">Using link: {value.url.trim()}</p>}
    </fieldset>
  );
}

export default function OutfitSlots({
  value,
  onChange,
  hasBodyPhoto,
  onGoToBody,
}: {
  value: OutfitInput;
  onChange: (role: PieceRole, v: PieceInput) => void;
  hasBodyPhoto: boolean;
  onGoToBody: () => void;
}) {
  const bottomBlocked = pieceFilled(value.bottom) && !hasBodyPhoto;
  return (
    <div className="space-y-4">
      <p className="muted text-sm">
        Layering order: <b className="text-[color:var(--fg)]">Top</b>, then{" "}
        <b className="text-[color:var(--fg)]">Bottom</b>, then <b className="text-[color:var(--fg)]">Jacket</b> over the
        top. Use one piece or any combination.
      </p>
      {PIECE_ROLES.map((role) => (
        <Slot key={role} role={role} value={value[role]} onChange={(v) => onChange(role, v)} />
      ))}
      {bottomBlocked && (
        <div role="alert" className="wf-alert">
          A bottom needs the full-body photo from step 2.{" "}
          <button type="button" className="underline" onClick={onGoToBody}>
            Go back to step 2
          </button>
        </div>
      )}
    </div>
  );
}
