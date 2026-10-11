/**
 * Contrôle d'un SVG importé avec un thème (éléments dessinés du kit).
 *
 * On REFUSE plutôt que de nettoyer : liste blanche d'éléments de dessin,
 * aucun script, gestionnaire d'événement, DOCTYPE/entité, <style>, image
 * embarquée ni référence externe (tout attribut href, préfixé ou non, et url()
 * seulement vers « #id ») ; aucune valeur d'attribut échappée (&#, antislash).
 * Défense en profondeur : ces fichiers sont servis par /media avec une CSP
 * `sandbox` et n'apparaissent qu'en image CSS (aucun script n'y tourne).
 * Module pur : testé par scripts/test-theme-zip.mjs.
 */

const ELEMENTS = new Set(
  [
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "lineargradient",
    "radialgradient", "stop", "clippath", "mask", "pattern", "use", "symbol", "title", "desc", "metadata", "text", "tspan",
    "filter", "feturbulence", "fecolormatrix", "fecomponenttransfer", "fefunca", "fefuncr", "fefuncg", "fefuncb",
    "fegaussianblur", "feblend", "fecomposite", "feoffset", "feflood", "femerge", "femergenode", "fedisplacementmap",
  ],
);

export const SVG_MAX_BYTES = 1024 * 1024;

/** null si le SVG est acceptable, sinon la raison du refus. */
export function svgProblem(data: Uint8Array): string | null {
  if (data.length > SVG_MAX_BYTES) return "SVG trop gros (1 Mo au plus)";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return "SVG illisible (encodage)";
  }
  let body = text.replace(/^﻿/, "").trimStart();
  body = body.replace(/^<\?xml[^?>]*\?>\s*/, "");
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  if (!/^<svg[\s>]/.test(body)) return "ce n'est pas un SVG";
  if (/<!|<\?|\]\]>/.test(body)) return "DOCTYPE, entité ou instruction refusés";
  for (const m of body.matchAll(/<\s*\/?\s*([a-zA-Z][\w:.-]*)/g)) {
    const name = m[1].toLowerCase();
    if (!ELEMENTS.has(name)) return `élément <${m[1]}> refusé`;
  }
  // Attributs, quels que soient le préfixe d'espace de noms, les guillemets
  // ou le séparateur (espace, tabulation, « / ») : gestionnaires refusés, tout
  // attribut *href seulement vers « #id », aucune valeur échappée (références
  // numériques « &# », antislash CSS) ni url() autre que « url(#id) ».
  for (const tag of body.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const inner = tag[0].replace(/^<[^\s/>]+/, "");
    for (const a of inner.matchAll(/([^\s"'=<>/]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g)) {
      const name = (a[1].split(":").pop() ?? "").toLowerCase();
      const value = a[2].replace(/^["']|["']$/g, "");
      if (name.startsWith("on")) return "gestionnaire d'événement refusé";
      if (/&#|\\/.test(value)) return "valeur d'attribut échappée refusée";
      if (name.endsWith("href") && !/^#[\w.-]+$/.test(value)) return "lien externe refusé";
      if (/url\s*\(/i.test(value.replace(/url\(\s*(["']?)#[\w.-]+\1\s*\)/gi, ""))) return "référence externe url() refusée";
    }
  }
  if (/[\s/"']on[a-z]+\s*=/i.test(body)) return "gestionnaire d'événement refusé";
  for (const m of body.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) {
    if (!/^#[\w.-]+$/.test(m[2])) return "référence externe url() refusée";
  }
  if (/url\(/i.test(body.replace(/url\(\s*(["']?)#[\w.-]+\1\s*\)/gi, ""))) return "référence url() refusée";
  if (/javascript:|data:|@import|expression\(/i.test(body)) return "contenu actif refusé";
  // Entités : seulement les cinq prédéfinies et les références numériques.
  for (const m of body.matchAll(/&([^;\s]{0,12});/g)) {
    if (!/^(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6})$/.test(m[1])) return "entité refusée";
  }
  return null;
}
