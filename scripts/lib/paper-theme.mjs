/**
 * Aide e2e (lot 17c) : un thème « Papier de cœurs » = une copie de « Carnet d'atelier » avec une tuile de
 * cœurs en fond (papier du kit), comme le thème de l'illustratrice. Écrit directement en base et dans le
 * stockage (le kit Photoshop complet est testé ailleurs : e2e-kit-theme) ; à mettre en ligne ensuite depuis
 * l'écran Thèmes (qui purge le cache du thème).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export const PAPER_THEME_ID = "papier-coeurs";
export const PAPER_THEME_NAME = "Papier de cœurs";
const PAPER_KEY = "c0e4a2c0e4a20001";

/** Tuile 160 × 160 (affichée à 80 px) : cœurs rosés espacés, fond transparent. */
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><g fill="#e0a3b5" fill-opacity="0.55"><path d="M40 62 C20 46 22 24 38 24 C46 24 40 32 40 32 C40 32 34 24 42 24 C58 24 60 46 40 62Z" transform="translate(0 6) scale(1.1)"/><path d="M120 142 C100 126 102 104 118 104 C126 104 120 112 120 112 C120 112 114 104 122 104 C138 104 140 126 120 142Z" transform="translate(-6 -2) scale(1.1)"/></g></svg>`;

/**
 * Options (lot 28) : `id`, `name`, `key` (16 hex, nom du fichier), `tile` (SVG), `paper` (réglages ajoutés à `assets.kit.paper`, ex. onCards)
 * pour poser un second papier, à dessins contrastés, sans toucher au thème « Papier de cœurs ».
 */
export function installPaperTheme(dataDir, opts = {}) {
  const id = opts.id ?? PAPER_THEME_ID;
  const name = opts.name ?? PAPER_THEME_NAME;
  const key = opts.key ?? PAPER_KEY;
  const dir = path.join(dataDir, "media", "kit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${key}.svg`), opts.tile ?? TILE);
  const db = new Database(path.join(dataDir, "portfolio.db"));
  try {
    const base = JSON.parse(db.prepare("select data from themes where id = 'carnet-d-atelier'").get().data);
    const theme = {
      ...base,
      id,
      name,
      preset: false,
      assets: { ...base.assets, kit: { paper: { image: { svg: `/media/kit/${key}.svg`, w: 160, h: 160 }, ...(opts.paper ?? {}) } } },
    };
    db.prepare("insert or replace into themes (id, name, preset, data, updated_at) values (?, ?, 0, ?, unixepoch())").run(id, name, JSON.stringify(theme));
  } finally {
    db.close();
  }
}
