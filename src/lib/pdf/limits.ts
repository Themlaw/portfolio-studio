/**
 * Limites et règles pures des PDF envoyés (bloc « CV »). Module sans import :
 * testé directement par Node (scripts/test-pdf.mjs).
 */
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name] || fallback);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const pdfLimits = () => ({
  /** Taille maximale du fichier (Mo). */
  maxBytes: num("MAX_PDF_MB", 15) * 1024 * 1024,
  /** Nombre de pages maximal (un CV, pas un livre). */
  maxPages: num("MAX_PDF_PAGES", 10),
  /** Plus grand côté des pages rendues (px) : borne la mémoire quelle que soit la taille déclarée de la page. */
  renderPx: num("PDF_RENDER_PX", 1600),
  /** Délai dur de pdfinfo (lecture de la structure). */
  infoMs: num("PDF_INFO_MAX_DURATION_S", 15) * 1000,
  /** Délai dur du rendu de toutes les pages. */
  renderMs: num("PDF_RENDER_MAX_DURATION_S", 90) * 1000,
  /** Plafond de mémoire résidente du rendu (pdftoppm, Mo) : processus tué au-delà. */
  maxRssMb: num("PDF_MAX_RSS_MB", 400),
  /** Plafond de pdfinfo (structure seulement, aucun rendu : quelques Mo suffisent). */
  infoRssMb: num("PDF_INFO_MAX_RSS_MB", 64),
});

/** Boîtes des variantes d'une page (côté le plus long, px) : lecture dans le bloc, puis visionneuse. */
export const PDF_PAGE_BOXES = [800, 1600] as const;

export const PDF_PREFIX = "doc/";
/** Clé du PDF servi en téléchargement (copie de l'original, jamais sous originals/). */
export const pdfKey = (hash16: string) => `${PDF_PREFIX}${hash16}/document.pdf`;
/** Clé d'une image de page : doc/<hash16>/p<page>-<boîte>.<format>. */
export const pageKey = (hash16: string, page: number, box: number, format: "avif" | "webp") => `${PDF_PREFIX}${hash16}/p${page}-${box}.${format}`;
/** Clé publique d'un PDF (document ou page) → hash16, sinon null. */
export function hashOfDocKey(key: string): string | null {
  const m = /^doc\/([0-9a-f]{16})\/(?:document\.pdf|p\d{1,2}-\d{3,4}\.(?:avif|webp))$/.exec(key);
  return m ? m[1] : null;
}

/** Signature d'un PDF : « %PDF-1.x » / « %PDF-2.0 » au tout début du fichier (aucun octet devant). */
export function isPdfHead(head: Uint8Array): boolean {
  if (head.length < 8) return false;
  const s = String.fromCharCode(...head.subarray(0, 8));
  return /^%PDF-[12]\.\d/.test(s);
}

/**
 * Nom du fichier téléchargé : tiré d'un texte libre (réglage du bloc), réduit
 * à [a-z0-9-] (accents retirés), 60 caractères au plus, « cv » par défaut.
 * Jamais le nom du fichier envoyé.
 */
export function downloadName(value: string | null | undefined): string {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "cv";
}

/** En-tête Content-Disposition du téléchargement (nom déjà réduit à [a-z0-9-]). */
export const attachmentHeader = (name: string) => `attachment; filename="${downloadName(name)}.pdf"`;

/** Informations utiles de `pdfinfo` (texte) : pages, chiffrement, taille de la 1re page (pt). */
export function parsePdfInfo(text: string): { pages: number; encrypted: boolean; width: number; height: number } | null {
  const pages = /^Pages:\s+(\d+)\s*$/m.exec(text);
  if (!pages) return null;
  const size = /^Page(?:\s+1)? size:\s+([\d.]+) x ([\d.]+) pts/m.exec(text);
  const rot = /^Page(?:\s+1)? rot:\s+(\d+)/m.exec(text);
  let width = size ? Number(size[1]) : 595;
  let height = size ? Number(size[2]) : 842;
  if (rot && Number(rot[1]) % 180 === 90) [width, height] = [height, width];
  return { pages: Number(pages[1]), encrypted: /^Encrypted:\s+yes/m.test(text), width, height };
}

/** Dimensions rendues d'une page de `w` × `h` points, plus grand côté = `px`. */
export function renderedSize(w: number, h: number, px: number): { width: number; height: number } {
  const long = Math.max(w, h, 1);
  return { width: Math.max(1, Math.round((w / long) * px)), height: Math.max(1, Math.round((h / long) * px)) };
}

/** Arguments de pdfinfo (fichier local) : nombre de pages, chiffrement, taille de la 1re page. */
export const pdfInfoArgs = (file: string) => [file];

/**
 * Arguments de pdftoppm : PNG, pages 1 à `pages`, plus grand côté `px`
 * (-scale-to : la taille déclarée de la page ne compte pas), sans message.
 */
export const pdfToPpmArgs = (file: string, outPrefix: string, pages: number, px: number) => [
  "-q",
  "-png",
  "-f",
  "1",
  "-l",
  String(pages),
  "-scale-to",
  String(px),
  file,
  outPrefix,
];
