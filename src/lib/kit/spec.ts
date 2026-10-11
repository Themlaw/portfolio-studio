import { isNuance, PALETTE_GROUPS, type PaletteKey } from "@/themes/palette";

/**
 * Kit de thème PSD — spécification des emplacements (docs/THEME-KIT.md).
 *
 * Kit v2 (phase 6d, retour de l'artiste) : un groupe de premier niveau par
 * élément du site, chacun dans sa zone de toile dédiée (plan de travail
 * simulé : carte, titre, vignette du site, consignes), noms en français clair :
 *
 *   LISEZ-MOI                        calque seul, tout en haut
 *   _guides                          verrouillé : repères, identifiant du kit
 *   1 · Paysage d'accueil            Plan 1 — le plus lointain (ciel) … Plan 5 — premier plan
 *   2 · Signature   3 · Papier   4 · Cadre des entrées de collection   5 · Trait
 *   6 · Icônes      7 · Scotch
 *
 * Chaque groupe d'élément contient, tout en bas, un calque verrouillé
 * « Aperçu — ne pas modifier » (carte, vignette, consignes) ignoré à l'import.
 *
 * Groupes plutôt que plans de travail Photoshop : ag-psd écrit les plans de
 * travail, mais leur relecture après réenregistrement par Photoshop n'est pas
 * vérifiable ici, et Photoshop agrandit et décale la toile d'un document à
 * plans de travail ; l'aller-retour des groupes, lui, est prouvé sur le
 * fichier réel de l'artiste (pixels identiques au bit près). L'import tolère
 * quand même un plan de travail (cadres relatifs à son rectangle).
 *
 * Kit v1 (phase 6b, 2880 × 2560 : paysage en haut, planche dessous) : toujours
 * importé (anciens noms `hero/plan-1`, `icones/fleche-droite`…).
 */

/** 3 : groupes « 8 · Palette » et « 9 · Curseur » (lot 4), document plus haut. */
export const KIT_VERSION = 3;
export const DOC_V1 = { width: 2880, height: 2560 } as const;
/** Kit v2 d'avant la palette et les curseurs (mêmes cases, toujours importé). */
export const DOC_V2 = { width: 4000, height: 4000 } as const;
export const DOC = { width: 4000, height: 4880 } as const;
export const HERO = { width: 2880, height: 1600 } as const;
/** Zone du titre du hero, relative au plan (le décor y reste calme). */
export const TITLE_ZONE = { x: 240, y: 420, w: 1260, h: 560 } as const;

export type SlotKind = "plan" | "signature" | "tile" | "nine" | "stroke" | "icon" | "tape" | "swatch" | "cursor";
export type Frame = { x: number; y: number; w: number; h: number };
export type Layout = "v1" | "v2";

export interface SlotSpec {
  /** Identifiant stable (rapports, assets) : « hero/plan-1 », « icones/fermer »… */
  id: string;
  /** Élément (groupe) qui le contient. */
  element: ElementId;
  /** Nom du calque dans le kit v2 (affiché tel quel dans Photoshop). */
  layer: string;
  /** Libellé court pour l'admin : « Flèche droite », « Plan 3 ». */
  label: string;
  /** Noms reconnus (forme `looseName`), anciens noms v1 compris. */
  aliases: string[];
  kind: SlotKind;
  /** Taille de la zone à peindre (px). */
  size: { w: number; h: number };
  /** Cadre v1 (coordonnées du document 2880 × 2560). */
  v1: { x: number; y: number };
  /** Transparence exigée (le reste du hero ou de la page doit se voir à travers). */
  transparent: boolean;
  /** Forme d'une seule couleur : servie en masque SVG (teinte par le thème). */
  mono: boolean;
  /** Toujours en bitmap (texture, dégradé). */
  bitmapOnly?: boolean;
  /** Plans : hauteur utile depuis le bas de la toile (le décor au-dessus est rogné). */
  usefulHeight?: number;
  /** Cadre 9-slice : marges de découpe (px). */
  slice?: { top: number; right: number; bottom: number; left: number };
  /** Rognage à la forme (plans, signature, trait, scotch) ; sinon la boîte entière (tuile, cadre, icônes). */
  crop: boolean;
  /** Position de la case dans sa carte (sinon : coin de la carte, ou rang des icônes). */
  zone?: { x: number; y: number };
  /** Pastille de la palette : couleur du thème qu'elle porte. */
  paletteKey?: PaletteKey;
  /** Curseur : normal ou « clic ». */
  cursor?: "default" | "pointer";
}

