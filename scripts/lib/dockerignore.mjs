/**
 * Émulation du `.dockerignore` (motifs Docker : ordre, négation « ! », « * », « ? », « ** »), sans dépendance : partagée par
 * scripts/check-docker-context.mjs (npm test) et scripts/secuC-chaine.mjs (batterie de sécurité). Le dernier motif qui touche le
 * chemin (ou un de ses dossiers parents) décide.
 */

/** Règles d'un fichier .dockerignore → { neg, re, pat }. */
export function parseDockerignore(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const neg = l.startsWith("!");
      const pat = (neg ? l.slice(1) : l).replace(/^\/+/, "").replace(/\/+$/, "");
      // « ** » : zéro ou plusieurs dossiers (« **/*.key » vise aussi la racine, comme Docker).
      const segs = pat.split("/");
      const re = segs
        .map((seg, i) => {
          const last = i === segs.length - 1;
          if (seg === "**") return last ? ".*" : "(?:.*/)?";
          return seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + (last ? "" : "/");
        })
        .join("");
      return { neg, re: new RegExp(`^${re}$`), pat: l };
    });
}

/** Motif qui exclut le fichier (chemin relatif à la racine du contexte), ou null s'il entre dans le contexte. */
export function excludedBy(rules, file) {
  const parts = file.split("/");
  let out = false;
  let by = "";
  for (const r of rules) {
    for (let i = 1; i <= parts.length; i++) {
      if (r.re.test(parts.slice(0, i).join("/"))) {
        out = !r.neg;
        by = r.pat;
        break;
      }
    }
  }
  return out ? by : null;
}
