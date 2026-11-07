# Background music

Flattr plays a quiet, original ambient score across the whole site. It is generated live in the browser with the Web Audio API. There are no audio files, no samples and no third-party music, so there is nothing to license.

## How it works

- `lib/music-theory.ts` is pure and deterministic. It holds the moods, scales, chord progressions, a seeded PRNG (mulberry32) and `planBar(mood, barIndex, seed)`, which returns the pad chords and plucks for one 4-beat bar.
- `lib/ambient-music.ts` (`AmbientMusic`) turns plans into sound: sine/triangle pads with slow attack and release and slight detune, soft pluck and bell voices, a lowpass filter, a generated noise-decay reverb, and a compressor on the master. A look-ahead scheduler (`setInterval` plus `AudioContext.currentTime`) queues each bar about 1.5 s ahead, so timing does not drift.
- Mood changes create a new gain layer that fades in over about 3 s while the old one fades out, and the filter and reverb ramp to the new values. Nothing is switched abruptly, so there are no clicks.
- `components/MusicProvider.tsx` owns one engine and exposes `useMusic()`, `useMusicMood(mood)` and `useMusicDuck(active)`. `components/MusicToggle.tsx` is the fixed button and volume slider on every page.

Moods: `calm` (slow pads), `focus` (sparse, steady), `processing` (gentle pulsing arpeggio), `celebrate` (brighter, more open), `caution` (suspended, slightly minor-coloured, never alarming).

## Autoplay policy

Browsers refuse to start audio without a user gesture. The preference defaults to on, so the first `pointerdown` or `keydown` anywhere starts the music (that listener is added once and removed after it fires). Until then the toggle shows "Tap anywhere to start music" for a few seconds. The music never starts after the user turned it off.

The music pauses while the tab is hidden and resumes when it is visible again. While the camera is open the Wizard ducks it to about 30%.

## Privacy

The only thing stored is `localStorage["flattr:music"]`: `{ "on": boolean, "volume": number }`. Every storage access is wrapped in try/catch, and the page works if storage is blocked. Nothing is sent anywhere.

## Turning it off

- Use the speaker button (bottom right). The choice is remembered.
- Open any page with `?music=off` to prevent autostart for that visit. This does not change the stored preference.

## Adding a mood

1. Add the name to the `Mood` union and `MOODS` in `lib/music-theory.ts`.
2. Add an entry to `MOOD_PARAMS`: tempo, `scale`, `pluckScale` (a subset of `scale`), a `progression` of chords (semitone offsets from D3, all inside `scale`), `cutoff`, `padDensity`, `pluckDensity`, `brightness`, `reverbMix`, `arpeggio`.
3. Run `npx vitest run tests/music-theory.test.ts`. It checks that every chord and pluck stays inside the scale and that parameters are in range.
4. Call `useMusicMood("your-mood")` where it should play.

## Tuning by ear

The synthesis was not auditioned by the developers' tooling; judge it by listening. Constants to adjust: `AUDIO_TUNING` in `lib/ambient-music.ts` (`padLevel`, `pluckLevel`, `crossfadeSec`, `duckLevel`, `reverbSeconds`, `defaultVolume`) and the per-mood values in `MOOD_PARAMS`.
