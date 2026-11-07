"use client";
import { useEffect, useRef, useState } from "react";

import OutfitSlots, { EMPTY_OUTFIT, pieceFilled } from "@/components/OutfitSlots";
import type { OutfitInput, PieceInput } from "@/components/OutfitSlots";
import { useMusicDuck, useMusicMood } from "@/components/MusicProvider";
import PhotoPicker from "@/components/PhotoPicker";
import WizardResult from "@/components/WizardResult";
import WizardSafeImg, { useObjectUrl } from "@/components/WizardSafeImg";
import WizardTimeline from "@/components/WizardTimeline";
import { missingMessage, missingPhotosFor, stepForError } from "@/lib/explain-view";
import type { AgentEvent, StepId } from "@/lib/steps";
import type { AnalysisResult, PieceRole, QualityReport } from "@/lib/types";
import { PIECE_LABEL, PIECE_ROLES } from "@/lib/types";

type StepNo = 1 | 2 | 3 | 4;
type Phase = "steps" | "running" | "result";

const STEP_INFO: Record<StepNo, { title: string; why: string; todo: string[]; short: string }> = {
  1: {
    title: "Your face photo",
    short: "Face",
    why: "We read your skin from this photo, so the colour advice is about your face today, not a generic one. Your neck and shoulders also help us try on necklaces and earrings.",
    todo: [
      "Close-up: your face fills the oval, include your neck and shoulders",
      "Natural light from a window, facing it",
      "No filter, no heavy beauty mode",
    ],
  },
  2: {
    title: "Body and hand photos (optional)",
    short: "Body, hand",
    why: "Both are optional. Add only what your outfit needs: the body photo for bottoms and shoes, the hand photo for bracelets and rings.",
    todo: [
      "Body: stand straight, head to feet in frame, plain background if you can",
      "Hand: back of your hand towards the camera, fingers slightly apart, wrist in view",
      "Skip both if you only want tops, jackets, necklaces or earrings",
    ],
  },
  3: {
    title: "Build the outfit",
    short: "Outfit",
    why: "Each piece is scored on its own, then combined, so you can see which one helps or hurts.",
    todo: [
      "Pick at least one piece: clothing, shoes or jewellery",
      "Use a sample, upload, or paste a link",
      "A product on a plain background works best",
    ],
  },
  4: {
    title: "Review and analyse",
    short: "Review",
    why: "A last look before we spend try-on credits.",
    todo: ["Check the photos and pieces below", "Press Analyse and keep this tab open"],
  },
};
const STEP_NOS: StepNo[] = [1, 2, 3, 4];

