/**
 * Épaisseur PLEINE du cadre du kit, côté par côté (lot 79).
 *
 * Le cadre est un 9-slice : la découpe (`slice`, 48 px de la case de 300) dit jusqu'où va chaque côté, pas où le dessin s'arrête. Un cadre
 * festonné dont la bande pleine ne fait que 20 px sur un côté et 36 sur un autre laissait, entre le bord intérieur du dessin et la photo, une
 * bande de transparent (la découpe moins l'épaisseur pleine) où l'on voyait le fond du site ; et comme l'écart changeait d'un côté à l'autre,
 * le cadre semblait décalé. On mesure donc, pour chaque côté, où s'arrête le dessin (le bord intérieur) : le cadre est posé contre la photo à
 * cette profondeur, le reste de la découpe (transparent) passe sous la photo.
 *
 * Fonction pure (testée sans serveur) ; la lecture du fichier et la pose sur le thème sont dans frame-ring.ts.
 */
/** Le bord intérieur d'un dessin réduit est adouci : il est où l'opacité passe la moitié (le reste passe sous la photo). */
const ALPHA_EDGE = 128;

type Rgba = { width: number; height: number; data: Uint8Array | Buffer };
export type Slice = readonly [number, number, number, number];

/**
 * Pour chaque côté (haut, droite, bas, gauche) : la profondeur (px de l'image, du bord extérieur vers l'intérieur) où s'arrête le dessin,
 * médiane sur la longueur du côté hors coins ; au plus la découpe. Un côté sans dessin garde sa découpe (rien à corriger).
 */
export function measureRing(img: Rgba, slice: Slice): [number, number, number, number] {
  const { width: W, height: H, data } = img;
  const [st, sr, sb, sl] = slice;
  const alpha = (x: number, y: number) => data[(y * W + x) * 4 + 3];
  const median = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  /** Profondeur du dessin le long d'une ligne (0 = bord extérieur) : 1 + la dernière position opaque dans les `limit` premiers pixels. */
  const depthAlong = (limit: number, opaqueAt: (d: number) => boolean) => {
    let last = -1;
    for (let d = 0; d < limit; d++) if (opaqueAt(d)) last = d;
    return last + 1;
  };
  const side = (limit: number, from: number, to: number, opaqueAt: (along: number, d: number) => boolean) => {
    const depths: number[] = [];
    for (let a = from; a < to; a++) depths.push(depthAlong(limit, (d) => opaqueAt(a, d)));
    if (depths.length === 0) return limit;
    const drawn = depths.filter((d) => d > 0);
    if (drawn.length < depths.length / 2) return limit; // côté (presque) vide : ne rien changer
    return Math.min(limit, Math.max(1, median(drawn)));
  };
  return [
    side(st, sl, W - sr, (x, d) => alpha(x, d) > ALPHA_EDGE),
    side(sr, st, H - sb, (y, d) => alpha(W - 1 - d, y) > ALPHA_EDGE),
    side(sb, sl, W - sr, (x, d) => alpha(x, H - 1 - d) > ALPHA_EDGE),
    side(sl, st, H - sb, (y, d) => alpha(d, y) > ALPHA_EDGE),
  ];
}
