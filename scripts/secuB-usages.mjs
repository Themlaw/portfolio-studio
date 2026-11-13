#!/usr/bin/env node
/**
 * Sécurité v1.0 : #46, icône de l'onglet et images de partage comptées dans les usages des médias ; icônes purgées avec leur média.
 * Base synthétique (seed + bootstrap), médias à la corbeille depuis 60 jours. PASS = aucun média encore utilisé n'est purgé.
 * Usage : node --import tsx scripts/secuB-usages.mjs
 * Sur v0.34.0 : la purge supprime l'original et les variantes d'une image qui sert encore d'icône ou d'image de partage.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { emit, finish, info, ok, ROOT } from "./lib/secu-b.mjs";

const SELF = new URL(import.meta.url).pathname;

if (process.argv[2] === "child") {
  const dir = process.env.DATA_DIR;
  const log = console.log;
  console.log = () => {};
  const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
  await bootstrap();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const { purgeTrash } = await import("../src/lib/edit/trash.ts");
  const { mediaUsagesByMedia } = await import("../src/lib/references.ts");
  const db = getDb();
  const old = new Date(Date.now() - 60 * 86_400_000);
  const made = {};
  const mk = (name, withIcons = false) => {
    mkdirSync(path.join(dir, "media/originals"), { recursive: true });
    mkdirSync(path.join(dir, `media/img/${name.padEnd(16, "0")}`), { recursive: true });
    writeFileSync(path.join(dir, `media/originals/${name}.png`), "png-synthetique");
    writeFileSync(path.join(dir, `media/img/${name.padEnd(16, "0")}/800.webp`), "variante");
    const id = db
      .insert(schema.media)
      .values({ key: `originals/${name}.png`, sha256: name.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: `${name}.png`, size: 15, status: "ready", width: 800, height: 600, deletedAt: old, variants: { v: 1, files: [{ key: `img/${name.padEnd(16, "0")}/800.webp`, size: 8, format: "webp", width: 800 }] }, alt: { fr: "", en: "" } })
      .returning({ id: schema.media.id })
      .get().id;
    if (withIcons) {
      mkdirSync(path.join(dir, `media/icons/${id}-${name.slice(0, 8)}`), { recursive: true });
      writeFileSync(path.join(dir, `media/icons/${id}-${name.slice(0, 8)}/512.png`), "icone");
    }
    made[name] = { id, original: path.join(dir, `media/originals/${name}.png`), icons: path.join(dir, `media/icons/${id}-${name.slice(0, 8)}`) };
    return id;
  };
  const share = mk("partage");
  const fav = mk("favicon", true);
  const pageImg = mk("pagepub");
  const draftImg = mk("pagebrouillon");
  const free = mk("libre", true);
  const home = db.select({ id: schema.pages.id }).from(schema.pages).orderBy(schema.pages.id).get().id;
  db.insert(schema.settings).values({ key: "seo", value: JSON.stringify({ description: { fr: "", en: "" }, shareImage: share, favicon: { mediaId: fav, dir: `icons/${fav}-favicon` } }) }).run();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, home)).get();
  db.update(schema.pages).set({ meta: { ...(page.meta ?? {}), image: pageImg }, draft: { ...(page.draft ?? {}), meta: { image: draftImg } } }).where(eq(schema.pages.id, home)).run();
  const usages = mediaUsagesByMedia();
  const counted = Object.fromEntries(Object.entries({ share, fav, pageImg, draftImg, free }).map(([k, id]) => [k, usages.get(id)?.length ?? 0]));
  const report = await purgeTrash();
  const alive = (n) => existsSync(made[n].original) && Boolean(db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, made[n].id)).get());
  let liveSeoFavicon = "absent";
  try {
    const { readLiveSeo } = await import("../src/lib/edit/seo.ts");
    liveSeoFavicon = typeof readLiveSeo === "function" ? (readLiveSeo().favicon === null ? "null" : "garde") : "absent";
  } catch (e) {
    liveSeoFavicon = `erreur ${String(e).slice(0, 60)}`;
  }
  console.log = log;
  emit({ counted, report, alive: { partage: alive("partage"), favicon: alive("favicon"), pagepub: alive("pagepub"), pagebrouillon: alive("pagebrouillon"), libre: alive("libre") }, faviconIcons: existsSync(made.favicon.icons), libreIcons: existsSync(made.libre.icons), liveSeoFavicon });
  process.exit(0);
}

const tmp = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-usages-"));
const r = spawnSync(process.execPath, ["--import", "tsx", SELF, "child"], { cwd: ROOT, env: { ...process.env, DATA_DIR: tmp }, encoding: "utf8", timeout: 180_000 });
const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
if (!line) {
  console.log(r.stdout.slice(-500), r.stderr.slice(-800));
  ok("SB46 le test s'exécute", false);
  finish();
}
const o = JSON.parse(line.slice(7));
info("usages comptés (média → nombre)", JSON.stringify(o.counted));
info("purge", JSON.stringify(o.report));
ok("SB46 image de partage du site comptée comme usage", o.counted.share > 0, String(o.counted.share));
ok("SB46 icône de l'onglet comptée comme usage", o.counted.fav > 0, String(o.counted.fav));
ok("SB46 image de partage d'une page (publiée) comptée", o.counted.pageImg > 0);
ok("SB46 image de partage d'une page (brouillon) comptée", o.counted.draftImg > 0);
ok("SB46 aucun média inutilisé n'est compté à tort", o.counted.free === 0);
ok("SB46 l'image de partage du site n'est PAS purgée (original et ligne conservés)", o.alive.partage, o.alive.partage ? "" : "PURGÉE alors qu'elle sert encore");
ok("SB46 l'image qui sert d'icône n'est PAS purgée", o.alive.favicon, o.alive.favicon ? "" : "PURGÉE alors qu'elle sert encore");
ok("SB46 l'image de partage d'une page publiée n'est PAS purgée", o.alive.pagepub);
ok("SB46 l'image de partage d'un brouillon de page n'est PAS purgée", o.alive.pagebrouillon);
ok("SB46 le média libre (à la corbeille depuis 60 jours) est bien purgé (la purge fonctionne toujours)", !o.alive.libre);
ok("SB46 les icônes déclinées d'un média purgé partent avec lui (plus de /site-icon servi à vie)", !o.libreIcons, o.libreIcons ? "icons/<id>-… resté sur le disque" : "");
ok("SB46 les icônes d'un média encore utilisé restent", o.faviconIcons);
ok("SB46 le réglage lu oublie une icône dont le média a disparu (readLiveSeo)", o.liveSeoFavicon === "null" || o.alive.favicon, `readLiveSeo : ${o.liveSeoFavicon}`);
finish();
