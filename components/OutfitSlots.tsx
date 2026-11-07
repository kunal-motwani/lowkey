"use client";
import WizardSafeImg, { useObjectUrl } from "@/components/WizardSafeImg";
import { missingMessage, missingPhotosFor, rolesByGroup, stepForPhoto } from "@/lib/explain-view";
import type { PieceRole, SourcePhoto } from "@/lib/types";
import { PIECE_LABEL, PIECE_ROLES, ROLE_GROUP } from "@/lib/types";

export interface PieceInput {
  file: File | null;
  url: string;
  sample: string | null;
}
export type OutfitInput = Record<PieceRole, PieceInput>;

export const EMPTY_PIECE: PieceInput = { file: null, url: "", sample: null };
export const EMPTY_OUTFIT: OutfitInput = Object.fromEntries(PIECE_ROLES.map((r) => [r, EMPTY_PIECE])) as OutfitInput;

export function pieceFilled(p: PieceInput): boolean {
  return Boolean(p.file || p.url.trim() || p.sample);
}

interface Sample {
  id: string;
  label: string;
}
const CLOTHING_SAMPLES: Sample[] = [
  { id: "olive-tee.jpg", label: "Olive tee" },
  { id: "coral-top.jpg", label: "Coral top" },
  { id: "navy-shirt.jpg", label: "Navy shirt" },
];
const METAL_SAMPLES = (role: string): Sample[] => [
  { id: `${role}-gold.jpg`, label: "Gold" },
  { id: `${role}-silver.jpg`, label: "Silver" },
  { id: `${role}-rose-gold.jpg`, label: "Rose gold" },
];
const SAMPLES: Record<PieceRole, Sample[]> = {
  top: CLOTHING_SAMPLES,
  bottom: CLOTHING_SAMPLES,
  jacket: CLOTHING_SAMPLES,
  shoes: [
    { id: "shoes-white.jpg", label: "White" },
    { id: "shoes-black.jpg", label: "Black" },
    { id: "shoes-tan.jpg", label: "Tan" },
  ],
  necklace: METAL_SAMPLES("necklace"),
  earrings: METAL_SAMPLES("earrings"),
  bracelet: METAL_SAMPLES("bracelet"),
  ring: METAL_SAMPLES("ring"),
};

const ROLE_HELP: Record<PieceRole, string> = {
  top: "Shirt, tee, blouse or knit. It sits closest to your face, so it has the biggest effect.",
  bottom: "Trousers, jeans or a skirt. Needs a photo of someone wearing it, not a flat product photo.",
  jacket: "Blazer, coat or overshirt. It is layered over the top.",
  shoes: "Trainers, boots or heels. Use a clean product photo of one shoe, at least 512 px wide.",
  necklace: "Chain or pendant. A front-facing photo with the background removed works best.",
  earrings: "Studs, hoops or drops. A clear, close photo of the pair on a plain background works best.",
  bracelet: "Bangle, chain or cuff. A 3/4 front view works best.",
  ring: "Any ring. A clear, close photo on a plain background works best.",
};
const ROLE_NEEDS: Partial<Record<PieceRole, string>> = {
  bottom: "Needs the full-body photo from step 2.",
  shoes: "Needs the full-body photo from step 2.",
  bracelet: "Needs the hand photo from step 2.",
  ring: "Needs the hand photo from step 2.",
};

function Slot({ role, value, onChange }: { role: PieceRole; value: PieceInput; onChange: (v: PieceInput) => void }) {
  const samples = SAMPLES[role];
  const clothing = ROLE_GROUP[role] === "clothing";
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
        {ROLE_NEEDS[role] && <b className="block text-[color:var(--fg)]">{ROLE_NEEDS[role]}</b>}
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2" role="group" aria-label={`Sample ${label.toLowerCase()} garments`}>
        {samples.map((s) => (
          <button
            type="button"
            key={s.id}
            aria-pressed={value.sample === s.id}
            onClick={() => onChange({ file: null, url: "", sample: s.id })}
            className="overflow-hidden rounded-xl border-2 text-center"
            style={{ borderColor: value.sample === s.id ? "var(--accent)" : "var(--line)" }}
          >
            <WizardSafeImg
              src={`/samples/${s.id}`}
              alt={`${s.label} ${label.toLowerCase()} sample`}
              className={`${clothing ? "aspect-[3/4]" : "aspect-square"} w-full`}
            />
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
  photos,
  onGoToStep,
}: {
  value: OutfitInput;
  onChange: (role: PieceRole, v: PieceInput) => void;
  /** Which photos have passed their quality checks. */
  photos: Partial<Record<SourcePhoto, boolean>>;
  onGoToStep: (step: 1 | 2) => void;
}) {
  const filled = PIECE_ROLES.filter((r) => pieceFilled(value[r]));
  const missing = missingPhotosFor(filled, photos);
  const groups = rolesByGroup(PIECE_ROLES);
  return (
    <div className="space-y-6">
      <p className="muted text-sm">
        Pick at least one piece. Clothing is layered Top, then Bottom, then Jacket over the top; shoes and jewellery are
        added after. Use one piece or any combination.
      </p>
      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`wiz-group-${g.group}`} className="space-y-3">
          <h2 id={`wiz-group-${g.group}`} className="wiz-group-h">
            {g.label}
          </h2>
          {g.roles.map((role) => (
            <Slot key={role} role={role} value={value[role]} onChange={(v) => onChange(role, v)} />
          ))}
        </section>
      ))}
      {missing.length > 0 && (
        <div role="alert" className="wf-alert">
          {missingMessage(missing)}{" "}
          {Array.from(new Set(missing.map((m) => stepForPhoto(m.photo)))).map((n) => (
            <button key={n} type="button" className="underline" onClick={() => onGoToStep(n)}>
              Go back to step {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