export default function Wizard({ onExit }: { onExit?: () => void }) {
  const [step, setStep] = useState<StepNo>(1);
  const [phase, setPhase] = useState<Phase>("steps");
  const [face, setFace] = useState<File | null>(null);
  const [faceReport, setFaceReport] = useState<QualityReport | null>(null);
  const [body, setBody] = useState<File | null>(null);
  const [bodyReport, setBodyReport] = useState<QualityReport | null>(null);
  const [hand, setHand] = useState<File | null>(null);
  const [handReport, setHandReport] = useState<QualityReport | null>(null);
  const [outfit, setOutfit] = useState<OutfitInput>(EMPTY_OUTFIT);
  const [message, setMessage] = useState("");
  const [serverError, setServerError] = useState("");
  const [progress, setProgress] = useState<Partial<Record<StepId, AgentEvent>>>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const faceUrl = useObjectUrl(face);
  const bodyUrl = useObjectUrl(body);
  const handUrl = useObjectUrl(hand);

  const faceOk = Boolean(face && faceReport?.ok);
  const hasBody = Boolean(body && bodyReport?.ok);
  const hasHand = Boolean(hand && handReport?.ok);
  const filledRoles = PIECE_ROLES.filter((r) => pieceFilled(outfit[r]));

  const photos = { face: faceOk, body: hasBody, hand: hasHand };
  const musicMood =
    phase === "running"
      ? "processing"
      : phase === "result" && result
        ? result.outfit.verdict === "buy"
          ? "celebrate"
          : "caution"
        : step === 3
          ? "focus"
          : "calm";
  useMusicMood(musicMood);
  // Lower the background music while any camera preview is open.
  const [camOpen, setCamOpen] = useState({ face: false, body: false, hand: false });
  useMusicDuck(camOpen.face || camOpen.body || camOpen.hand);

  // Move focus to the heading whenever the step or phase changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, phase]);

  function goto(n: StepNo) {
    setMessage("");
    setStep(n);
  }

  function validate(n: StepNo): string {
    if (n === 1 && !faceOk) {
      return face
        ? "That photo did not pass the quality check yet. Retake it using the tips shown."
        : "Add a face photo that passes the quality check to continue.";
    }
    if (n === 2 && body && !bodyReport?.ok) {
      return "The full-body photo did not pass the quality check. Retake it, or remove it to continue without one.";
    }
    if (n === 2 && hand && !handReport?.ok) {
      return "The hand photo did not pass the quality check. Retake it, or remove it to continue without one.";
    }
    if (n === 3) {
      if (filledRoles.length === 0) return "Choose at least one piece: clothing, shoes or jewellery.";
      const missing = missingPhotosFor(filledRoles, photos);
      if (missing.length > 0) return missingMessage(missing);
    }
    return "";
  }

  function next() {
    const err = validate(step);
    if (err) {
      setMessage(err);
      return;
    }
    goto(Math.min(4, step + 1) as StepNo);
  }

  async function submit() {
    for (const n of [1, 2, 3] as StepNo[]) {
      const err = validate(n);
      if (err) {
        setMessage(err);
        setStep(n);
        return;
      }
    }
    setPhase("running");
    setProgress({});
    setServerError("");
    setMessage("");
    setResult(null);
    const fd = new FormData();
    if (face) fd.append("face", face);
    if (body && hasBody) fd.append("body", body);
    if (hand && hasHand) fd.append("hand", hand);
    for (const role of PIECE_ROLES) {
      const p = outfit[role];
      if (p.file) fd.append(role, p.file);
      else if (p.url.trim()) fd.append(`${role}Url`, p.url.trim());
      else if (p.sample) fd.append(`sample${role[0].toUpperCase()}${role.slice(1)}`, p.sample);
    }
    let got = false;
    const fail = (msg: string) => {
      got = true;
      setServerError(msg);
      setStep(stepForError(msg));
      setPhase("steps");
    };
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.body) throw new Error(`Server returned no data (HTTP ${res.status}).`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const ev = /event: (\w+)/.exec(p)?.[1];
          let data: unknown;
          try {
            data = JSON.parse(/data: (.*)/s.exec(p)?.[1] ?? "{}");
          } catch {
            continue;
          }
          if (ev === "step") {
            const st = data as AgentEvent;
            setProgress((s) => ({ ...s, [st.step]: st }));
          } else if (ev === "result") {
            got = true;
            setResult(data as AnalysisResult);
            setPhase("result");
          } else if (ev === "fail") {
            fail((data as { message?: string }).message || "Something went wrong.");
          }
        }
      }
      if (!got) fail("The analysis ended before a verdict arrived. Please try again.");
    } catch (e) {
      fail((e instanceof Error && e.message) || "Network error. Please try again.");
    }
  }

  function again() {
    // Keep the photos; go back to the outfit step with empty slots.
    setOutfit(EMPTY_OUTFIT);
    setResult(null);
    setProgress({});
    setServerError("");
    setMessage("");
    setStep(3);
    setPhase("steps");
  }

  function setPiece(role: PieceRole, v: PieceInput) {
    setMessage("");
    setOutfit((o) => ({ ...o, [role]: v }));
  }

  if (phase === "running") {
    return (
      <section className="pt-6" aria-labelledby="run-h" aria-busy="true">
        <h1 id="run-h" ref={headingRef} tabIndex={-1} className="mb-1 text-2xl font-bold outline-none">
          Your stylist agent is working
        </h1>
        <p className="muted mb-4 text-sm">Reading your skin and each piece. This can take up to a minute.</p>
        <WizardTimeline steps={progress} live />
      </section>
    );
  }

  if (phase === "result" && result) {
    return <WizardResult result={result} steps={progress} headingRef={headingRef} onAgain={again} />;
  }

  const info = STEP_INFO[step];
  return (
    <section className="space-y-4 pt-2" aria-labelledby="wiz-h">
      <nav aria-label="Progress">
        <ol className="wiz-progress m-0 list-none p-0">
          {STEP_NOS.map((n) => (
            <li
              key={n}
              className={`wiz-dot ${n === step ? "wiz-dot-current" : n < step ? "wiz-dot-done" : ""}`}
              aria-current={n === step ? "step" : undefined}
            >
              <span className="wiz-dot-n" aria-hidden="true">
                {n < step ? "✓" : n}
              </span>
              <span className="wiz-dot-label">
                <span className="sr-only">Step {n}: </span>
                {STEP_INFO[n].short}
                {n < step && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <div>
        <p className="muted text-xs">Step {step} of 4</p>
        <h1 id="wiz-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">
          {info.title}
        </h1>
        <p className="muted mt-1 text-sm">
          <b>Why we ask:</b> {info.why}
        </p>
        <ul className="wiz-checklist">
          {info.todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      {serverError && (
        <div role="alert" className="wf-alert">
          <b>That did not work.</b> {serverError}
        </div>
      )}

      {step === 1 && (
        <PhotoPicker
          mode="face"
          onCameraOpenChange={(open) => setCamOpen((c) => ({ ...c, face: open }))}
          label="Face photo"
          hint="Close-up, face fills the oval, include your neck and shoulders, natural light, no filter"
          value={face}
          onChange={(f, r) => {
            setFace(f);
            setFaceReport(f ? r : null);
            setMessage("");
          }}
        />
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="card space-y-2">
            <h2 className="font-bold">Full-body photo</h2>
            <p className="muted text-sm">Needed for bottoms and shoes. Without it we try on tops and jackets only.</p>
            <PhotoPicker
              mode="body"
              onCameraOpenChange={(open) => setCamOpen((c) => ({ ...c, body: open }))}
              label="Full-body photo"
              hint="Head to feet in frame, standing straight, good light"
              value={body}
              optional
              onChange={(f, r) => {
                setBody(f);
                setBodyReport(f ? r : null);
                setMessage("");
              }}
            />
          </div>
          <div className="card space-y-2">
            <h2 className="font-bold">Hand photo</h2>
            <p className="muted text-sm">Needed for bracelets and rings. Skip it if you are not trying either on.</p>
            <PhotoPicker
              mode="hand"
              onCameraOpenChange={(open) => setCamOpen((c) => ({ ...c, hand: open }))}
              label="Hand photo"
              hint="Back of your hand towards the camera, fingers slightly apart, wrist in view"
              value={hand}
              optional
              onChange={(f, r) => {
                setHand(f);
                setHandReport(f ? r : null);
                setMessage("");
              }}
            />
          </div>
        </div>
      )}

      {step === 3 && <OutfitSlots value={outfit} onChange={setPiece} photos={photos} onGoToStep={(n) => goto(n)} />}

      {step === 4 && (
        <Review
          faceUrl={faceUrl}
          bodyUrl={hasBody ? bodyUrl : null}
          handUrl={hasHand ? handUrl : null}
          outfit={outfit}
          roles={filledRoles}
        />
      )}

      <p role="alert" aria-live="assertive" className={message ? "wf-alert" : "sr-only"}>
        {message}
      </p>

      <div className="wiz-nav">
        {step > 1 ? (
          <button type="button" className="btn-ghost" onClick={() => goto((step - 1) as StepNo)}>
            Back
          </button>
        ) : onExit ? (
          <button type="button" className="btn-ghost" onClick={onExit}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        {step < 4 ? (
          <button type="button" className="btn-primary" onClick={next}>
            {step === 2 && !body && !hand ? "Skip, continue without" : "Next"}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void submit()}>
            Analyse
          </button>
        )}
      </div>
    </section>
  );
}

function PieceThumb({ role, input }: { role: PieceRole; input: PieceInput }) {
  const obj = useObjectUrl(input.file);
  const src = obj ?? (input.sample ? `/samples/${input.sample}` : null);
  return (
    <li className="flex items-center gap-3 text-sm">
      {src ? (
        <WizardSafeImg src={src} alt={`${PIECE_LABEL[role]} piece`} className="thumb h-16 w-12 shrink-0" />
      ) : (
        <div className="skeleton muted flex h-16 w-12 shrink-0 items-center justify-center rounded-lg text-[10px]">
          link
        </div>
      )}
      <div className="min-w-0">
        <b>{PIECE_LABEL[role]}</b>
        <div className="muted break-all text-xs">
          {input.file ? input.file.name : input.url.trim() ? input.url.trim() : "Sample image"}
        </div>
      </div>
    </li>
  );
}

function Review({
  faceUrl,
  bodyUrl,
  handUrl,
  outfit,
  roles,
}: {
  faceUrl: string | null;
  bodyUrl: string | null;
  handUrl: string | null;
  outfit: OutfitInput;
  roles: PieceRole[];
}) {
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="mb-2 font-bold">Your photos</h2>
        <div className="flex gap-3">
          <figure className="m-0 text-center text-xs">
            <WizardSafeImg src={faceUrl} alt="Face photo" className="thumb h-24 w-20" />
            <figcaption className="muted mt-1">Face</figcaption>
          </figure>
          <figure className="m-0 text-center text-xs">
            {bodyUrl ? (
              <WizardSafeImg src={bodyUrl} alt="Full-body photo" className="thumb h-24 w-20" />
            ) : (
              <div className="skeleton muted flex h-24 w-20 items-center justify-center rounded-xl p-1 text-[10px]">
                Not added
              </div>
            )}
            <figcaption className="muted mt-1">Body</figcaption>
          </figure>
          <figure className="m-0 text-center text-xs">
            {handUrl ? (
              <WizardSafeImg src={handUrl} alt="Hand photo" className="thumb h-24 w-20" />
            ) : (
              <div className="skeleton muted flex h-24 w-20 items-center justify-center rounded-xl p-1 text-[10px]">
                Not added
              </div>
            )}
            <figcaption className="muted mt-1">Hand</figcaption>
          </figure>
        </div>
      </div>
      <div className="card">
        <h2 className="mb-2 font-bold">Your pieces</h2>
        <ul className="m-0 list-none space-y-3 p-0">
          {roles.map((r) => (
            <PieceThumb key={r} role={r} input={outfit[r]} />
          ))}
        </ul>
        {roles.length > 1 && (
          <p className="muted mt-3 text-xs">
            Layered in this order: Top, Bottom, Jacket, then Shoes. Jewellery is shown in close-ups.
          </p>
        )}
      </div>
      <div className="card text-sm">
        <h2 className="mb-1 font-bold">What happens next</h2>
        <p>
          We read your skin, find each garment&apos;s colour, score every piece with a transparent rule set, then show
          the outfit on you layer by layer, with a better colour or makeup tips if it needs help.
        </p>
        <p className="muted mt-2 text-xs">
          Cost note: each piece is about one YouCam try-on, so {roles.length} piece{roles.length === 1 ? "" : "s"} means
          about {roles.length} try-on{roles.length === 1 ? "" : "s"} plus the skin reading. Repeat photos are cached.
        </p>
      </div>
    </div>
  );
}
