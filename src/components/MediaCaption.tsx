import type { CSSProperties } from "react";

/**
 * Titre, légende et date sous un média (lot 39) : UN seul composant, posé sous une image, une vidéo, chaque case de
 * grille, une grille entière et chaque image d'« Images qui défilent ». Trois champs facultatifs : Titre et Légende à
 * gauche (l'un sous l'autre), Date à droite ; la date passe sous la légende quand ça ne tient pas (retour à la ligne
 * du conteneur flex, voir `.media-caption` dans globals.css).
 *
 * - Public et Aperçu (`edit` faux) : seuls les champs remplis existent ; tout vide = rien du tout (aucune marge).
 * - Toile (`edit`) : les trois champs sont dans le DOM (saisie en place) ; les vides ne montrent leur repère gris
 *   (« Titre », « Légende », « Date ») que sur un composant survolé ou choisi (edit-layer.css, `data-cap-host`).
 *
 * Module sans état ni accès aux données : lu par le serveur (blocs) comme par le client (bande d'images).
 */

export type CaptionField = "title" | "legend" | "date";

export const CAPTION_PLACEHOLDERS: Record<CaptionField, string> = { title: "Titre", legend: "Légende", date: "Date" };

/** Un champ : son texte, ses repères d'édition (`data-inline`, `data-slot-inline`… posés par l'appelant) et son style local. */
export type CaptionPart = { text: string; attrs?: Record<string, string | undefined>; style?: CSSProperties; className?: string };

export const EMPTY_PART: CaptionPart = { text: "" };

export default function MediaCaption({ title, legend, date, edit = false, className = "", as: Tag = "div" }: { title: CaptionPart; legend: CaptionPart; date: CaptionPart; edit?: boolean; className?: string; as?: "div" | "figcaption" }) {
  const shows = (p: CaptionPart) => edit || p.text.trim() !== "";
  if (!shows(title) && !shows(legend) && !shows(date)) return null;
  const field = (name: CaptionField, p: CaptionPart, extra: string) =>
    shows(p) ? (
      <span key={name} className={`strip-caption mc-${name} ${extra} ${p.className ?? ""}`.trim()} data-cap={name} {...p.attrs} {...(edit ? { "data-placeholder": CAPTION_PLACEHOLDERS[name], spellCheck: true } : {})} style={p.style}>
        {p.text}
      </span>
    ) : null;
  const main = [field("title", title, "mc-field"), field("legend", legend, "mc-field")].filter(Boolean);
  return (
    <Tag className={`media-caption ${className}`.trim()} data-media-caption="">
      {main.length > 0 && <span className="mc-main">{main}</span>}
      {field("date", date, "mc-field")}
    </Tag>
  );
}