export type ElementId = "paysage" | "signature" | "papier" | "cadre" | "trait" | "icones" | "scotch" | "palette" | "curseur";

export interface ElementSpec {
  id: ElementId;
  /** Nom du groupe v2 : « 1 · Paysage d'accueil ». */
  group: string;
  /** Titre affiché au-dessus de la carte. */
  title: string;
  /** Noms de groupe reconnus (forme `looseName`), v1 compris. */
  aliases: string[];
  /** Rectangle de la carte dans le document v2. */
  board: Frame;
  /** Une phrase : où l'élément apparaît sur le site. */
  where: string;
  /** Consignes (≥ 36 px à 100 %) : dimensions et transparence, ce qui est ignoré, astuce. */
  rules: string[];
}

/** Marge intérieure des cartes, écart zone ↔ panneau, largeur du panneau. */
export const BOARD = { pad: 30, gap: 40, panel: 1000, heroPanel: 1020 } as const;
/** Écart horizontal entre deux icônes (place du libellé). */
export const ICON_STEP = 280;

const IGNORED_RULE = "Ignoré : effets, textes non pixellisés, ce qui dépasse.";
const KEEP_RULE = "Pas envie ? Laisse tel quel : c'est gardé.";

export const ELEMENTS: ElementSpec[] = [
  {
    id: "paysage",
    group: "1 · Paysage d'accueil",
    title: "1 · Paysage d'accueil — 5 plans de 2880 × 1600 px",
    aliases: ["paysage-d-accueil", "paysage", "hero"],
    board: { x: 0, y: 410, w: 4000, h: 1660 },
    where: "Ce que tu peins ici devient le paysage en haut de la page d'accueil, derrière ton nom ; les plans glissent un peu les uns devant les autres quand on bouge la souris.",
    rules: [
      "Chaque plan fait 2880 × 1600 px. Plan 1 (le ciel) : opaque. Plans 2 à 5 : transparents au-dessus du décor.",
      "Hauteur utile depuis le bas (lignes bleues) : plan 2 900 px, plan 3 760, plan 4 560, plan 5 380.",
      "Garde la zone du titre (cadre rose) calme : le nom s'y affiche.",
      "Le grain se peint dans « 3 · Papier », pas dans les plans : il serait trop lourd.",
      "Ignoré : effets de calque, textes et objets dynamiques non pixellisés, ce qui dépasse de la toile.",
      "Pas envie de redessiner un plan ? Laisse-le tel quel : il est reconnu et gardé.",
    ],
  },
  {
    id: "signature",
    group: "2 · Signature",
    title: "2 · Signature — 1200 × 300 px",
    aliases: ["signature"],
    board: { x: 0, y: 2140, w: 2300, h: 572 },
    where: "Ce que tu dessines ici remplace ton nom écrit en haut à gauche de toutes les pages.",
    rules: ["1200 × 300 px, fond transparent, une seule couleur : le site la teinte.", IGNORED_RULE, "Pas envie ? Laisse-la telle quelle : ton nom reste écrit."],
  },
  {
    id: "papier",
    group: "3 · Papier",
    title: "3 · Papier — tuile 512 × 512 px",
    aliases: ["papier", "papier-tuile", "tuile"],
    board: { x: 2360, y: 2140, w: 1612, h: 572 },
    where: "Ce que tu peins ici devient le fond de toutes les pages, répété comme un papier peint, et un voile léger sur le paysage.",
    rules: ["512 × 512 px, opaque, sans raccord visible (Filtre > Autres > Translation).", "Un grain fin et sans forme : un motif dessinerait une grille.", IGNORED_RULE, KEEP_RULE],
  },
  {
    id: "trait",
    group: "5 · Trait",
    title: "5 · Trait — 1200 × 80 px",
    aliases: ["trait"],
    board: { x: 1460, y: 2782, w: 2300, h: 560 },
    where: "Ce que tu dessines ici souligne le menu, sépare les sections et sert de barre de défilement sous les planches.",
    rules: ["1200 × 80 px, fond transparent, une seule couleur.", "Étiré en largeur et en hauteur : garde une épaisseur régulière.", IGNORED_RULE, KEEP_RULE],
  },
  {
    id: "cadre",
    // Lot médias : le cadre habille les entrées de collection (plus la
    // visionneuse). Les kits v2/v3 déjà exportés gardent l'ancien nom de
    // groupe : même emplacement, reconnu par son alias.
    group: "4 · Cadre des entrées de collection",
    title: "4 · Cadre des entrées de collection — 300 × 300 px",
    aliases: ["cadre-des-entrees-de-collection", "cadre-des-images-agrandies", "cadre"],
    board: { x: 0, y: 2782, w: 1400, h: 560 },
    where: "Ce que tu dessines ici entoure la grande image de chaque collection (Personnages, Décors…) sur l'accueil.",
    rules: ["300 × 300 px, centre transparent.", "Les 48 px du bord (lignes vertes) s'étirent ; les coins restent fixes.", IGNORED_RULE, KEEP_RULE],
  },
  {
    id: "icones",
    group: "6 · Icônes",
    title: "6 · Icônes — 4 cases de 128 × 128 px",
    aliases: ["icones", "icone"],
    board: { x: 0, y: 3412, w: 2068, h: 560 },
    where: "Ce que tu dessines ici devient les flèches sur les bords des planches, la croix de l'image agrandie et le bouton lecture.",
    rules: ["128 × 128 px chacune, fond transparent, une seule couleur : le site la teinte.", IGNORED_RULE, "Pas envie ? Laisse telles quelles celles que tu ne veux pas dessiner."],
  },
  {
    id: "scotch",
    group: "7 · Scotch",
    title: "7 · Scotch — 400 × 160 px",
    aliases: ["scotch", "accessoires"],
    board: { x: 2128, y: 3412, w: 1500, h: 560 },
    where: "Ce que tu dessines ici tient les images des planches : le même morceau est posé en haut de chaque image.",
    rules: ["400 × 160 px, fond transparent ; la transparence partielle est gardée.", IGNORED_RULE, "Pas envie ? Laisse-le tel quel : le scotch actuel reste."],
  },
  /* ---- Palette et curseurs (lot 4) ---- */
  {
    id: "palette",
    group: "8 · Palette",
    title: "8 · Palette — une pastille par couleur",
    aliases: ["palette", "couleurs"],
    board: { x: 0, y: 4042, w: 2680, h: 810 },
    where: "Les couleurs du site : une colonne par couleur de base, avec ses nuances dessous (survol, texte secondaire…).",
    rules: [
      "Repeins une pastille pour changer cette couleur ; laisse-la telle quelle pour la garder (une nuance « auto » suit alors sa couleur de base).",
      "Pour la repeindre : choisis ta couleur, puis Alt+Maj+Retour arrière (remplit en gardant la forme).",
      "Une seule couleur par pastille : la plus présente compte.",
      "Le contraste des textes est vérifié au retour.",
    ],
  },
  {
    id: "curseur",
    group: "9 · Curseur",
    title: "9 · Curseur — 2 cases de 64 × 64 px",
    aliases: ["curseur", "curseurs", "souris"],
    board: { x: 2740, y: 4042, w: 1232, h: 810 },
    where: "La souris sur ton site : « Normal » partout, « Clic » sur ce qui se clique (liens, boutons, images).",
    rules: [
      "Dessine en 64 × 64 px (zoome au pixel près) : affiché en 32 × 32 à l'écran.",
      "Le rond rose « point chaud » marque le point qui clique : déplace-le avec ton dessin.",
      "Un contour clair et un foncé : visible sur tous les fonds.",
      "Les champs de texte gardent leur barre de saisie.",
      "Pas envie ? Laisse tel quel : le curseur actuel reste.",
    ],
  },
];

