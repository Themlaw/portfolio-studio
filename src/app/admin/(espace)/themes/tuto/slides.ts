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
const BIG = "Dessine EN GRAND : le site réduit tout seul à la bonne taille, proprement.";

export const TUTO_SLIDES: TutoSlide[] = [
  {
    id: "principe",
    title: "Le principe",
    image: "principe",
    alt: "Trois étapes : la page Thèmes avec le bouton de téléchargement, les trois fichiers Photoshop du kit, puis le site avec les dessins.",
    bullets: [
      "Tu télécharges une archive avec trois fichiers Photoshop, aérés, qui contiennent ton site tel qu'il est aujourd'hui.",
      "Tu redessines ce que tu veux, EN GRAND : le décor, le logo, les icônes… Le site réduit tout seul.",
      "Tu renvoies les fichiers que tu as modifiés : le site prend ton style, après ta validation.",
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
      "Tu reçois un .zip : trois fichiers .psd et un LISEZ-MOI.txt. Le kit reprend le thème tel qu'il est enregistré : ses plans, ton logo, tes dessins déjà appliqués.",
      "Quelques secondes de préparation, puis l'archive arrive dans tes téléchargements.",
    ],
    notes: [{ box: "telecharger", label: "Télécharger le kit", at: [0.13, 0.82] }],
    action: "download",
  },
  {
    id: "ouvrir",
    title: "Les trois fichiers",
    image: "kit-ensemble",
    alt: "Les trois fichiers du kit côte à côte : le décor d'accueil en grand, le logo avec le papier et le trait, les icônes avec les curseurs, le cadre et le scotch. Chacun a ses consignes en haut.",
    bullets: [
      "1 · Décor d'accueil : un grand cadre, des calques libres. 2 · Logo et papier : ce qui se répète ou s'étire. 3 · Icônes et curseurs : les petits objets (le cadre et le scotch aussi).",
      "En haut de chaque fichier, une bande de consignes avec un exemple. Les cartes et le groupe _guides sont verrouillés : n'y touche pas.",
      "Tu n'as pas à tout redessiner, ni à tout renvoyer : un fichier absent reste inchangé.",
    ],
    notes: [
      { box: "entete-decor", label: "Consignes du fichier", place: "bottom" },
      { box: "decor", label: "1 · Décor", place: "bottom" },
      { box: "logo", label: "2 · Logo et papier", place: "bottom" },
      { box: "icones", label: "3 · Icônes et curseurs", place: "bottom" },
    ],
  },
  {
    id: "carte",
    title: "Lire une carte",
    image: "carte-logo",
    alt: "La carte du logo : la grande case à dessiner, sa légende avec la taille affichée, la phrase, la vignette du site et les consignes.",
    bullets: [
      "Le titre donne l'élément et la taille de sa case : c'est une grande case, tu as de la place.",
      "La case encadrée de rose : c'est là que tu dessines. Les pointillés bleus : la zone utile.",
      "Dessous, la taille affichée sur le site : la case est réduite pour de bon (ici de moitié).",
      "La vignette montre en rose où ça apparaît sur ton site ; à côté, ce qui est ignoré et « Pas envie ? ».",
    ],
    notes: [
      { box: "titre", label: "Titre et taille", place: "right" },
      { box: "zone", label: "Ta case, en grand", place: "bottom" },
      { box: "legende", label: "Taille affichée", place: "right" },
      { box: "vignette", label: "Où sur le site", place: "left" },
      { box: "consignes", label: "Consignes", place: "bottom" },
    ],
  },
  {
    id: "paysage",
    title: "1 · Décor d'accueil",
    image: "el-paysage",
    alt: "Le fichier du décor dans le kit : la bande de consignes puis le grand cadre ; dessous, la page d'accueil avant et après (thème de test dessiné).",
    bullets: [
      "Calques LIBRES : chaque calque (ou groupe) de premier niveau devient un plan. Le plus bas de la pile est le plus lointain.",
      "Tu choisis le nombre de plans (jusqu'à 8) et leur ordre : crée, supprime, déplace les calques comme tu veux. Un calque masqué est ignoré.",
      "Le fichier contient déjà le décor actuel, découpé en ses plans : pars-en, ou repars de zéro.",
      "Le plan du fond peut être opaque (un ciel) ; garde la zone du titre (cadre rose) calme.",
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "signature",
    title: "2 · Logo",
    image: "el-signature",
    alt: "La carte du logo, puis l'en-tête du site avec le nom écrit, et avec un logo dessiné.",
    bullets: [
      "La case (2400 × 600 px) contient ton nom tel que le site l'écrit aujourd'hui.",
      "Dessine ton logo sur fond transparent. Couleurs gardées, ou une seule couleur teintée par le Nom du site : plusieurs couleurs, elles sont gardées ; une seule, elle suit le thème.",
      "Le site l'affiche petit (environ 160 × 40 px au départ, réglable avec « Taille du logo ») : garde des traits épais.",
      "Il remplace le nom en haut à gauche de toutes les pages.",
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
    title: "2 · Papier",
    image: "el-papier",
    alt: "La carte du papier avec la tuile et l'aperçu 3 × 3 à côté, puis le fond d'une page sans et avec la tuile peinte.",
    bullets: [
      "Une tuile de 1024 × 1024 px, réduite de moitié (512 × 512) et répétée sur le fond de toutes les pages.",
      "À côté, l'aperçu de la tuile actuelle répétée 3 × 3 : les pointillés roses marquent les raccords.",
      "Sans raccord visible : vérifie avec Filtre > Autres > Translation.",
      "Un grain fin et sans forme : un motif dessinerait une grille. " + KEEP,
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "trait",
    title: "3 · Trait",
    image: "el-trait",
    alt: "La carte du trait, puis la barre de défilement sous les planches, droite puis dessinée.",
    bullets: [
      "Il souligne le menu, sépare les sections et sert de barre sous les planches.",
      "Une seule couleur, fond transparent ; case de 2400 × 160 px, réduite de moitié.",
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
    title: "Icônes (fichier 3)",
    image: "el-icones",
    alt: "La carte des icônes (quatre grandes cases), puis la flèche « suivante » d'une planche du site (au survol) : avant, et après avec la flèche dessinée par l'artiste.",
    bullets: [
      "Quatre cases de 512 × 512 px : les flèches sur les bords des planches, la croix de l'image agrandie, le bouton lecture.",
      BIG,
      "Une seule couleur chacune, fond transparent : le site les teinte. Les pointillés bleus marquent la zone utile.",
      "Tu ne redessines qu'une flèche ? On te propose son miroir pour l'autre.",
    ],
    notes: [
      { box: "carte", label: "Dans le kit", place: "top" },
      { box: "avant", label: "Avant", place: "top" },
      { box: "apres", label: "Après", place: "top" },
    ],
  },
  {
    id: "curseur",
    title: "Curseurs (fichier 3)",
    image: "el-curseur",
    alt: "La carte des curseurs dans le kit, cases « Normal » et « Clic » ; dessous, la souris sur un lien du site, flèche du système puis curseur dessiné.",
    bullets: [
      "Deux cases de 512 × 512 px : « Normal » partout, « Clic » sur ce qui se clique. Affiché à 32 × 32 px.",
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
    id: "cadre",
    title: "Cadre des entrées de collection (fichier 3)",
    image: "el-cadre",
    alt: "La carte du cadre avec ses lignes vertes, puis les entrées des collections de l'accueil avec le passe-partout actuel et avec un cadre dessiné.",
    bullets: [
      "Il entoure la grande image de chaque collection (Personnages, Décors…) sur l'accueil.",
      "Option A (conseillée) : dessine UN cadre carré complet dans la case de 900 × 900 px (réduite au tiers). Les lignes vertes montrent la découpe : les coins restent tels quels, les côtés répètent leur motif en boucle, sans être étirés, même sur un panorama ou une photo haute.",
      "Option B (avancée) : dessine seulement le coin du haut à gauche et le côté du haut (cadres orange), laisse le reste vide : le site les tourne pour faire tout le cadre.",
      "À l'envoi, l'aperçu montre le cadre sur un carré, un panorama et un portrait avant d'appliquer. Il habille aussi tes photos ; sur une photo précise, choisis « Sans cadre » dans son bouton Cadre.",
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
    id: "scotch",
    title: "Scotch (fichier 3)",
    image: "el-scotch",
    alt: "La carte du scotch, puis une image de planche sans scotch et avec le scotch dessiné.",
    bullets: [
      "Le même morceau est posé en haut de chaque image des planches. Case de 1200 × 480 px, réduite au tiers.",
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
    id: "regles",
    title: "Les règles d'or",
    image: "lisezmoi",
    alt: "La bande de consignes en haut du fichier du décor.",
    bullets: [
      "Dessine EN GRAND dans les cases : le site réduit, pas toi.",
      "Pixellise effets, textes et objets dynamiques (Calque > Pixelliser).",
      "Reste en RVB 8 bits et ne redimensionne pas le document.",
      "Ne renomme pas les groupes numérotés des fichiers 2 et 3 ; tu peux ajouter des calques dedans. Le décor est libre.",
      "Le grain va dans le papier (fichier 2), pas dans le décor. Les couleurs se choisissent dans l'éditeur du site.",
    ],
  },
  {
    id: "renvoyer",
    title: "Enregistrer et renvoyer",
    image: "renvoyer",
    alt: "L'écran du kit d'un thème, avec la zone « Renvoyer le kit rempli » entourée.",
    bullets: [
      "Ctrl+S dans Photoshop : format PSD, accepte « Maximiser la compatibilité ».",
      "Dans l'admin, ouvre le thème puis « Renvoyer le kit rempli » : l'archive .zip, un seul .psd, ou plusieurs .psd choisis ensemble.",
      "Tu peux n'envoyer que les fichiers modifiés ; les fichiers sont reconnus par leur contenu, pas par leur nom.",
      "L'envoi reprend tout seul après une coupure.",
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
      "La revue est groupée par fichier ; un fichier non envoyé est dit « pas envoyé : inchangé ».",
      "✓ inchangé : ce que tu n'as pas touché est gardé tel quel. ✓ redessiné : avant / après, le format choisi et son poids.",
      "Décor libre : le nombre de plans lus, et si leur composition a changé.",
      "⚠ ou ✗ : un problème, avec la raison et comment le corriger dans Photoshop.",
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
