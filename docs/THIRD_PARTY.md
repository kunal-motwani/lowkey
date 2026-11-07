# Third-party components

| Component | Version | Licence | Use |
| --- | --- | --- | --- |
| `@mediapipe/tasks-vision` (JS + WASM runtime) | 1.2.2 | Apache-2.0 | In-browser face and pose detection. WASM copied to `public/mediapipe/wasm` by `npm run setup:vision`. |
| BlazeFace short-range face detector (`blaze_face_short_range.tflite`) | float16 v1 | Apache-2.0 | Face detection for the photo quality gate. Stored in `public/models`. |
| MediaPipe Pose Landmarker lite (`pose_landmarker_lite.task`) | float16 v1 | Apache-2.0 | Body detection for the full-body photo check. Stored in `public/models`. |
| MediaPipe Hand Landmarker (`hand_landmarker.task`) | float16 v1 | Apache-2.0 | Hand detection for the bracelet/ring hand photo check. Stored in `public/models`. |

Models come from the official MediaPipe model storage:

- https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0. Copyright Google LLC. The files are redistributed unmodified.

## Checksums (sha256)

- `blaze_face_short_range.tflite` b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f
- `pose_landmarker_lite.task` 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
- `hand_landmarker.task` fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1 (7819105 bytes)
