# Contributing to Flattr

Thanks for helping. Flattr is MIT-licensed and welcomes issues and pull requests.

## Setup

```bash
npm install
cp .env.example .env     # add your own keys; never commit .env
npm run dev
```

With no YouCam key you can still explore using `DEMO_MODE=1` and cached results (see [docs/CACHE.md](docs/CACHE.md)).

## Before you open a PR

- `npm run lint` and `npm run build` pass.
- If you touched `lib/flattery.ts`, run `npx tsx scripts/score-check.ts`.
- Update docs (`docs/SCORING.md`, `docs/API.md`, README config table) when behaviour changes, and add a line to `CHANGELOG.md`.
- Keep PRs focused; describe what changed and why.

## Ground rules

- Never commit secrets, `.env`, or real user photos.
- Never fabricate cache entries, screenshots, benchmark numbers or API results. Cache files must come from real runs.
- Keep wording risk-based ("can", "tends to"); do not claim precise optical effects or medical outcomes.
- Be honest in docs about what is estimated versus measured.

## Adding a scoring rule

See "How to extend" in [docs/SCORING.md](docs/SCORING.md).

## Reporting bugs and ideas

Use the issue templates. For security problems, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

By contributing you agree your work is licensed under the MIT licence.
