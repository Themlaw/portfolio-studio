<h1 align="center">Portfolio Studio</h1>

<p align="center">
  <i>A self-hosted portfolio for illustrators and animators, with a visual page editor, a theme engine and a Photoshop theme kit.</i>
</p>

<p align="center">
  <a href="https://github.com/Themlaw/portfolio-studio/releases"><img src="https://img.shields.io/github/v/release/Themlaw/portfolio-studio" alt="Latest release" /></a>
  <a href="https://github.com/Themlaw/portfolio-studio/actions/workflows/tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/Themlaw/portfolio-studio/tests.yml?branch=main&label=tests" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Themlaw/portfolio-studio" alt="License: AGPL-3.0" /></a>
</p>

---

Portfolio Studio started as the website of a 2D artist (character design, backgrounds, animation) and grew into a small CMS built around how artists actually show their work: boards, collections, before/after steps, frame-by-frame animations. Everything runs from a single Docker image with an SQLite database, so it fits on a small VPS.

The interface is available in French and English, for both visitors and the admin.

## ✨ Features

- **Visual page editor**: compose pages from blocks directly on the canvas (text, images, grids, free-form boards, carousels, videos, steps, contact form…), with drafts, undo/redo and copy/paste of blocks and styles between pages.
- **Projects and collections**: group works into projects and collections; the home page builds its category tiles from them.
- **Media library**: images, videos (sound, fullscreen, custom icons) and PDFs, with responsive AVIF/WebP variants, cropping and usage tracking before deletion.
- **Animations**: frame-by-frame animations with configurable frame rate and loop, and a "boiling line" effect for drawn elements.
- **Themes**: design tokens, layout variants, curated font catalogue and a contrast checker. Import a **Photoshop theme kit** (logo, paper texture, frames, arrows, cursors, icons) and the site is dressed with your own drawings.
- **Device preview**: check every page at desktop, wide-screen, tablet and phone widths before publishing.
- **Bilingual**: French and English content side by side, with per-language URLs and hreflang.
- **Built-in backups**: automatic archives (database and media) with retention rules and a one-command restore.
- **Security first**: password or OpenID Connect login (e.g. Authentik), brute-force protection, strict security headers, read-only distroless container.

## 🚀 Getting started

### With Docker (recommended)

A ready-to-use `docker-compose.yml` is provided. It expects a reverse proxy in front of the container (Traefik, Caddy, Pangolin…).

```bash
curl -O https://raw.githubusercontent.com/Themlaw/portfolio-studio/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Themlaw/portfolio-studio/main/.env.example
```

Edit `.env` and set at least:

```bash
PUBLIC_BASE_URL=https://portfolio.example.org
BETTER_AUTH_SECRET=   # generate with: openssl rand -base64 48
ADMIN_EMAIL=you@example.org
ADMIN_PASSWORD=       # 12 characters or more
```

Then start it:

```bash
docker compose up -d
```

The admin lives at `/admin`. The first administrator is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first start; you can remove these two lines afterwards.

### From source

Requirements: Node.js 24 and npm.

```bash
git clone https://github.com/Themlaw/portfolio-studio.git
cd portfolio-studio
npm ci
cp .env.example .env   # set BETTER_AUTH_SECRET
npm run dev -- -p 3001
```

Open http://localhost:3001 (admin at http://localhost:3001/admin). On first start the database is created and filled with a synthetic demo site.

## ⚙️ Configuration

All settings are environment variables, documented in [`.env.example`](.env.example). The most common ones:

| Variable | Description |
|---|---|
| `PUBLIC_BASE_URL` | Public URL of the site (required in production). |
| `BETTER_AUTH_SECRET` | Session secret, 32 characters or more (required). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First administrator, created if no account exists yet. |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | Optional OpenID Connect login. |
| `AUTH_TRUSTED_PROXY_HOPS` | Number of reverse proxies in front of the app (default `1`). |
| `MEDIA_MAX_TOTAL_GB` | Optional storage quota for media. |
| `REDIRECT_FROM` | Old domains to redirect to `PUBLIC_BASE_URL` when you move the site. |

## 📚 Documentation

The detailed documentation is in French, in the [`docs`](docs) folder:

- [Full guide: installation, deployment, upgrades](docs/GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Themes](docs/THEMES.md) and [Photoshop theme kit](docs/THEME-KIT.md)
- [Backups and restore](docs/SAUVEGARDES.md)
- [Changing domain](docs/DOMAINE.md)
- [Activity log](docs/JOURNAL.md)

## 🧱 Tech stack

Next.js (App Router), TypeScript, Tailwind CSS, next-intl, SQLite with Drizzle ORM, Better Auth, sharp and ffmpeg for media, Playwright for end-to-end tests.

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. To report a security issue, see [SECURITY.md](SECURITY.md).

## 📄 License

Portfolio Studio is released under the [GNU AGPL-3.0](LICENSE). The demo content, fixtures and screenshots in this repository are synthetic.
