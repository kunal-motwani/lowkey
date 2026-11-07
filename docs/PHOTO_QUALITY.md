# Photo quality gate

Before an outfit is analysed, every face, body and hand photo (uploaded or captured) is checked in the browser. The aim is to catch YouCam errors such as "the face is too small (must take up more than 60% of the image width)" or "no face detected" up front, with tips to fix them.

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
| Neck and shoulders | space below the chin >= 25% of the face height | less than that (tip: "Include your neck and shoulders so necklaces can be shown") | never |

The neck check exists for necklace/earring try-on; it is warn-only and does not change the 60% rule.

The 60% rule is YouCam's, so it is a hard fail with no warn band. The face box comes from BlazeFace (a tight box around the face), which is close to YouCam's measure but not identical, so keep a little margin: the live oval is sized so a face filling it is about 64% of the width.

## Body photo (full length)

Detected with the MediaPipe Pose Landmarker (lite). Needs head, shoulders, hips, knees and ankles with visibility >= 0.5 and inside the frame, head-to-feet span >= 70% of the image height, one person, shoulders roughly square to the camera (shoulder width / torso length >= 0.55 warns below, 0.3 fails below), upright (shoulder tilt <= 12 degrees, lean <= 15 degrees, else warn). Lighting, sharpness and resolution use the same rules as above. Landscape photos get a warning (portrait 3:4 is preferred).

## Hand photo (back of the hand, for bracelets and rings)

Detected with the MediaPipe Hand Landmarker (21 landmarks per hand). Tip shown to users: "Place your hand flat, back of the hand towards the camera, fingers slightly apart, wrist in view".

| Check | Pass | Warn | Fail |
| --- | --- | --- | --- |
| Hand found | one or more | | none |
| One hand | exactly one | | more than one |
| All fingers in frame | all landmarks inside the frame, 2% margin | touching the edge | any fingertip (or 3+ landmarks) outside |
| Hand size | landmark box width or height >= 35% of the image | | below 35% |
| Wrist visible | inside the frame, >= 5% from the edge | closer than 5% to the edge | outside the frame |
| Back of hand | back faces the camera | palm side, or cannot tell | never |
| Fingers flat | fingers extended and mean fingertip gap >= 0.4 palm widths | curled or pressed together | never |
| Lighting, sharpness, resolution | as above | | |

Back of the hand is a heuristic: the sign of the cross product (wrist to index knuckle) x (wrist to pinky knuckle) combined with the handedness label (MediaPipe assumes a mirrored image; our photos are not mirrored so the label is flipped). Low handedness confidence (< 0.6) or a palm reading is only ever a warning. Constants: `HAND_*` and `NECK_MIN_BELOW_CHIN_RATIO` in `lib/photo-quality.ts`.

## Camera

The camera modal (face, body or hand outline; body and hand modes have a Flip camera button) runs detection about 4 times per second on the 3:4 centre crop (the same crop that is saved), shows the single most important message ("Move closer", "Centre your face", "Too dark: face a window", "Step back so your whole body fits"), and turns the shutter green when everything passes. After the 3 s timer the full check runs on the captured image. A failing photo can only be retaken; warnings allow "Use anyway".

`PhotoPicker` has an optional `onCameraOpenChange(open)` prop, called with true when its camera modal opens and false when it closes (including unmount while open), so the page can e.g. lower background music.

## Behaviour and limits

- A failing photo is rejected: `PhotoPicker` calls `onChange(null, report)`. Warn-only photos are accepted.
- If the models cannot load (offline, blocked WASM, old browser) a warning "Automatic face/body check unavailable" is shown and lighting, sharpness and resolution checks still run. Nothing throws.
- This is not face recognition or identification. It only finds whether and where a face or body is in the frame. No landmarks or embeddings are stored.
- Nothing leaves the browser: the models and WASM runtime are self-hosted (`/models`, `/mediapipe/wasm`, populated by `npm run setup:vision`), so no third-party CDN is contacted. See `THIRD_PARTY.md`.
- Heuristics are approximate: pose models can miss people in unusual clothing or poses, and sharpness depends on image content (a plain wall scores low). Thresholds are tuned conservatively; adjust the constants if real photos are rejected wrongly.