/** Pastilles : taille, pas des colonnes et des rangées dans la carte « 8 · Palette ». */
export const SWATCH = { size: 150, col: 250, row: 250 } as const;
/** Cases des curseurs (64 × 64 = 32 px CSS en 2x) et leur écart. */
export const CURSOR = { size: 64, step: 230, css: 32 } as const;
/** Point chaud par défaut (px de la case 64 × 64) : pointe de la flèche, bout de l'index de la main. */
export const CURSOR_DEFAULT_HOTSPOT = { default: { x: 4, y: 4 }, pointer: { x: 26, y: 4 } } as const;
/** Nom du calque repère du point chaud, dans le groupe de chaque curseur. */
export const HOTSPOT_LAYER = "point chaud";
/** Calque de dessin d'un curseur (dans son groupe). */
export const CURSOR_DRAWING_LAYER = "Dessin";

export const element = (id: ElementId) => ELEMENTS.find((e) => e.id === id)!;

const planSlot = (n: number, usefulHeight: number, transparent: boolean): SlotSpec => ({
  id: `hero/plan-${n}`,
  element: "paysage",
  layer: n === 1 ? "Plan 1 — le plus lointain (ciel)" : n === 5 ? "Plan 5 — premier plan" : `Plan ${n}`,
  label: `Plan ${n}`,
  aliases: [`plan-${n}`, `plan${n}`],
  kind: "plan",
  size: { w: HERO.width, h: HERO.height },
  v1: { x: 0, y: 0 },
  transparent,
  mono: false,
  usefulHeight,
  crop: true,
});

