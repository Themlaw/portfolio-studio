import type { ComponentProps, CSSProperties } from "react";

/**
 * Adresse e-mail affichée (profil, pied de page) : jamais coupée au milieu.
 * Deux morceaux insécables, « nom@ » et « domaine », séparés par une
 * occasion de coupure (<wbr>) : à défaut de tenir sur une ligne, l'adresse
 * passe à la ligne APRÈS l'@, nulle part ailleurs. La taille est fluide
 * (`.email-text`, globals.css : relative à la largeur de la colonne) et la
 * police est celle du texte du thème, plus sobre que la display.
 *
 * Sur la toile (`editable`), l'adresse reste un texte brut modifiable en place
 * (même style, sans <wbr>). `style` : style de texte du lot 2 (`site.email`).
 */
export default function EmailText({ email, editable, style }: { email: string; editable?: ComponentProps<"span"> & Partial<Record<`data-${string}`, string>>; style?: CSSProperties }) {
  if (editable) {
    return (
      <span className="email-text" style={style} {...editable}>
        {email}
      </span>
    );
  }
  const at = email.lastIndexOf("@");
  if (at <= 0)
    return (
      <span className="email-text" style={style}>
        {email}
      </span>
    );
  return (
    <span className="email-text" style={style}>
      <span className="email-part">{email.slice(0, at + 1)}</span>
      <wbr />
      <span className="email-part">{email.slice(at + 1)}</span>
    </span>
  );
}
