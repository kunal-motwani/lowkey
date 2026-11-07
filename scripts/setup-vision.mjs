#!/usr/bin/env node
/**
 * Self-host MediaPipe Tasks Vision assets so the browser never talks to a third-party CDN.
 *  - copies node_modules/@mediapipe/tasks-vision/wasm/*  -> public/mediapipe/wasm
 *  - downloads the BlazeFace short-range face detector and the pose landmarker (lite)
 *    from the official MediaPipe model storage into public/models
 * Usage: npm run setup:vision   (add --force to re-download)
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const MIN_BYTES = 100 * 1024;

const MODELS = [
  {
    file: "blaze_face_short_range.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
let failed = false;

// 1. wasm runtime
const wasmSrc = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = path.join(root, "public", "mediapipe", "wasm");
try {
  await mkdir(wasmDst, { recursive: true });
  for (const name of await readdir(wasmSrc)) {
    await copyFile(path.join(wasmSrc, name), path.join(wasmDst, name));
    const buf = await readFile(path.join(wasmDst, name));
    console.log(`wasm  ${name}  ${buf.length} bytes  sha256 ${sha(buf)}`);
  }
} catch (e) {
  failed = true;
  console.error(`FAILED to copy wasm from ${wasmSrc}: ${e.message}. Run npm install first.`);
}

// 2. models
await mkdir(path.join(root, "public", "models"), { recursive: true });
for (const m of MODELS) {
  const dst = path.join(root, "public", "models", m.file);
  try {
    if (!force) {
      const s = await stat(dst).catch(() => null);
      if (s && s.size >= MIN_BYTES) {
        console.log(`model ${m.file}  ${s.size} bytes  sha256 ${sha(await readFile(dst))}  (kept)`);
        continue;
      }
    }
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${m.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES) throw new Error(`download too small (${buf.length} bytes)`);
    await writeFile(dst, buf);
    console.log(`model ${m.file}  ${buf.length} bytes  sha256 ${sha(buf)}`);
  } catch (e) {
    failed = true;
    console.error(`FAILED model ${m.file}: ${e.message}`);
  }
}

if (failed) {
  console.error("setup-vision finished with errors; live guidance falls back to heuristic checks.");
  process.exit(1);
}
console.log("setup-vision done.");