const icon = (key: string, layer: string, aliases: string[], v1: { x: number; y: number }): SlotSpec => ({
  id: `icones/${key}`,
  element: "icones",
  layer,
  label: layer,
  aliases: [key, ...aliases],
  kind: "icon",
  size: { w: 128, h: 128 },
  v1,
  transparent: true,
  mono: true,
  crop: false,
});

export const SLOTS: SlotSpec[] = [
  planSlot(1, 1600, false),
  planSlot(2, 900, true),
  planSlot(3, 760, true),
  planSlot(4, 560, true),
  planSlot(5, 380, true),
  { id: "signature", element: "signature", layer: "Signature", label: "Signature", aliases: ["signature", "logo"], kind: "signature", size: { w: 1200, h: 300 }, v1: { x: 80, y: 1720 }, transparent: true, mono: true, crop: true },
  { id: "papier", element: "papier", layer: "Papier (tuile)", label: "Papier", aliases: ["papier", "tuile"], kind: "tile", size: { w: 512, h: 512 }, v1: { x: 1400, y: 1720 }, transparent: false, mono: false, bitmapOnly: true, crop: false },
  {
    id: "cadre",
    element: "cadre",
    layer: "Cadre",
    label: "Cadre",
    aliases: ["cadre"],
    kind: "nine",
    size: { w: 300, h: 300 },
    v1: { x: 2000, y: 1720 },
    transparent: true,
    mono: false,
    slice: { top: 48, right: 48, bottom: 48, left: 48 },
    crop: false,
  },
  { id: "trait", element: "trait", layer: "Trait", label: "Trait", aliases: ["trait"], kind: "stroke", size: { w: 1200, h: 80 }, v1: { x: 80, y: 2100 }, transparent: true, mono: true, crop: true },
  icon("fleche-gauche", "Flèche gauche", [], { x: 2400, y: 1720 }),
  icon("fleche-droite", "Flèche droite", [], { x: 2560, y: 1720 }),
  icon("fermer", "Fermer", ["croix"], { x: 2400, y: 1880 }),
  icon("lecture", "Lecture", ["play"], { x: 2560, y: 1880 }),
  { id: "accessoires/scotch", element: "scotch", layer: "Scotch", label: "Scotch", aliases: ["scotch"], kind: "tape", size: { w: 400, h: 160 }, v1: { x: 2000, y: 2100 }, transparent: true, mono: false, crop: true },
];

/* ---- Palette et curseurs (lot 4) : emplacements à part (pas convertis en assets) ---- */

/** Une pastille par couleur de base et par nuance, colonne par groupe de la palette. */
export const SWATCH_SLOTS: SlotSpec[] = PALETTE_GROUPS.flatMap((g, col) => {
  const keys: { key: PaletteKey; layer: string; label: string }[] = [
    ...(g.base ? [{ key: g.base as PaletteKey, layer: g.label, label: g.label }] : []),
    // Sans base (Visionneuse) : le nom du groupe dans le libellé, sinon la colonne n'a pas de titre.
    ...g.nuances.map((n) => ({ key: n.key as PaletteKey, layer: `${g.label} · ${n.short}`, label: g.base ? n.short : `${g.label} · ${n.short}` })),
  ];
  return keys.map((k, row) => ({
    id: `palette/${k.key}`,
    element: "palette" as const,
    layer: k.layer,
    label: k.label,
    aliases: [looseName(k.layer)],
    kind: "swatch" as const,
    size: { w: SWATCH.size, h: SWATCH.size },
    v1: { x: 0, y: 0 },
    transparent: true,
    mono: false,
    crop: false,
    zone: { x: BOARD.pad + col * SWATCH.col, y: BOARD.pad + row * SWATCH.row },
    paletteKey: k.key,
  }));
});

