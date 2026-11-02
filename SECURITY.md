# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository. Include steps to reproduce and the impact. We aim to acknowledge reports within a few days.

## Scope notes

- API keys (`YOUCAM_API_KEY`, `YOUCAM_KEY_*`, `ANTHROPIC_API_KEY`) are read from environment variables only. Never commit `.env`. If you leak a key, rotate it immediately.
- `POST /api/analyze` fetches user-supplied `garmentUrl` / `selfieUrl` server-side, so SSRF hardening and upload size limits are relevant areas for review.
- User images are sent to third-party APIs (YouCam, and only text summaries to Anthropic). The only local persistence is the result cache keyed by image hash.

## Supported versions

Only the latest `main` is supported.
