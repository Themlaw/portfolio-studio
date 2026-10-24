/**
 * Compare deux exports du kit (dossiers de PSD) : ouverture, arborescence des calques et groupes (noms, verrous, cadres), puis
 * l'écart de pixels de chaque calque (moyenne, maximum, part de pixels qui diffèrent de plus de 8 niveaux).
 * Usage : node --max-old-space-size=2048 --import tsx scripts/kit-poc/compare-psd.mts <dossier A> <dossier B>
 * (l'identifiant du kit, écrit dans un calque verrouillé, change d'un export à l'autre quand le thème change : ignoré.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { readPsd, type Layer } from "ag-psd";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { KIT_FILES, KIT_ROLES } from "@/lib/kit/spec";

const [a, b] = process.argv.slice(2);
ensureAgPsd();
const read = (dir: string, role: (typeof KIT_ROLES)[number]) => readPsd(readFileSync(path.join(dir, KIT_FILES[role].file)), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
type Flat = { path: string; layer: Layer; depth: number };
const flat = (list: Layer[] | undefined, prefix = ""): Flat[] =>
  (list ?? []).flatMap((l) => {
    const p = `${prefix}/${(l.name ?? "").replace(/k2-[0-9a-f]{12}/g, "k2-ID")}`;
    return [{ path: p, layer: l, depth: prefix.split("/").length }, ...flat(l.children, p)];
  });
let bad = 0;
/** Cadre d'un calque : écart toléré de 8 px (le bord quasi transparent d'un motif rastérisé autrement). */
const near = (p?: number, q?: number) => Math.abs((p ?? 0) - (q ?? 0)) <= 8;
for (const role of KIT_ROLES) {
  const A = read(a, role);
  const B = read(b, role);
  const fa = flat(A.children);
  const fb = flat(B.children);
  const sameTree = fa.length === fb.length && fa.every((x, i) => x.path === fb[i].path && Boolean(x.layer.children) === Boolean(fb[i].layer.children) && x.layer.hidden === fb[i].layer.hidden && x.layer.protected?.position === fb[i].layer.protected?.position && near(x.layer.left, fb[i].layer.left) && near(x.layer.top, fb[i].layer.top) && near(x.layer.right, fb[i].layer.right) && near(x.layer.bottom, fb[i].layer.bottom));
  console.log(`${KIT_FILES[role].file} : ${A.width}x${A.height} / ${B.width}x${B.height} ; ${fa.length} / ${fb.length} calques et groupes ; arborescence ${sameTree ? "IDENTIQUE" : "DIFFÉRENTE"}`);
  if (!sameTree || A.width !== B.width || A.height !== B.height) bad++;
  fa.forEach((x, i) => {
    const y = fb[i];
    const da = x.layer.imageData;
    const db = y?.layer.imageData;
    if (!da || !db || da.width !== db.width || da.height !== db.height) {
      if (da || db) console.log(`   ${x.path} : tailles différentes (${da?.width}x${da?.height} en ${x.layer.left},${x.layer.top} contre ${db?.width}x${db?.height} en ${y?.layer.left},${y?.layer.top})`);
      return;
    }
    let sum = 0;
    let max = 0;
    let over = 0;
    const n = da.data.length;
    for (let k = 0; k < n; k++) {
      const d = Math.abs(da.data[k] - db.data[k]);
      sum += d;
      if (d > max) max = d;
      if (d > 8) over++;
    }
    if (max > 0) console.log(`   ${x.path} : écart moyen ${(sum / n).toFixed(3)}, max ${max}, ${((100 * over) / n).toFixed(3)} % des valeurs à plus de 8 niveaux`);
  });
}
console.log(bad ? "DIFFÉRENCES de structure" : "Structure identique");
process.exit(bad ? 1 : 0);
