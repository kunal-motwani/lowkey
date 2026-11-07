/* eslint-disable @next/next/no-img-element */
"use client";
import { useEffect, useRef, useState } from "react";

import type { AgentEvent, Result } from "@/lib/agent";
import CameraCapture from "@/components/CameraCapture";

type Step = AgentEvent;
type View = "landing" | "input" | "running" | "result";

const SAMPLES = [
  { id: "olive-tee.jpg", label: "Olive tee" },
  { id: "coral-top.jpg", label: "Coral top" },
  { id: "navy-shirt.jpg", label: "Navy shirt" },
];
const STEP_LABEL: Record<string, string> = {
  perceive: "Read your skin today",
  garment: "Find the garment colour",
  score: "Compute Flattery Score",
  decide: "Decide",
  recolor: "Find a better colour on you",
  rescue: "Rescue with makeup",
  explain: "Write the verdict",
};
const ORDER = Object.keys(STEP_LABEL);
const STATUS_TEXT: Record<string, string> = {
  pending: "waiting",
  running: "in progress",
  done: "done",
  error: "unavailable",
  skipped: "not needed",
};

/** Object URL tied to a File's lifetime: created in an effect, revoked on change/unmount. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/** Image that degrades to a neutral "Preview unavailable" placeholder instead of a broken icon. */
function SafeImg({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={`${alt}: preview unavailable`}
        className={`skeleton muted flex items-center justify-center p-2 text-center text-xs ${className}`}
      >
        Preview unavailable
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [selfie, setSelfie] = useState<File | null>(null);
  const [useSampleSelfie, setUseSampleSelfie] = useState(false);
  const [garment, setGarment] = useState<File | null>(null);
  const [garmentUrl, setGarmentUrl] = useState("");
  const [sample, setSample] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const selfieObj = useObjectUrl(selfie);
  const garmentObj = useObjectUrl(garment);
  const selfiePrev = selfieObj ?? (useSampleSelfie ? "/samples/selfie.jpg" : null);
  const garmentPrev = garmentObj ?? (sample ? `/samples/${sample}` : null);

  const hasGarment = Boolean(garment || garmentUrl.trim() || sample);
  const ready = Boolean((selfie || useSampleSelfie) && hasGarment);

  // Move focus to the new view's heading for keyboard / screen-reader users.
  useEffect(() => {
    if (view !== "landing") headingRef.current?.focus();
  }, [view]);

  async function run(selfieOverride?: File) {
    const selfieFile = selfieOverride ?? selfie;
    setView("running");
    setSteps({});
    setError("");
    setResult(null);
    const fd = new FormData();
    if (selfieFile) fd.append("selfie", selfieFile);
    else fd.append("sampleSelfie", "selfie.jpg");
    if (garment) fd.append("garment", garment);
    else if (garmentUrl.trim()) fd.append("garmentUrl", garmentUrl.trim());
    else if (sample) fd.append("sampleGarment", sample);
    let got = false;
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
            setSteps((s) => ({ ...s, [st.step]: st }));
          }
          if (ev === "result") {
            got = true;
            setResult(data as Result);
            setView("result");
          }
          if (ev === "fail") {
            got = true;
            setError((data as { message?: string }).message || "Something went wrong.");
            setView("input");
          }
        }
      }
      if (!got) {
        setError("The analysis ended before a verdict arrived. Please try again.");
        setView("input");
      }
    } catch (e) {
      setError((e instanceof Error && e.message) || "Network error. Please try again.");
      setView("input");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24">
      <header className="flex items-center justify-between py-5">
        <button
          onClick={() => setView("landing")}
          aria-label="Flattr home"
          className="rounded-md text-xl font-bold tracking-tight"
        >
          flattr<span className="accent">.</span>
        </button>
        <span className="muted text-xs">Powered by YouCam APIs</span>
      </header>

      {view === "landing" && (
        <section className="pt-8 text-center sm:pt-12" aria-labelledby="hero">
          <p
            className="muted mb-4 inline-block rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: "var(--line)" }}
          >
            The skin-aware outfit check
          </p>
          <h1 id="hero" className="text-4xl font-extrabold leading-tight sm:text-5xl">
            Will this make me look tired?
            <br />
            <span className="accent">Check before you buy.</span>
          </h1>
          <p className="muted mx-auto mt-5 max-w-xl text-base sm:text-lg">
            Garment colour bounces onto your face and amplifies what your skin is doing today. Flattr reads your skin,
            scores the shirt, and shows you a better colour or the exact makeup that rescues it.
          </p>
          <button onClick={() => setView("input")} className="btn-primary mt-8">
            Check an outfit
          </button>
          <p className="muted mt-3 text-xs">No account. Try it with our sample photos in under a minute.</p>
          <ol className="mt-12 grid list-none gap-3 p-0 text-left sm:grid-cols-3">
            {[
              ["1. Read", "Skin analysis and skin tone from one selfie"],
              ["2. Score", "A colour-theory engine ties the shirt colour to your skin metrics"],
              ["3. Fix", "Clothes and makeup try-on show the better look on you"],
            ].map(([t, d]) => (
              <li key={t} className="card">
                <b>{t}</b>
                <p className="muted mt-1 text-sm">{d}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {cameraOpen && (
        <CameraCapture
          acceptLabel={hasGarment ? "Use photo & analyse" : "Use this photo"}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setSelfie(file);
            setUseSampleSelfie(false);
            setCameraOpen(false);
            // Garment already chosen: go straight to the analysis.
            if (hasGarment) void run(file);
          }}
        />
      )}

      {view === "input" && (
        <section className="space-y-5 pt-2" aria-labelledby="input-h">
          <h1 id="input-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">
            Check an outfit
          </h1>
          {error && (
            <div
              role="alert"
              className="rounded-xl border p-3 text-sm"
              style={{
                borderColor: "var(--bad)",
                color: "var(--bad)",
                background: "color-mix(in srgb, var(--bad) 10%, transparent)",
              }}
            >
              <b>That did not work.</b> {error}
            </div>
          )}

          <div className="card">
            <h2 className="font-bold">1. Your selfie</h2>
            <p className="muted mb-3 text-sm">Face a window, natural light, no filter. Shoulders visible.</p>
            <div className="flex items-center gap-4">
              <SafeImg src={selfiePrev ?? undefined} alt="Your selfie preview" className="thumb h-24 w-24 shrink-0" />
              <div className="flex flex-col gap-2">
                <button type="button" className="btn-primary" onClick={() => setCameraOpen(true)}>
                  Open camera
                </button>
                <label className="btn">
                  Upload a photo
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    aria-label="Upload or take a selfie"
                    onChange={(e) => {
                      setSelfie(e.target.files?.[0] ?? null);
                      setUseSampleSelfie(false);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-pressed={useSampleSelfie}
                  onClick={() => {
                    setSelfie(null);
                    setUseSampleSelfie(true);
                  }}
                >
                  Use sample selfie
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="font-bold">2. The garment</h2>
            <p className="muted mb-3 text-sm">
              Pick a sample, upload a product photo, or paste a product link (image links work best; some shops block
              page links).
            </p>
            <div className="mb-3 grid grid-cols-3 gap-3" role="group" aria-label="Sample garments">
              {SAMPLES.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={sample === s.id}
                  onClick={() => {
                    setSample(s.id);
                    setGarment(null);
                    setGarmentUrl("");
                  }}
                  className="overflow-hidden rounded-xl border-2 text-center"
                  style={{ borderColor: sample === s.id ? "var(--accent)" : "var(--line)" }}
                >
                  <SafeImg src={`/samples/${s.id}`} alt={s.label} className="aspect-[3/4] w-full" />
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
                  aria-label="Upload a garment image"
                  onChange={(e) => {
                    setGarment(e.target.files?.[0] ?? null);
                    setSample(null);
                    setGarmentUrl("");
                  }}
                />
              </label>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Product image URL</span>
                <input
                  type="url"
                  inputMode="url"
                  value={garmentUrl}
                  className="input w-full"
                  placeholder="or paste product page or image link"
                  onChange={(e) => {
                    setGarmentUrl(e.target.value);
                    setSample(null);
                    setGarment(null);
                  }}
                />
              </label>
            </div>
            {garment && <p className="muted mt-2 text-xs">Selected: {garment.name}</p>}
            {garmentPrev && (garment || sample) && garment && (
              <SafeImg src={garmentPrev} alt="Your garment preview" className="thumb mt-3 h-24 w-20" />
            )}
          </div>

          <button type="button" disabled={!ready} onClick={() => run()} className="btn-primary w-full">
            Will this flatter me?
          </button>
          {!ready && <p className="muted text-center text-xs">Add a selfie and a garment to continue.</p>}
        </section>
      )}

      {view === "running" && (
        <section className="pt-6" aria-labelledby="run-h" aria-busy="true">
          <h1 id="run-h" ref={headingRef} tabIndex={-1} className="mb-1 text-2xl font-bold outline-none">
            Your stylist agent is working
          </h1>
          <p className="muted mb-4 text-sm">Reading your skin and the garment. This can take up to a minute.</p>
          <Timeline steps={steps} live />
        </section>
      )}

      {view === "result" && result && (
        <ResultView r={result} steps={steps} headingRef={headingRef} onAgain={() => setView("input")} />
      )}
    </main>
  );
}

function Timeline({ steps, live = false }: { steps: Record<string, Step>; live?: boolean }) {
  return (
    <ol
      className="card space-y-3"
      {...(live ? { "aria-live": "polite" as const, "aria-relevant": "additions text" as const } : {})}
    >
      {ORDER.map((k) => {
        const s: Step | undefined = steps[k];
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
          <li key={k} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${st === "running" ? "animate-pulse" : ""}`}
              style={{ background: dot }}
            />
            <div className="min-w-0 text-sm">
              <div className="font-semibold">
                {STEP_LABEL[k]}
                <span className="sr-only">: {STATUS_TEXT[st] ?? st}</span>
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

function Ring({ score }: { score: number }) {
  const col = score >= 70 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--bad)";
  const C = 2 * Math.PI * 52;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-32 w-32 shrink-0 sm:h-36 sm:w-36"
      role="img"
      aria-label={`Flattery score ${score} out of 100`}
    >
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
      <text x="60" y="68" textAnchor="middle" fontSize="30" fontWeight="800" fill="currentColor">
        {score}
      </text>
    </svg>
  );
}

function ResultView({
  r,
  steps,
  onAgain,
  headingRef,
}: {
  r: Result;
  steps: Record<string, Step>;
  onAgain: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const f = r.flattery;
  const c = f.concerns ?? {};
  const chips: [string, number][] = [
    ["Dark circles", c.darkCircles],
    ["Redness", c.redness],
    ["Dullness", c.dullness],
    ["Oiliness", c.oiliness],
  ];
  const lvl = (v: number) => (v >= 55 ? "high" : v >= 35 ? "moderate" : "low");
  const buy = r.verdict === "buy";
  return (
    <section className="space-y-5 pt-2" aria-label="Your result">
      <div className="card flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <Ring score={f.score} />
        <div>
          <div className="muted text-sm">Flattery Score</div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-extrabold outline-none"
            style={{ color: buy ? "var(--good)" : "var(--fg)" }}
          >
            {buy ? "Buy with confidence" : "Wait: this one may drain you"}
          </h1>
          <p className="mt-2 text-sm">{r.explanation}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-bold">What your skin says today</h2>
        <div className="flex flex-wrap gap-2">
          {chips
            .filter(([, v]) => typeof v === "number")
            .map(([n, v]) => (
              <span key={n} className="chip">
                {n}: {lvl(v)}
              </span>
            ))}
          {f.undertone && <span className="chip">{f.undertone} undertone</span>}
          {r.tone?.skin_color && (
            <span className="chip">
              <i
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border"
                style={{ background: r.tone.skin_color }}
              />
              skin {r.tone.skin_color}
            </span>
          )}
          {r.garmentHex && (
            <span className="chip">
              <i
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border"
                style={{ background: r.garmentHex }}
              />
              shirt {r.garmentHex}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-2 font-bold">Why</h2>
        <ul className="space-y-2 text-sm">
          {(f.reasons ?? []).map((x, i) => (
            <li key={`${x.rule ?? "r"}-${i}`}>
              <b>{x.metric}:</b> {x.text}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 font-bold">See it on you</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile title="Original" sub={`${f.score}/100`} img={r.originalTryOn} />
          {r.better ? (
            <Tile
              title={`Better: ${r.better.name}`}
              sub={`${r.better.score}/100`}
              img={r.better.image}
              swatch={r.better.hex}
            />
          ) : (
            <Tile title="Better colour" sub="Not needed" notNeeded />
          )}
          {r.rescue ? (
            <Tile title="Rescue with makeup" sub="Lip, blush, concealer" img={r.rescue.image} />
          ) : (
            <Tile title="Makeup rescue" sub="Not needed" notNeeded />
          )}
        </div>
        {r.rescue?.plan?.note && <p className="muted mt-2 text-sm">{r.rescue.plan.note}</p>}
        {r.errors?.length > 0 && (
          <p className="muted mt-2 text-xs">
            Some previews were unavailable ({r.errors.length}); the score and reasons are unaffected.
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-bold">Agent timeline</h2>
        <Timeline steps={steps} />
      </div>
      <button type="button" onClick={onAgain} className="btn w-full">
        Check another outfit
      </button>
    </section>
  );
}

function Tile({
  title,
  sub,
  img,
  swatch,
  notNeeded = false,
}: {
  title: string;
  sub: string;
  img?: string;
  swatch?: string;
  notNeeded?: boolean;
}) {
  return (
    <figure
      className="m-0 overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--line)", background: "var(--card)" }}
    >
      {notNeeded ? (
        <div className="skeleton muted flex aspect-[3/4] items-center justify-center p-2 text-center text-xs">
          Not needed for this garment
        </div>
      ) : (
        <SafeImg src={img} alt={title} className="aspect-[3/4] w-full" />
      )}
      <figcaption className="flex items-center justify-between gap-2 p-2 text-xs">
        <b className="min-w-0 break-words">{title}</b>
        <span className="flex shrink-0 items-center gap-1">
          {swatch && (
            <i aria-hidden="true" className="inline-block h-3 w-3 rounded-full border" style={{ background: swatch }} />
          )}
          {sub}
        </span>
      </figcaption>
    </figure>
  );
}
