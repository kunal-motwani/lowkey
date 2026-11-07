# Photo quality gate

Before an outfit is analysed, every face and body photo (uploaded or captured) is checked in the browser. The aim is to catch YouCam errors such as "the face is too small (must take up more than 60% of the image width)" or "no face detected" up front, with tips to fix them.

Code: `lib/photo-quality.ts` (checks), `components/PhotoPicker.tsx` (upload + camera + checklist), `components/PhotoCapture.tsx` (camera with live guidance). Thresholds are named constants at the top of `lib/photo-quality.ts`.

## Face photo (close-up)

| Check | Pass | Warn | Fail |
| --- | --- | --- | --- |
| Face found | one or more | | none |
| One person | exactly one | | more than one |
| Face size | face box width >= 60% of image width | | below 60% ("Move closer until your face fills the oval") |
| Centred | within 10% (x) / 15% (y) of target | up to 20% / 28% | further off |
| Whole face in frame | 2% margin | touching the edge | cut off |
| Lighting | mean luma 70-215, even | dark/bright, or left/right difference > 60 | luma < 45 or > 240 |
| Sharpness | Laplacian variance >= 45 | 18-45 | < 18 |
| Resolution | shorter side >= 768 | 512-767 | < 512 |

The 60% rule is YouCam's, so it is a hard fail with no warn band. The face box comes from BlazeFace (a tight box around the face), which is close to YouCam's measure but not identical, so keep a little margin: the live oval is sized so a face filling it is about 64% of the width.

## Body photo (full length)

Detected with the MediaPipe Pose Landmarker (lite). Needs head, shoulders, hips, knees and ankles with visibility >= 0.5 and inside the frame, head-to-feet span >= 70% of the image height, one person, shoulders roughly square to the camera (shoulder width / torso length >= 0.55 warns below, 0.3 fails below), upright (shoulder tilt <= 12 degrees, lean <= 15 degrees, else warn). Lighting, sharpness and resolution use the same rules as above. Landscape photos get a warning (portrait 3:4 is preferred).

## Camera

The camera modal runs detection about 4 times per second on the 3:4 centre crop (the same crop that is saved), shows the single most important message ("Move closer", "Centre your face", "Too dark: face a window", "Step back so your whole body fits"), and turns the shutter green when everything passes. After the 3 s timer the full check runs on the captured image. A failing photo can only be retaken; warnings allow "Use anyway".

## Behaviour and limits

- A failing photo is rejected: `PhotoPicker` calls `onChange(null, report)`. Warn-only photos are accepted.
- If the models cannot load (offline, blocked WASM, old browser) a warning "Automatic face/body check unavailable" is shown and lighting, sharpness and resolution checks still run. Nothing throws.
- This is not face recognition or identification. It only finds whether and where a face or body is in the frame. No landmarks or embeddings are stored.
- Nothing leaves the browser: the models and WASM runtime are self-hosted (`/models`, `/mediapipe/wasm`, populated by `npm run setup:vision`), so no third-party CDN is contacted. See `THIRD_PARTY.md`.
- Heuristics are approximate: pose models can miss people in unusual clothing or poses, and sharpness depends on image content (a plain wall scores low). Thresholds are tuned conservatively; adjust the constants if real photos are rejected wrongly.
