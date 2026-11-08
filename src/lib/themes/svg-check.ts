/**
 * Contrôle d'un SVG importé avec un thème (éléments dessinés du kit) ou comme cadre.
 *
 * On REFUSE plutôt que de nettoyer : liste blanche d'éléments de dessin,
 * aucun script, gestionnaire d'événement, DOCTYPE/entité, <style>, image
 * embarquée ni référence externe (tout attribut href, préfixé ou non, et url()
 * seulement vers « #id ») ; aucune valeur d'attribut échappée (&#, antislash).
 * Encodage : UTF-8 seulement (déclaration `encoding=` comprise), aucun octet NUL.
 * Défense en profondeur : ces fichiers sont servis par /media avec une CSP
 * `sandbox` et n'apparaissent qu'en image CSS (aucun script n'y tourne).
 *
 * Temps LINÉAIRE en la taille du fichier : un seul passage de gauche à droite,
 * balise par balise (`indexOf`), et seulement des expressions ancrées ou sans
 * retour arrière sur un morceau déjà découpé. Les anciennes recherches non
 * ancrées sur tout le fichier (`<!--[\s\S]*?-->`, attributs, url()) étaient
 * quadratiques : un SVG de quelques Mo bloquait le serveur des minutes.
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

export const SVG_MAX_BYTES = 512 * 1024;

/** Prologue `<?xml … ?>` : borné (un vrai prologue fait quelques dizaines de caractères). */
const PROLOG_MAX = 256;

const SPACE = /\s/;
/** Caractères d'un nom d'attribut (comme l'ancienne règle : tout sauf blancs, guillemets, = < > /). */
const ATTR_NAME = /[^\s"'=<>/]/;
/** Valeur sans guillemets. */
const BARE_VALUE = /[^\s"'=<>`]/;

/**
 * Toute occurrence de « url( » doit être exactement `url(#id)` (guillemets facultatifs, blancs tolérés). Lecture pas à pas depuis
 * chaque « url( » trouvé par `indexOf` : linéaire, le premier écart arrête tout.
 */
function urlProblem(text: string): boolean {
  const low = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = low.indexOf("url", from);
    if (at < 0) return false;
    let i = at + 3;
    while (i < text.length && SPACE.test(text[i])) i++;
    if (text[i] !== "(") {
      from = at + 3;
      continue;
    }
    i++;
    while (i < text.length && SPACE.test(text[i])) i++;
    const quote = text[i] === '"' || text[i] === "'" ? text[i] : "";
    if (quote) i++;
    if (text[i] !== "#") return true;
    i++;
    const start = i;
    while (i < text.length && /[\w.-]/.test(text[i])) i++;
    if (i === start) return true;
    if (quote) {
      if (text[i] !== quote) return true;
      i++;
    }
    while (i < text.length && SPACE.test(text[i])) i++;
    if (text[i] !== ")") return true;
    from = i + 1;
  }
}

/** Entités : seulement les cinq prédéfinies et les références numériques (lecture de chaque « & » trouvé par `indexOf`). */
function entityProblem(text: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf("&", from);
    if (at < 0) return false;
    // Fenêtre bornée (12 caractères au plus avant « ; ») : jamais de recherche jusqu'au bout du texte.
    const win = text.slice(at + 1, at + 14);
    const semi = win.indexOf(";");
    const name = semi >= 0 ? win.slice(0, semi) : null;
    // Comme avant : un « & » sans « ; » proche (ou suivi d'un blanc) n'est pas une entité.
    if (name !== null && !/\s/.test(name) && !/^(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6})$/.test(name)) return true;
    from = at + 1;
  }
}

