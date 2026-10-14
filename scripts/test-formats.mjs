#!/usr/bin/env node
/**
 * Formats d'image (lot 25) : une seule liste pour tous les réglages, anciennes valeurs encore valides,
 * ratio détecté d'un cadrage libre. Usage : node --import tsx scripts/test-formats.mjs   (inclus dans npm test)
 */
import { detectFormat, FORMAT_KEYS, FORMAT_LABELS, formatOptions, LEGACY_FORMAT_KEYS, RATIO_VALUES } from "../src/lib/images/formats.ts";
import { imageSchema } from "../src/blocks/ImageBlock.tsx";
import { gridSchema } from "../src/blocks/GridBlock.tsx";
import { profileSchema } from "../src/blocks/ProfileBlock.tsx";
import { collectionTilesSchema } from "../src/blocks/CollectionTilesBlock.tsx";

let failures = 0;
const ok = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const expected = ["Libre", "Carré 1:1", "Portrait 3:4", "Portrait 2:3", "Paysage 4:3", "Paysage 3:2", "Panoramique 2:1", "Panoramique 21:9"];
ok("la liste : Libre, Carré 1:1, Portrait 3:4, Portrait 2:3, Paysage 4:3, Paysage 3:2, Panoramique 2:1, Panoramique 21:9", formatOptions().map((o) => o.label).join("|") === expected.join("|"));
ok("clés de la liste", FORMAT_KEYS.join(",") === "auto,1:1,3:4,2:3,4:3,3:2,2:1,21:9");
ok("anciens formats : 16:9 et 4:5 gardés mais non proposés", LEGACY_FORMAT_KEYS.join(",") === "16:9,4:5" && !formatOptions().some((o) => o.value === "16:9" || o.value === "4:5"));
ok("un ancien format en place reste affiché dans la liste", formatOptions("16:9").at(-1)?.value === "16:9" && formatOptions("4:5").at(-1)?.label === FORMAT_LABELS["4:5"]);
ok("chaque clé a un libellé", RATIO_VALUES.every((k) => FORMAT_LABELS[k]));

// Le champ de format seul (les autres champs obligatoires d'un bloc ne comptent pas ici).
const parse = (schema, ratioKey, v) => schema.shape[ratioKey].safeParse(v).success;
for (const [name, schema, key] of [["image", imageSchema, "ratio"], ["grille", gridSchema, "ratio"], ["portrait", profileSchema, "portraitRatio"], ["entrées des collections", collectionTilesSchema, "ratio"]]) {
  ok(`${name} : tous les formats de la liste et les anciens sont valides`, RATIO_VALUES.every((k) => parse(schema, key, k)));
  ok(`${name} : un format inconnu est refusé`, !parse(schema, key, "5:4") && !parse(schema, key, "libre"));
}

ok("detectFormat : 1500×1000 → 3:2", detectFormat(1.5) === "3:2");
ok("detectFormat : 4:3 à 1 % près → 4:3", detectFormat((4 / 3) * 1.01) === "4:3");
ok("detectFormat : 21:9 / 2:1 / 2:3 / 3:4 / 1:1", detectFormat(21 / 9) === "21:9" && detectFormat(2) === "2:1" && detectFormat(2 / 3) === "2:3" && detectFormat(0.75) === "3:4" && detectFormat(1) === "1:1");
ok("detectFormat : un rapport entre deux formats reste « libre » (null)", detectFormat(1.42) === null && detectFormat(0) === null && detectFormat(Number.NaN) === null);

console.log(failures ? `test-formats : ${failures} échec(s)` : "test-formats : OK");
process.exit(failures ? 1 : 0);
