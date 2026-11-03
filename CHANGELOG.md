# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Open-source documentation: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, architecture, scoring and API docs, issue and PR templates, `.editorconfig`.
- Local skin-tone estimate (`lib/tone-local.ts`) used and labelled "local estimate" when Skin Tone Analysis is not available for the key.
- Per-API key overrides (`YOUCAM_KEY_SKIN`, `_TONE`, `_CLOTHES`, `_MAKEUP`).
- `FLATTR_CACHE_DIR` for relocating the result cache.

### Changed
- Hackathon material moved to `docs/hackathon/` and marked historical.

### Security
- Upgraded `next` to 15.5.28 (fixes critical advisories) and `sharp` to 0.35.5 (libvips CVEs; `sharp` parses untrusted uploads).
- Known, accepted: `npm audit` still flags the PostCSS copy bundled inside Next 15 (build-time only, processes our own CSS, no user-controlled input). The fix requires Next 16, a breaking major, tracked as a separate upgrade.
- Added SSRF protection for garment URLs, upload size/type validation, image normalisation and per-IP rate limiting on `/api/analyze`.

### Added
- In-app camera capture: asks for camera permission, live preview with a face guide and a lighting check, 3-second timer, retake/accept, and starts the analysis automatically when a garment is already chosen. Handles denied, missing, busy and insecure-context cases, and releases the camera on close.

## [0.1.0]

- Initial hackathon prototype: Stylist Agent, Flattery engine, YouCam client with hash-keyed cache, SSE timeline UI.
