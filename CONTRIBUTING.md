# Contributing

Thanks for your interest in Portfolio Studio! This document explains how to set up a development environment, run the tests and open a pull request.

## Development setup

You need Node.js 24 and npm. Docker is only needed if you want to build the production image.

```bash
git clone https://github.com/Themlaw/portfolio-studio.git
cd portfolio-studio
npm ci
cp .env.example .env   # set BETTER_AUTH_SECRET (openssl rand -base64 48)
npm run dev -- -p 3001
```

The site is available at http://localhost:3001 and the admin at http://localhost:3001/admin. On first start the SQLite database is created in `data/` and seeded with a synthetic demo site; delete the `data/` folder to start over.

> [!NOTE]
> The repository's `.npmrc` sets `ignore-scripts=true`: `npm ci` never runs install scripts from dependencies. Nothing needs to be rebuilt (`better-sqlite3` and `esbuild` ship prebuilt binaries).

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npx tsc --noEmit` | Type check |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (a few minutes) |
| `scripts/test-all-local.sh [suite…]` | End-to-end suites (Playwright), each with a fresh database and server |
| `npm run build` | Production build |
| `npm run audit:public` | Checks the whole history for secrets, private data and forbidden files |

`BATT_SERVER=start BATT_JOBS=2 scripts/test-all-local.sh` runs the end-to-end suites against production builds, two at a time. The Photoshop fixture used by the theme kit tests is synthetic and generated on demand (`npm run fixture:psd -- --if-missing`).

## Project structure

- `src/app`: routes (public site under `[locale]`, admin under `admin`)
- `src/blocks`: page blocks (schema, rendering, editors)
- `src/components`: shared components, including the visual editor
- `src/lib`: data access, media processing, themes, backups, authentication
- `src/themes`: theme engine and presets
- `messages`: translations (see below)
- `drizzle`: database migrations, applied automatically on start
- `scripts`: tests and maintenance scripts
- `docs`: technical documentation (in French)

## Translations

Public texts live in `messages/fr.json` and `messages/en.json`. Admin texts are split by area in `messages/admin-parts/*.{fr,en}.json` and assembled with:

```bash
node scripts/admin-messages.mjs
```

French and English files must have the same keys. `node --import tsx scripts/test-adminlang130.mjs` checks that no French string is hard-coded in the admin and that every key used in the code exists.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Add or update tests: every bug fix comes with a test that fails without the fix.
4. Run `npx tsc --noEmit`, `npm run lint` and `npm test`, plus the end-to-end suites related to your change.
5. Describe what you changed and why, with screenshots for visual changes.

The CI runs the type check, lint, unit tests, the build and the end-to-end suites (split into shards) on every pull request.

### Commit messages

Write short, descriptive commit messages in the imperative mood (in English or French), for example `Fix tile cover when a collection has no displayed project`.

## Data and privacy

Never commit real artwork, personal data or secrets. All fixtures and demo content must be synthetic. The `audit:public` check runs in CI and will fail the build if something slips through.

## Reporting bugs and requesting features

Open an issue with the steps to reproduce, what you expected and what happened, plus the version (`vX.Y.Z` or commit) and browser. For security issues, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
