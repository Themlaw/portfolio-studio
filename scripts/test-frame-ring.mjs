/**
 * Lot 79 : épaisseur PLEINE du cadre du kit mesurée sur son fichier (src/lib/kit/frame-measure.ts) et variables CSS qui en découlent.
 * Cadre synthétique réaliste (festons, épaisseurs différentes, transparent), jamais le kit réel.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { kitVariables } from "../src/themes/css.ts";
import { measureRing } from "../src/lib/kit/frame-measure.ts";

const W = 300;
/** Cadre de 300 px : bande pleine de profondeur D (haut, droite, bas, gauche), festons (demi-disques) sur le bord extérieur, transparent ailleurs. */
function frame(D, scallop = 7) {
  const data = Buffer.alloc(W * W * 4);
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const o = (y * W + x) * 4;
    data[o] = 232; data[o + 1] = 120; data[o + 2] = 154; data[o + 3] = 255;
  };
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      if ((y >= scallop && y < D[0]) || (x >= W - D[1] && x < W - scallop) || (y >= W - D[2] && y < W - scallop) || (x >= scallop && x < D[3])) put(x, y);
    }
  for (let t = 24; t <= 276; t += 18)
    for (let dy = -scallop; dy <= scallop; dy++)
      for (let dx = -scallop; dx <= scallop; dx++)
        if (dx * dx + dy * dy <= scallop * scallop) {
          put(t + dx, scallop + dy);
          put(t + dx, W - 1 - scallop + dy);
          put(scallop + dy, t + dx);
          put(W - 1 - scallop + dy, t + dx);
        }
  return { width: W, height: W, data };
}
const SLICE = [48, 48, 48, 48];

test("T1 la mesure donne l'épaisseur pleine de chaque côté (festons ignorés, médiane)", () => {
  assert.deepEqual(measureRing(frame([36, 28, 40, 20]), SLICE), [36, 28, 40, 20]);
});

test("T2 un dessin plus épais que la découpe est coupé à la découpe", () => {
  assert.deepEqual(measureRing(frame([36, 28, 90, 20]), SLICE), [36, 28, 48, 20]);
});

test("T3 un côté sans dessin garde la découpe entière", () => {
  const f = frame([36, 28, 40, 20]);
  for (let y = 0; y < W; y++) for (let x = 0; x < 60; x++) f.data[(y * W + x) * 4 + 3] = 0; // plus rien à gauche
  const [t, r, b, l] = measureRing(f, SLICE);
  assert.equal(l, 48);
  assert.deepEqual([t, r, b], [36, 28, 40]);
});

test("T4 variables CSS : bordure = épaisseur pleine, dessin étalé sur la découpe ; sans mesure, comme avant", () => {
  const image = { avif: "/a.avif", webp: "/a.webp", w: 300, h: 300 };
  const v = kitVariables({ frame: { image, slice: [48, 48, 48, 48], ring: [36, 28, 48, 20] } });
  assert.deepEqual([v["--t-kit-fwt"], v["--t-kit-fwr"], v["--t-kit-fwb"], v["--t-kit-fwl"]], ["18", "14", "24", "10"]);
  assert.deepEqual([v["--t-kit-fst"], v["--t-kit-fsr"], v["--t-kit-fsb"], v["--t-kit-fsl"]], ["24", "24", "24", "24"]);
  assert.equal(v["--t-kit-fmax"], "24");
  const old = kitVariables({ frame: { image, slice: [48, 48, 48, 48] } });
  assert.deepEqual([old["--t-kit-fwt"], old["--t-kit-fwr"], old["--t-kit-fwb"], old["--t-kit-fwl"]], ["24", "24", "24", "24"]);
  // Une mesure plus grande que la découpe est ramenée à la découpe.
  const big = kitVariables({ frame: { image, slice: [48, 48, 48, 48], ring: [99, 48, 48, 48] } });
  assert.equal(big["--t-kit-fwt"], "24");
});
