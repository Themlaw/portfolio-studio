#!/usr/bin/env node
/**
 * Lot 85 : inventaire STATIQUE des endroits qui écrivent dans /data. Tout fichier de src/ qui écrit (stockage `.put(`, writeFile,
 * createWriteStream, mkdir) doit figurer dans la table ci-dessous AVEC sa catégorie de sauvegarde (voir docs/SAUVEGARDES.md et
 * src/lib/backup/archive.ts). Un nouvel écrivain non classé fait ÉCHOUER ce test : on doit alors décider, noir sur blanc, si ce qu'il
 * écrit est (a) couvert par la table media, (b) régénérable, (c) à sauvegarder (alors : l'archive le prend par défaut si c'est sous media/,
 * sinon l'ajouter à archive.ts et au script de restauration), ou (t) temporaire / hors données.
 * Usage : node scripts/test-storage-writers85.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITES = /(\.put\(|writeFile(Sync)?\(|createWriteStream\(|\bmkdir(Sync)?\()/;

/** fichier → [catégorie, ce qu'il écrit] */
const TABLE = {
  "src/lib/backup/archive.ts": ["t", "archives backup/ (exclu), instantané .tmp"],
  "src/lib/backup/service.ts": ["t", "backup/state.json"],
  "src/lib/db/index.ts": ["a", "dossier de données, portfolio.db"],
  "src/lib/db/seed.ts": ["a", "médias du seed : lignes media + media/ racine ou vid/ (sauvegardés : clé hors originals/)"],
  "src/lib/db/writable.ts": ["t", "sonde .ecriture-<pid>"],
  "src/lib/edit/frames.ts": ["c", "media/kit/ (cadres importés) : sauvegardé par défaut"],
  "src/lib/favicon.ts": ["c", "media/icons/<id>/ (image choisie, sauvegardé) ; media/icons-auto/ (régénérable, exclu)"],
  "src/lib/fonts/library.ts": ["c", "fonts/ (sauvegardé) ; fonts/preview/"],
  "src/lib/images/crop-cache.ts": ["b", "cache/crops (régénérable, vidé à la restauration)"],
  "src/lib/images/process.ts": ["b", "media/img/ (variantes) ; tmp/"],
  "src/lib/kit/apply.ts": ["c", "media/kit/ (dessins du kit appliqués) : sauvegardé par défaut"],
  "src/lib/kit/build-multi.ts": ["b", "cache/kits (export du kit), fiches : cache/kits/manifests (sauvegardées, exception)"],
  "src/lib/kit/build.ts": ["b", "cache/kits, aperçus des fiches (sauvegardés avec elles)"],
  "src/lib/kit/child.ts": ["b", "cache/kits"],
  "src/lib/kit/export-job.ts": ["b", "cache/kits"],
  "src/lib/kit/import-job.ts": ["t", "kit-imports/ (exclu : renvoyer le PSD)"],
  "src/lib/kit/import.ts": ["t", "kit-imports/<id>/out"],
  "src/lib/kit/logo.ts": ["c", "media/kit/ (logo depuis la médiathèque) : sauvegardé par défaut"],
  "src/lib/kit/manifest.ts": ["c", "cache/kits/manifests (fiches de kit : sauvegardées, exception à cache/)"],
  "src/lib/kit/zip-archive.ts": ["b", "cache/kits (zip d'export)"],
  "src/lib/pdf/ingest.ts": ["a", "media/originals/"],
  "src/lib/pdf/poppler.ts": ["t", "tmp/pdf-*"],
  "src/lib/pdf/render.ts": ["b", "media/doc/ (variantes) ; tmp/"],
  "src/lib/storage/local.ts": ["a", "implémentation du stockage (media/)"],
  "src/lib/themes/transfer.ts": ["c", "media/kit/ (archive de thème importée) : sauvegardé par défaut"],
  "src/lib/upload/chunks.ts": ["t", "tmp/uploads"],
  "src/lib/upload/ingest.ts": ["a", "media/originals/"],
  "src/lib/upload/receive.ts": ["t", "tmp/"],
  "src/lib/video/ingest.ts": ["a", "media/originals/"],
  "src/lib/video/transcode.ts": ["b", "media/vid/ (variantes ; sauvegardées si l'original est supprimé) ; tmp/"],
};

const files = [];
const walk = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(d.name) && WRITES.test(readFileSync(p, "utf8"))) files.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
};
walk(path.join(ROOT, "src"));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const unclassified = files.filter((f) => !TABLE[f]).sort();
ok("lot 85 : tout écrivain de src/ est classé dans la table des sauvegardes (nouvel écrivain = décider a/b/c/t)", unclassified.length === 0, `non classés : ${unclassified.join(", ")} — ajoute-les à TABLE de scripts/test-storage-writers85.mjs en décidant si leurs fichiers doivent être sauvegardés`);
const stale = Object.keys(TABLE).filter((f) => !files.includes(f)).sort();
ok("lot 85 : la table ne cite pas de fichier qui n'écrit plus", stale.length === 0, stale.join(", "));
console.log(`INFO ${files.length} fichiers écrivent ; (c) à sauvegarder : ${Object.entries(TABLE).filter(([, v]) => v[0] === "c").map(([f]) => path.basename(f)).join(", ")}`);
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
