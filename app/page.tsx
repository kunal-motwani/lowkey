"use client";
import { useState } from "react";

import Wizard from "@/components/Wizard";

export default function Home() {
  const [started, setStarted] = useState(false);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24">
      <header className="flex items-center justify-between py-5">
        <button
          onClick={() => setStarted(false)}
          aria-label="Flattr home"
          className="rounded-md text-xl font-bold tracking-tight"
        >
          flattr<span className="accent">.</span>
        </button>
        <span className="muted text-xs">Powered by YouCam APIs</span>
      </header>

      {!started ? (
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
            Garment colour bounces onto your face and can amplify what your skin is doing today. Flattr reads your skin,
            scores each piece, and shows you exactly why.
          </p>
          <button onClick={() => setStarted(true)} className="btn-primary mt-8">
            Check an outfit
          </button>
          <p className="muted mt-3 text-xs">No account. Four short steps.</p>
          <ol className="mt-12 grid list-none gap-3 p-0 text-left sm:grid-cols-3">
            {[
              ["1. Read", "Skin analysis from one close-up photo"],
              ["2. Score", "A transparent rule set ties each garment colour to your skin readings"],
              ["3. Fix", "See the outfit on you, plus a better colour or makeup that helps"],
            ].map(([t, d]) => (
              <li key={t} className="card">
                <b>{t}</b>
                <p className="muted mt-1 text-sm">{d}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <Wizard onExit={() => setStarted(false)} />
      )}
    </main>
  );
}
