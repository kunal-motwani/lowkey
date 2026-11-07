/**
 * Procedural ambient score built on the Web Audio API. No audio files.
 * Nothing here touches window/AudioContext at import time (safe on SSR).
 */
import { MOOD_PARAMS, midiToFreq, planBar } from "@/lib/music-theory";
import type { BarPlan, Mood } from "@/lib/music-theory";

/** Tweakables (judge by ear). */
export const AUDIO_TUNING = {
  defaultVolume: 0.25,
  duckLevel: 0.3,
  fadeInSec: 2.5,
  fadeOutSec: 0.9,
  crossfadeSec: 3,
  lookaheadSec: 1.5,
  tickMs: 100,
  padLevel: 0.07,
  pluckLevel: 0.09,
  reverbSeconds: 4.5,
} as const;

interface Layer {
  gain: GainNode;
  mood: Mood;
}

type Ctor = typeof AudioContext;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AmbientMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private wet: GainNode | null = null;
  private dry: GainNode | null = null;
  private layer: Layer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private mood: Mood = "calm";
  private volume: number = AUDIO_TUNING.defaultVolume;
  private ducked = false;
  private running = false;
  private nextBarTime = 0;
  private barIndex = 0;
  private seed = 1;
  private onVis: (() => void) | null = null;

  get isPlaying(): boolean {
    return this.running;
  }

  /** Must be called from a user gesture (autoplay policy). Returns false if unsupported. */
  start(): boolean {
    if (this.running) return true;
    const Ctor = getCtor();
    if (!Ctor) return false;
    try {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      this.teardown();
      const ctx = new Ctor();
      this.ctx = ctx;
      this.seed = (Date.now() ^ (ctx.sampleRate << 3)) >>> 0;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.01;
      comp.release.value = 0.4;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(comp);
      comp.connect(ctx.destination);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.5;
      filter.frequency.value = MOOD_PARAMS[this.mood].cutoff;
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const verb = ctx.createConvolver();
      verb.buffer = this.makeImpulse(ctx, AUDIO_TUNING.reverbSeconds);
      filter.connect(dry);
      filter.connect(verb);
      verb.connect(wet);
      dry.connect(master);
      wet.connect(master);

      this.master = master;
      this.filter = filter;
      this.dry = dry;
      this.wet = wet;
      this.applyMoodBus(true);
      this.layer = this.makeLayer(this.mood, true);

      void ctx.resume();
      this.running = true;
      this.nextBarTime = ctx.currentTime + 0.15;
      this.barIndex = 0;
      this.applyMasterGain(AUDIO_TUNING.fadeInSec);
      this.timer = setInterval(() => this.tick(), AUDIO_TUNING.tickMs);
      this.tick();

      this.onVis = () => {
        const c = this.ctx;
        if (!c || !this.running) return;
        if (document.hidden) void c.suspend();
        else void c.resume();
      };
      document.addEventListener("visibilitychange", this.onVis);
      if (document.hidden) void ctx.suspend();
      return true;
    } catch {
      this.running = false;
      this.teardown();
      return false;
    }
  }

  /** Fade out, then close the context. */
  stop(): void {
    if (!this.running || !this.ctx || !this.master) return;
    this.running = false;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + AUDIO_TUNING.fadeOutSec);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void ctx.resume();
    this.closeTimer = setTimeout(
      () => {
        this.closeTimer = null;
        if (!this.running) this.teardown();
      },
      AUDIO_TUNING.fadeOutSec * 1000 + 100
    );
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : AUDIO_TUNING.defaultVolume));
    this.applyMasterGain(0.15);
  }

  /** Lower to ~30% while the camera is open. */
  duck(on: boolean): void {
    this.ducked = on;
    this.applyMasterGain(0.6);
  }

  /** Crossfades to a new mood; remembered if music has not started yet. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.running || !this.ctx) return;
    this.applyMoodBus(false);
    const old = this.layer;
    this.layer = this.makeLayer(mood, false);
    if (old) this.retireLayer(old);
  }

  dispose(): void {
    this.running = false;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.teardown();
  }

  // ---- internals ----

  private teardown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.onVis && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVis);
    }
    this.onVis = null;
    const ctx = this.ctx;
    this.ctx = this.master = this.filter = this.wet = this.dry = null;
    this.layer = null;
    if (ctx && ctx.state !== "closed") {
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }

  private applyMasterGain(rampSec: number): void {
    if (!this.ctx || !this.master || !this.running) return;
    const target = this.volume * (this.ducked ? AUDIO_TUNING.duckLevel : 1);
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(target, t + Math.max(0.05, rampSec));
  }

  private applyMoodBus(immediate: boolean): void {
    if (!this.ctx || !this.filter || !this.wet || !this.dry) return;
    const p = MOOD_PARAMS[this.mood];
    const t = this.ctx.currentTime;
    const k = immediate ? 0.01 : AUDIO_TUNING.crossfadeSec / 3;
    this.filter.frequency.setTargetAtTime(p.cutoff, t, k);
    this.wet.gain.setTargetAtTime(p.reverbMix, t, k);
    this.dry.gain.setTargetAtTime(1 - p.reverbMix * 0.5, t, k);
  }

  private makeLayer(mood: Mood, immediate: boolean): Layer {
    const ctx = this.ctx as AudioContext;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    if (immediate) gain.gain.setValueAtTime(1, t);
    else {
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + AUDIO_TUNING.crossfadeSec);
    }
    gain.connect(this.filter as BiquadFilterNode);
    return { gain, mood };
  }

  private retireLayer(layer: Layer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const fade = AUDIO_TUNING.crossfadeSec;
    layer.gain.gain.cancelScheduledValues(t);
    layer.gain.gain.setValueAtTime(layer.gain.gain.value, t);
    layer.gain.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(
      () => {
        try {
          layer.gain.disconnect();
        } catch {
          /* ignore */
        }
      },
      (fade + 12) * 1000
    );
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || ctx.state === "suspended") return;
    while (this.nextBarTime < ctx.currentTime + AUDIO_TUNING.lookaheadSec) {
      const layer = this.layer;
      if (!layer) return;
      const plan = planBar(this.mood, this.barIndex, this.seed);
      this.scheduleBar(plan, layer, Math.max(this.nextBarTime, ctx.currentTime));
      this.nextBarTime += plan.beats * plan.secondsPerBeat;
      this.barIndex += 1;
    }
  }

  private scheduleBar(plan: BarPlan, layer: Layer, t0: number): void {
    const spb = plan.secondsPerBeat;
    for (const n of plan.pads) {
      this.padVoice(layer, n.midi, t0 + n.startBeat * spb, n.durBeats * spb, n.gain);
    }
    for (const n of plan.plucks) {
      this.pluckVoice(layer, n.midi, t0 + n.startBeat * spb, n.durBeats * spb, n.gain, n.kind);
    }
  }

  private padVoice(layer: Layer, midi: number, t: number, dur: number, level: number): void {
    const ctx = this.ctx as AudioContext;
    const env = ctx.createGain();
    const peak = AUDIO_TUNING.padLevel * level;
    const attack = Math.min(2.2, dur * 0.45);
    const release = Math.min(2.8, dur * 0.6);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + Math.max(attack, dur - release * 0.3));
    env.gain.linearRampToValueAtTime(0, t + dur + release);
    env.connect(layer.gain);
    const types: OscillatorType[] = ["sine", "triangle"];
    const detunes = [-6, 5];
    types.forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detunes[i];
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + dur + release + 0.1);
      if (i === 0) osc.onended = () => safeDisconnect(env);
    });
  }

  private pluckVoice(layer: Layer, midi: number, t: number, dur: number, level: number, kind: "pluck" | "bell"): void {
    const ctx = this.ctx as AudioContext;
    const env = ctx.createGain();
    const peak = AUDIO_TUNING.pluckLevel * level;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    env.connect(layer.gain);
    const parts: [number, number, OscillatorType][] =
      kind === "bell"
        ? [
            [1, 1, "sine"],
            [2.76, 0.18, "sine"],
          ]
        : [[1, 1, "triangle"]];
    for (const [mult, g, type] of parts) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(midi) * mult;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og);
      og.connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.5);
      if (mult === 1) osc.onended = () => safeDisconnect(env);
    }
  }

  /** Decaying stereo noise: a cheap generated reverb impulse response. */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    let s = 0x1234abcd;
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const noise = (s / 4294967296) * 2 - 1;
        data[i] = noise * Math.pow(1 - i / len, 2.6);
      }
    }
    return buf;
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}
