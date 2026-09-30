/** Textes du hero : identité (réglages) + bloc « hero » (base). */
export type HeroContent = {
  name: string;
  role: string;
  eyebrow: string;
  /** Phrase du hero type-only ; <mark>…</mark> signale le mot mis en valeur. */
  statement: string;
  /** Chemin (sans langue) de la page animation, pour le bouton demoreel. */
  reelHref: string;
};
