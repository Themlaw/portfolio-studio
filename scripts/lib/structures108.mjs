/**
 * Lot 108 : outils de la suite `structures108`. La fixture `tests/fixtures/structures-reference.json` contient 59 structures UNIQUES venues de la prod (lecture seule), sans texte
 * ni média ni couleur réelle : textes « «t» », médias 0 / « «id» », couleurs « «c» ». Ce module les rend SYNTHÉTIQUES (textes inventés, image inventée, couleurs du thème)
 * et classe chaque structure (bloc de page, composant de planche).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const FIXTURE = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "structures-reference.json"), "utf8"));
export const L = (t) => ({ fr: t, en: t });
const clone = (v) => JSON.parse(JSON.stringify(v));

/** « page » : bloc de premier niveau d'une page ; « enfant » : composant de grille ; « planche » : composant d'une planche de projet. */
export function kindOf(entry) {
  const o = entry.origin;
  if (o.includes("project")) return "planche";
  if (entry.node.type === "video-single") return "enfant";
  return "page";
}

/** Rend une structure synthétique : `{ uid, type, props }` (bloc ou composant). env : { img, slug, pageId, collection, wp: [ids de papiers peints] }. */
export function synth(entry, i, env) {
  const m = `S108b${i}x`;
  let n = 0;
  const wp = (k) => env.wp[(Number(k) - 1 + env.wp.length * 10) % env.wp.length];
  const walk = (v, p) => {
    const key = p.at(-1);
    if (v === "«t»") return L(`${m}${n++}x`);
    if (v === "«c»") return p.at(-2) === "border" ? "primary" : "secondary";
    if (v === "«id»") return p.includes("ids") ? `p108${i}${env.tag ?? ""}` : env.slug; // « ids » : places d'un carrousel (a-z0-9, 12 au plus)
    if (v === "«s»") return key === "uid" ? `s108x${i}${n++}${env.tag ?? ""}` : key === "layout" ? "2" : key === "collection" ? env.collection : "x";
    if (Array.isArray(v)) {
      if (key === "children" && v.every((x) => typeof x === "string")) return v.flatMap(() => [0, 1].map((k) => ({ uid: `s108k${i}${k}${env.tag ?? ""}`, type: "image", props: { mediaId: env.img, width: "wide" } })));
      return v.map((x, k) => walk(x, [...p, String(k)]));
    }
    if (v && typeof v === "object" && v.type === "video-single" && v.props) {
      const look = walk(v.props.look ?? {}, [...p, "props", "look"]);
      return { uid: `s108v${i}${n++}${env.tag ?? ""}`, type: "image", props: { mediaId: env.img, width: "wide", ...(Object.keys(look).length ? { look } : {}) } };
    }
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "text" && x === "«t»") continue; // styles de texte : pas de contenu synthétique
        const w = walk(x, [...p, k]);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    if (typeof v === "number") {
      if (p.at(-2) === "media") return env.img; // carrousel d'une planche : 0 = média anonymisé
      if (key === "wallpaper" || key === "paperWallpaper") return wp(v);
      if (key === "mediaId" || key === "portraitMediaId" || key === "backgroundMediaId") return env.img;
      if (key === "pageId" || key === "reelPageId") return env.pageId;
    }
    return v;
  };
  const node = clone(entry.node);
  const uid = `s108x${i}${env.tag ?? ""}`;
  if (node.props) {
    const props = walk(node.props, ["props"]);
    // Composant de grille « Vidéo » : pas de vidéo synthétique, image à la place.
    if (node.type === "video-single") return { uid, type: "image", props: { mediaId: env.img, width: "wide", ...(props.look ? { look: props.look } : {}) }, replaced: "video-single→image" };
    return { uid, type: node.type, props, ...(node.box ? { box: node.box } : {}) };
  }
  const { type, ...rest } = node;
  return { uid, type, props: walk(rest, ["props"]) };
}