/** Contenu actif, où qu'il soit (texte ou valeur d'attribut). */
const ACTIVE = /javascript:|data:|@import|expression\(/i;

/** Contrôle d'un morceau de texte entre deux balises (titre, description, texte affiché). */
function textProblem(text: string): string | null {
  if (text.includes("]]>")) return "DOCTYPE, entité ou instruction refusés";
  if (urlProblem(text)) return "référence url() refusée";
  if (ACTIVE.test(text)) return "contenu actif refusé";
  if (entityProblem(text)) return "entité refusée";
  return null;
}

/**
 * Attributs d'une balise ouvrante (`inner` = ce qui suit le nom, sans le « > » final), quels que soient le préfixe d'espace de noms,
 * les guillemets ou le séparateur (espace, tabulation, « / ») : gestionnaires refusés, tout attribut *href seulement vers « #id »,
 * aucune valeur échappée (références numériques « &# », antislash CSS) ni url() autre que « url(#id) ».
 */
function attributesProblem(inner: string): string | null {
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && (SPACE.test(inner[i]) || inner[i] === "/")) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && ATTR_NAME.test(inner[i])) i++;
    if (i === start) return "balise illisible";
    const name = (inner.slice(start, i).split(":").pop() ?? "").toLowerCase();
    if (name.startsWith("on")) return "gestionnaire d'événement refusé";
    while (i < n && SPACE.test(inner[i])) i++;
    let value = "";
    if (inner[i] === "=") {
      i++;
      while (i < n && SPACE.test(inner[i])) i++;
      const q = inner[i];
      if (q === '"' || q === "'") {
        const end = inner.indexOf(q, i + 1);
        if (end < 0) return "balise illisible";
        value = inner.slice(i + 1, end);
        i = end + 1;
      } else {
        const vs = i;
        while (i < n && BARE_VALUE.test(inner[i])) i++;
        if (i === vs) return "balise illisible";
        value = inner.slice(vs, i);
      }
    }
    if (/&#|\\/.test(value)) return "valeur d'attribut échappée refusée";
    if (name.endsWith("href") && !/^#[\w.-]+$/.test(value)) return "lien externe refusé";
    if (urlProblem(value)) return "référence externe url() refusée";
    if (ACTIVE.test(value)) return "contenu actif refusé";
    if (entityProblem(value)) return "entité refusée";
  }
  return null;
}

/** null si le SVG est acceptable, sinon la raison du refus. */
export function svgProblem(data: Uint8Array): string | null {
  if (data.length > SVG_MAX_BYTES) return "SVG trop gros (512 Ko au plus)";
  if (data.includes(0)) return "SVG illisible (octet nul : le fichier doit être en UTF-8)";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return "SVG illisible (encodage)";
  }
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const skipSpace = () => {
    while (i < text.length && SPACE.test(text[i])) i++;
  };
  skipSpace();
  if (text.startsWith("<?xml", i)) {
    const end = text.indexOf("?>", i);
    if (end < 0 || end - i > PROLOG_MAX) return "DOCTYPE, entité ou instruction refusés";
    const prolog = text.slice(i, end);
    const enc = /\sencoding\s*=\s*(["'])([^"']*)\1/i.exec(prolog);
    if (enc && !/^utf-?8$/i.test(enc[2].trim())) return `encodage « ${enc[2].slice(0, 20)} » refusé (UTF-8 seulement)`;
    i = end + 2;
  }
  let seenRoot = false;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = text.slice(i, lt < 0 ? text.length : lt);
    if (!seenRoot) {
      if (chunk.trim()) return "ce n'est pas un SVG";
    } else {
      const bad = textProblem(chunk);
      if (bad) return bad;
    }
    if (lt < 0) break;
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) return "commentaire non fermé";
      i = end + 3;
      continue;
    }
    const next = text[lt + 1];
    if (next === "!" || next === "?") return "DOCTYPE, entité ou instruction refusés";
    const gt = text.indexOf(">", lt + 1);
    if (gt < 0) return "balise non fermée";
    const tag = text.slice(lt + 1, gt);
    const m = /^\s*(\/?)\s*([a-zA-Z][\w:.-]*)/.exec(tag);
    if (!m) return "balise illisible";
    const closing = m[1] === "/";
    const elName = m[2].toLowerCase();
    if (!seenRoot) {
      // Comme avant : `<svg` suivi d'un blanc ou de « > », sans blanc après « < ».
      if (closing || !/^svg(?:\s|$)/i.test(tag)) return "ce n'est pas un SVG";
      seenRoot = true;
    }
    if (!ELEMENTS.has(elName)) return `élément <${m[2]}> refusé`;
    if (!closing) {
      const bad = attributesProblem(tag.slice(m[0].length));
      if (bad) return bad;
    }
    i = gt + 1;
  }
  if (!seenRoot) return "ce n'est pas un SVG";
  return null;
}
