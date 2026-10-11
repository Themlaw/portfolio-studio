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
export type TutoNote = { box: string; label: string; place?: "top" | "bottom" | "left" | "right"; at?: [number, number] };
export type TutoSlide = {
  id: string;
  title: string;
  image: string;
  alt: string;
  bullets: string[];
  notes?: TutoNote[];
  arrows?: [string, string][];
  action?: "download" | "send";
};

const KEEP = "Pas envie ? Laisse tel quel : c'est reconnu et gardé.";

export const TUTO_SLIDES: TutoSlide[] = [
  {
    id: "principe",
    title: "Le principe",
    image: "principe",
    alt: "Trois étapes : la page Thèmes avec le bouton de téléchargement, le kit ouvert dans Photoshop, puis le site avec les dessins.",
    bullets: [
      "Tu télécharges un fichier Photoshop qui contient ton site tel qu'il est aujourd'hui.",
      "Tu redessines ce que tu veux : le paysage, ta signature, les icônes…",
      "Tu le renvoies : le site prend ton style, après ta validation.",
    ],
    notes: [
      { box: "etape1", label: "1 · Télécharger", place: "top" },
      { box: "etape2", label: "2 · Dessiner", place: "top" },
      { box: "etape3", label: "3 · Renvoyer", place: "top" },
    ],
    arrows: [
      ["etape1", "etape2"],
      ["etape2", "etape3"],
    ],
  },
  {
    id: "telecharger",
    title: "Télécharger le kit",
    image: "themes",
    alt: "La page Thèmes de l'admin, le bouton « Télécharger le kit Photoshop » du thème en ligne est entouré.",
    bullets: [
      "Dans Thèmes, chaque thème a son bouton « Télécharger le kit Photoshop ».",
      "Le kit reprend le thème tel qu'il est enregistré : ses couleurs, ta signature, tes dessins déjà appliqués.",
      "Quelques secondes de préparation, puis le fichier .psd arrive dans tes téléchargements.",
    ],
    notes: [{ box: "telecharger", label: "Télécharger le kit", at: [0.13, 0.82] }],
    action: "download",
  },
  {
    id: "ouvrir",
    title: "Ouvrir dans Photoshop",
    image: "kit-ensemble",
    alt: "Vue d'ensemble du kit : le LISEZ-MOI en haut, le paysage, puis les cartes des éléments ; à droite, les calques.",
    bullets: [
      "Tout en haut, le LISEZ-MOI : les règles en cinq lignes.",
      "Le groupe _guides est verrouillé : les cases, les repères et l'identifiant du kit. N'y touche pas.",
      "Les 9 groupes numérotés : un par élément du site, chacun sur sa carte (couleurs et souris compris).",
    ],
    notes: [
      { box: "lisezmoi", label: "LISEZ-MOI", place: "top" },
      { box: "arbreLisez", label: "En haut", place: "right" },
      { box: "arbreGuides", label: "Verrouillé", place: "right" },
      { box: "arbreGroupes", label: "Les 9 éléments", place: "bottom" },
    ],
  },
  {
    id: "carte",
    title: "Lire une carte",
    image: "carte-signature",
    alt: "La carte « 2 · Signature » : la case à peindre, la phrase, la vignette du site et les consignes.",
    bullets: [
      "Le titre donne l'élément et la taille de sa case.",
      "La case encadrée de rose : c'est là que tu peins.",
      "La vignette montre en rose où ça apparaît sur ton site.",
      "À droite : ce que tu peux faire, ce qui est ignoré, et « Pas envie ? ».",
    ],
    notes: [
      { box: "titre", label: "Titre et taille", place: "right" },
      { box: "zone", label: "Ta case", place: "bottom" },
      { box: "vignette", label: "Où sur le site", place: "bottom" },
      { box: "consignes", label: "Consignes", place: "bottom" },
    ],
  },
  {
    id: "paysage",
    title: "1 · Paysage d'accueil",
    image: "el-paysage",
    alt: "La carte du paysage dans le kit ; dessous, la page d'accueil avant et après (thème de test dessiné).",
    bullets: [
      "Cinq plans, du ciel (plan 1, opaque) au premier plan (plan 5).",
      "Plans 2 à 5 : transparents au-dessus de leur hauteur utile (lignes bleues).",
      "Garde la zone du titre (cadre rose) calme : ton nom s'y affiche.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "signature",
    title: "2 · Signature",
    image: "el-signature",
    alt: "La carte de la signature, puis l'en-tête du site avec le nom écrit, et avec une signature dessinée.",
    bullets: [
      "La case contient ton nom tel que le site l'écrit aujourd'hui.",
      "Dessine ta signature d'une seule couleur, sur fond transparent : le site la teinte.",
      "Elle remplace le nom en haut à gauche de toutes les pages.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "papier",
    title: "3 · Papier",
    image: "el-papier",
    alt: "La carte du papier, puis le fond d'une page sans et avec la tuile peinte.",
    bullets: [
      "Une tuile de 512 × 512 px, répétée sur le fond de toutes les pages.",
      "Sans raccord visible : vérifie avec Filtre > Autres > Translation.",
      "Un grain fin et sans forme : un motif dessinerait une grille.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "cadre",
    title: "4 · Cadre des entrées de collection",
    image: "el-cadre",
    alt: "La carte du cadre avec ses lignes vertes, puis les entrées des collections de l'accueil avec le passe-partout actuel et avec un cadre dessiné.",
    bullets: [
      "Il entoure la grande image de chaque collection (Personnages, Décors…) sur l'accueil.",
      "Les coins restent tels quels ; les bords entre les lignes vertes s'étirent.",
      "Laisse le centre transparent : l'image s'y affiche.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "trait",
    title: "5 · Trait",
    image: "el-trait",
    alt: "La carte du trait, puis la barre de défilement sous les planches, droite puis dessinée.",
    bullets: [
      "Il souligne le menu, sépare les sections et sert de barre sous les planches.",
      "Une seule couleur, fond transparent.",
      "Il est étiré dans les deux sens : garde une épaisseur régulière.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "icones",
    title: "6 · Icônes",
    image: "el-icones",
    alt: "La carte des icônes, puis la flèche « suivante » d'une planche du site (au survol) : avant, et après avec la flèche dessinée par l'artiste.",
    bullets: [
      "Les flèches sur les bords des planches, la croix de l'image agrandie, le bouton lecture.",
      "Une seule couleur chacune, fond transparent : le site les teinte.",
      "Tu ne redessines qu'une flèche ? On te propose son miroir pour l'autre.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "scotch",
    title: "7 · Scotch",
    image: "el-scotch",
    alt: "La carte du scotch, puis une image de planche sans scotch et avec le scotch dessiné.",
    bullets: [
      "Le même morceau est posé en haut de chaque image des planches.",
      "Fond transparent ; la transparence partielle (scotch translucide) est gardée.",
      "Redessiné, il active la variante « scotch » des planches dans ta copie.",
      KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "palette",
    title: "8 · Palette",
    image: "el-palette",
    alt: "La carte de la palette dans le kit, une pastille par couleur ; dessous, un bouton du site avant et après avoir repeint l'action et son survol.",
    bullets: [
      "Une colonne par couleur du site, avec ses nuances dessous : survol, texte secondaire, fond profond…",
      "Repeins une pastille pour changer cette couleur : choisis ta couleur, puis Alt+Maj+Retour arrière.",
      "Laisse-la telle quelle pour la garder ; une nuance « (auto) » suit alors sa couleur de base.",
      "Au retour, tu vois chaque couleur avant / après, et le contraste des textes est vérifié.",
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "curseur",
    title: "9 · Curseur",
    image: "el-curseur",
    alt: "La carte des curseurs dans le kit, cases « Normal » et « Clic » ; dessous, la souris sur un lien du site, flèche du système puis curseur dessiné.",
    bullets: [
      "Deux cases de 64 × 64 px : « Normal » partout, « Clic » sur ce qui se clique.",
      "Le rond rose « point chaud » marque le point qui clique : déplace-le avec ton dessin.",
      "Un contour clair et un foncé : ta souris reste visible sur tous les fonds.",
      "Tu peux revenir à la souris du système dans l'éditeur du thème, sans perdre tes dessins.",
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "regles",
    title: "Les règles d'or",
    image: "lisezmoi",
    alt: "Le LISEZ-MOI du kit.",
    bullets: [
      "Pixellise effets, textes et objets dynamiques (Calque > Pixelliser).",
      "Reste en RVB 8 bits et ne redimensionne pas le document.",
      "Ne renomme pas les groupes numérotés ; tu peux ajouter des calques dedans.",
      "Le grain va dans « 3 · Papier », pas dans le paysage.",
      "Enregistre simplement depuis Photoshop : pas de compression ZIP.",
    ],
  },
  {
    id: "renvoyer",
    title: "Enregistrer et renvoyer",
    image: "renvoyer",
    alt: "L'écran du kit d'un thème, avec la zone « Renvoyer le kit rempli » entourée.",
    bullets: [
      "Ctrl+S dans Photoshop : format PSD, accepte « Maximiser la compatibilité ».",
      "Dans l'admin, ouvre le thème puis « Renvoyer le kit rempli ».",
      "Glisse le fichier ou choisis-le : l'envoi reprend tout seul après une coupure.",
    ],
    notes: [{ box: "renvoyer", label: "Renvoyer le kit rempli", place: "right" }],
    action: "send",
  },
  {
    id: "revue",
    title: "L'écran de revue",
    image: "revue",
    alt: "L'écran de revue du kit renvoyé par l'artiste : le résumé, une carte « inchangé » et la carte « Flèche droite : redessinée » avec avant et après.",
    bullets: [
      "✓ inchangé : ce que tu n'as pas touché est gardé tel quel.",
      "✓ redessiné : avant / après, le format choisi et son poids.",
      "⚠ ou ✗ : un problème, avec la raison et comment le corriger dans Photoshop.",
      "Tes couleurs repeintes : avant / après et contraste ; si tu as repeint le paysage, une palette t'est aussi proposée.",
    ],
    notes: [
      { box: "resume", label: "Résumé", place: "right" },
      { box: "inchange", label: "Inchangé", place: "right" },
      { box: "redessinee", label: "Redessinée", place: "right" },
    ],
  },
  {
    id: "appliquer",
    title: "Appliquer et mettre en ligne",
    image: "appliquer",
    alt: "Le panneau « Appliquer au thème », avec la case du miroir de la flèche.",
    bullets: [
      "« Appliquer au thème » crée une copie brouillon avec tes dessins.",
      "Tu la vois aussitôt en aperçu en direct, sur tes vraies pages.",
      "Quand c'est bon : « Mettre en ligne » dans Thèmes.",
      "Le site ne change jamais sans ta validation.",
    ],
    notes: [
      { box: "miroir", label: "Miroir proposé", place: "bottom" },
      { box: "appliquer", label: "Appliquer", place: "right" },
    ],
  },
];
