#!/usr/bin/env node
/**
 * Thème personnalisé « perso-61 » pour les comparaisons de rendu du lot 61 : valeurs PRÉCISES qu'aucun cran de l'éditeur guidé
 * ne reproduit (arrondis 5/9/17 px, espacements et largeur hors des trois niveaux, styles par rôle, carte par défaut).
 * Idempotent. Usage : DATA_DIR=… node --import tsx scripts/seed-perso61.mjs
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "../src/lib/db/index.ts";
import carnet from "../src/themes/presets/carnet-d-atelier/theme.ts";

const id = "perso-61";
const theme = JSON.parse(JSON.stringify(carnet.default ?? carnet));
theme.id = id;
theme.name = "Mon thème perso (61)";
theme.preset = false;
theme.tokens.radius = { sm: "5px", md: "9px", lg: "17px", btn: "999px", strip: "3px" };
theme.tokens.space = { sectionGap: "clamp(3.5rem, 8vw, 7.5rem)", gutter: "clamp(1.1rem, 4.5vw, 3rem)", pageMax: "1300px" };
theme.tokens.type = { h1: { weight: 700, tracking: 0.03 }, eyebrow: { case: "upper", tracking: 0.12 } };
theme.tokens.layout = { ...(theme.tokens.layout ?? {}), card: { color: "secondary12", width: "inset", corners: "m", border: { width: "thin" } } };
theme.variants = { ...theme.variants, button: "pill", texture: "paper-dots" };
const db = getDb();
const row = db.select().from(schema.themes).where(eq(schema.themes.id, id)).get();
if (row) db.update(schema.themes).set({ name: theme.name, data: JSON.stringify(theme) }).where(eq(schema.themes.id, id)).run();
else db.insert(schema.themes).values({ id, name: theme.name, preset: false, data: JSON.stringify(theme) }).run();
console.log(id);
