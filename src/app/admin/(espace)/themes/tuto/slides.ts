/**
 * Tutoriel du kit Photoshop (bouton « Tuto du kit » de la page Thèmes et de
 * l'écran du kit) : le contenu, à retoucher ici, pas dans le JSX.
 *
 * - `image` : nom d'un visuel de public/admin/tuto (AVIF + WebP), généré par
 *   `scripts/tuto-shots.mjs` à partir du vrai produit ; sa taille et ses
 *   boîtes nommées sont dans shots.json (généré aussi).
 * - `notes` : annotations dessinées PAR-DESSUS l'image (cadre rose autour
 *   d'une boîte de shots.json, étiquette courte) ; `arrows` : flèches entre
 *   deux boîtes.
 * - Les textes (titre, description de l'image, puces, étiquettes) sont dans le catalogue d'admin, espace `themeTuto` (lot 130b) : clés
 *   `<id>.title`, `<id>.alt`, `<id>.b1…bN` (N = `bullets`), `<id>.note_<boîte>` ; ce module ne garde que la structure.
 * - 3 à 5 puces par slide, au tutoiement, du point de vue de l'artiste.
 * - `action` : « download » (Télécharger le kit) ou « send » (Renvoyer le
 *   kit, quand le tuto est ouvert depuis l'écran d'un thème).
 */
/**
 * Annotation : cadre rose autour de la boîte `box` de shots.json, étiquette
 * HORS du cadre (`place`) ou en un point libre de l'image (`at`, fractions de
 * la largeur et de la hauteur) relié au cadre par un trait de rappel. Jamais
 * d'étiquette sur le contenu désigné.
 */
export type TutoNote = { box: string; place?: "top" | "bottom" | "left" | "right"; at?: [number, number] };
export type TutoSlide = {
  id: string;
  image: string;
  /** Nombre de puces (textes `<id>.b1…bN`). */
  bullets: number;
  notes?: TutoNote[];
  arrows?: [string, string][];
  action?: "download" | "send";
};


export const TUTO_SLIDES: TutoSlide[] = [
  { id: "principe", image: "principe", bullets: 3, notes: [{ box: "etape1", place: "top" }, { box: "etape2", place: "top" }, { box: "etape3", place: "top" }], arrows: [["etape1", "etape2"], ["etape2", "etape3"]] },
  { id: "telecharger", image: "themes", bullets: 3, notes: [{ box: "telecharger", at: [0.13, 0.82] }], action: "download" },
  { id: "ouvrir", image: "kit-ensemble", bullets: 3, notes: [{ box: "entete-decor", place: "bottom" }, { box: "decor", place: "bottom" }, { box: "logo", place: "bottom" }, { box: "icones", place: "bottom" }] },
  { id: "carte", image: "carte-logo", bullets: 4, notes: [{ box: "titre", place: "right" }, { box: "zone", place: "bottom" }, { box: "legende", place: "right" }, { box: "vignette", place: "left" }, { box: "consignes", place: "bottom" }] },
  { id: "paysage", image: "el-paysage", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "signature", image: "el-signature", bullets: 5, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "papier", image: "el-papier", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "trait", image: "el-trait", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "icones", image: "el-icones", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "curseur", image: "el-curseur", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "cadre", image: "el-cadre", bullets: 6, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "scotch", image: "el-scotch", bullets: 4, notes: [{ box: "carte", place: "top" }, { box: "avant", place: "top" }, { box: "apres", place: "top" }] },
  { id: "regles", image: "lisezmoi", bullets: 5 },
  { id: "renvoyer", image: "renvoyer", bullets: 4, notes: [{ box: "renvoyer", place: "right" }], action: "send" },
  { id: "revue", image: "revue", bullets: 4, notes: [{ box: "resume", place: "right" }, { box: "inchange", place: "right" }, { box: "redessinee", place: "right" }] },
  { id: "appliquer", image: "appliquer", bullets: 4, notes: [{ box: "miroir", place: "bottom" }, { box: "appliquer", place: "right" }] },
];
