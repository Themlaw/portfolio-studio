/**
 * Script de DEV (phase 6c, en attendant l'écran d'import) : range les fichiers
 * produits par run-import (rapport.json) sous /media/kit/<hash>.<ext> et crée
 * (ou remplace) un thème de test qui les utilise.
 * Usage : DATA_DIR=./data node --import tsx scripts/kit-poc/apply-kit.mts <sortie de run-import> [id du thème] [thème source]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { KitReport, SlotReport } from "@/lib/kit/import";
import { getStorage } from "@/lib/storage";
import { PRESETS } from "@/themes/presets";
import { PAPER_OVER_HERO_DEFAULT, ThemeSchema, type KitAssets, type KitImage, type KitPlan, type Theme } from "@/themes/schema";

const [outDir, themeId = "kit-a", sourceId = "galerie-lumineuse"] = process.argv.slice(2);
const report = JSON.parse(readFileSync(path.join(outDir, "rapport.json"), "utf8")) as KitReport;
const storage = getStorage();

/** Fichier rangé par son contenu : /media/kit/<sha256 16>.<ext>. */
async function put(file: string): Promise<string> {
  const data = readFileSync(path.join(outDir, file));
  const ext = path.extname(file).slice(1);
  const key = `kit/${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
  await storage.put(key, Readable.from(data));
  return `/media/${key}`;
}

async function image(slot: SlotReport | undefined): Promise<KitImage | undefined> {
  if (!slot?.files?.length || !slot.box) return undefined;
  const base = slot.id.replace(/\//g, "--");
  const whole = slot.id === "papier" || slot.id === "cadre";
  const w = whole ? (slot.id === "papier" ? 512 : 300) : slot.box.w;
  const h = whole ? (slot.id === "papier" ? 512 : 300) : slot.box.h;
  const out: KitImage = { w, h, ...(slot.thumbhash ? { thumbhash: slot.thumbhash } : {}) };
  if (slot.chosen === "svg") out.svg = await put(`${base}.svg`);
  else if (slot.chosen === "svg-mask") out.svg = await put(`${base}.mask.svg`);
  else {
    out.avif = await put(`${base}.avif`);
    out.webp = await put(`${base}.webp`);
  }
  return out;
}

const bySlot = (id: string) => report.slots.find((s) => s.id === id && s.status !== "error");
const plans: (KitPlan | null)[] = [];
for (let n = 1; n <= 5; n++) {
  const slot = bySlot(`hero/plan-${n}`);
  const img = await image(slot);
  plans.push(img && slot?.box ? { ...img, x: slot.box.x, y: slot.box.y } : null);
}
const paper = await image(bySlot("papier"));
const frame = await image(bySlot("cadre"));
const kit: KitAssets = {
  plans,
  signature: await image(bySlot("signature")),
  ...(paper ? { paper: { image: paper, overHero: PAPER_OVER_HERO_DEFAULT } } : {}),
  ...(frame ? { frame: { image: frame, slice: [48, 48, 48, 48] as [number, number, number, number] } } : {}),
  stroke: await image(bySlot("trait")),
  icons: {
    arrowLeft: await image(bySlot("icones/fleche-gauche")),
    arrowRight: await image(bySlot("icones/fleche-droite")),
    close: await image(bySlot("icones/fermer")),
    play: await image(bySlot("icones/lecture")),
  },
  tape: await image(bySlot("accessoires/scotch")),
};

const source = PRESETS[sourceId];
if (!source) throw new Error(`thème source inconnu : ${sourceId}`);
const theme: Theme = ThemeSchema.parse({
  ...source,
  id: themeId,
  name: `Kit ${themeId} (test)`,
  preset: false,
  // Scotch visible : variante « taped » de la planche.
  variants: { ...source.variants, strip: "taped" },
  assets: { ...source.assets, kit },
});
const db = getDb();
const row = { id: themeId, name: theme.name, preset: false, data: JSON.stringify(theme), updatedAt: new Date() };
if (db.select().from(schema.themes).where(eq(schema.themes.id, themeId)).get()) db.update(schema.themes).set(row).where(eq(schema.themes.id, themeId)).run();
else db.insert(schema.themes).values(row).run();
console.log(JSON.stringify({ theme: themeId, kit }, null, 1));
