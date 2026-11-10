/**
 * Apparitions au défilement (lot 133) : réglage facultatif `reveal` d'un bloc (ou d'une image de planche libre).
 * Rendu en CSS pur (`animation-timeline: view()`, src/app/globals.css, classe `.rv`) : aucun script, contenu visible sans JS,
 * rien sans support du navigateur ; coupé en `prefers-reduced-motion` et à l'impression. Module pur (zod seulement).
 */
import { z } from "zod";

export const REVEAL_KINDS = ["fade", "slide", "scale"] as const;
/** Délai en cascade : 0 à 5 crans (chaque cran décale la plage d'animation de 8 % de la hauteur visible). */
export const REVEAL_MAX_DELAY = 5;

export const RevealSchema = z.object({
  kind: z.enum(REVEAL_KINDS),
  delay: z.number().int().min(0).max(REVEAL_MAX_DELAY).optional(),
});
export type Reveal = z.infer<typeof RevealSchema>;

/** Lecture tolérante : un réglage illisible est ignoré, il ne masque jamais le bloc. */
export function readReveal(raw: unknown): Reveal | undefined {
  const parsed = RevealSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Attributs de l'enveloppe animée, ou null : jamais le premier bloc (affichage immédiat, LCP), jamais en édition
 * (l'Aperçu, lui, anime), jamais sans réglage (DOM inchangé pour les anciennes données).
 */
export function revealAttrs(reveal: Reveal | undefined, where: { first: boolean; edit: boolean }): { className: string; "data-reveal": string; "data-rv-d": string } | null {
  if (!reveal || where.first || where.edit) return null;
  return { className: "rv", "data-reveal": reveal.kind, "data-rv-d": String(reveal.delay ?? 0) };
}