export const CURSOR_SLOTS: SlotSpec[] = (
  [
    ["default", "Normal", ["normal", "curseur-normal", "fleche"]],
    ["pointer", "Clic", ["clic", "curseur-clic", "main", "pointeur"]],
  ] as const
).map(([cursor, layer, aliases], i) => ({
  id: `curseur/${cursor === "default" ? "normal" : "clic"}`,
  element: "curseur" as const,
  layer,
  label: `Curseur ${layer.toLowerCase()}`,
  aliases: [...aliases],
  kind: "cursor" as const,
  size: { w: CURSOR.size, h: CURSOR.size },
  v1: { x: 0, y: 0 },
  transparent: true,
  mono: false,
  crop: false,
  zone: { x: BOARD.pad + i * CURSOR.step, y: BOARD.pad + 20 },
  cursor,
}));

/** Tous les emplacements : éléments convertis en assets, puis pastilles et curseurs. */
export const ALL_SLOTS: SlotSpec[] = [...SLOTS, ...SWATCH_SLOTS, ...CURSOR_SLOTS];
export const isNuanceSwatch = (s: SlotSpec) => Boolean(s.paletteKey && isNuance(s.paletteKey));
/* ---- fin Palette et curseurs (lot 4) ---- */

/** Position de la zone à peindre dans sa carte v2 (coin haut-gauche). */
export function zoneOffset(slot: SlotSpec): { x: number; y: number } {
  if (slot.zone) return slot.zone;
  if (slot.kind === "icon") {
    const i = SLOTS.filter((s) => s.kind === "icon").indexOf(slot);
    return { x: BOARD.pad + i * ICON_STEP, y: BOARD.pad };
  }
  return { x: BOARD.pad, y: BOARD.pad };
}

/** Cadre de l'emplacement dans le document, selon la disposition (et le plan de travail éventuel). */
export function frameOf(slot: SlotSpec, layout: Layout, boardOrigin?: { x: number; y: number }): Frame {
  if (layout === "v1") return { ...slot.v1, ...slot.size };
  const board = boardOrigin ?? element(slot.element).board;
  const o = zoneOffset(slot);
  return { x: board.x + o.x, y: board.y + o.y, ...slot.size };
}

/** Zone de la carte occupée par les emplacements (pour placer le panneau à droite). */
export function zonesWidth(el: ElementSpec): number {
  const slots = ALL_SLOTS.filter((s) => s.element === el.id);
  return Math.max(...slots.map((s) => zoneOffset(s).x + s.size.w)) - BOARD.pad;
}

export const GUIDES_GROUP = "_guides";
export const README_LAYER = "LISEZ-MOI";
export const PREVIEW_LAYER = "Aperçu — ne pas modifier";
export const README_FRAME: Frame = { x: 20, y: 12, w: 3960, h: 330 };
export const README_LINES = [
  "LISEZ-MOI — kit de thème",
  "1. Chaque groupe = un élément du site ; sa carte montre où il apparaît et ce qu'il faut savoir.",
  "2. Peins dans le calque de l'élément ; tu peux y ajouter des calques et des groupes, ne renomme pas les groupes numérotés.",
  "3. Ce que tu ne veux pas dessiner : laisse-le tel quel, il est reconnu et gardé.",
  "4. Pixellise effets, textes et objets dynamiques ; reste en RVB 8 bits ; ne redimensionne pas le document.",
  "5. Le grain va dans « 3 · Papier », pas dans le paysage. Couleurs : « 8 · Palette » ; souris : « 9 · Curseur ». Renvoie le .psd tel quel.",
];

/** Préfixe du nom du calque qui porte l'identifiant d'export (dans `_guides`). */
export const EXPORT_ID_PREFIX = "kit ";
export const EXPORT_ID_RE = /\b(k2-[0-9a-f]{12})\b/;

/** Nom comparable : sans casse, sans accents ; espaces, tirets et soulignés équivalents. */
export function normalizeLayerName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[\s_\-–—]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Nom réduit à ce qui identifie l'emplacement : sans casse ni accents, sans
 * numérotation (« 1 · »), sans précision après un tiret long (« — premier
 * plan ») ni parenthèse ; toute ponctuation devient un tiret.
 * « Plan 1 — le plus lointain (ciel) » → « plan-1 » ; « 1 · Paysage d'accueil » → « paysage-d-accueil ».
 */
export function looseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/\s+[—–]\s*|\s+-\s+/)[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*\d+\s*[·.:)\-]\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Calques et groupes que l'import saute (guides, lisez-moi, aperçus). */
export function isIgnoredName(name: string): boolean {
  const n = looseName(name);
  return n === "guides" || n === "lisez-moi" || n.startsWith("apercu") || name.trim().startsWith("_");
}
