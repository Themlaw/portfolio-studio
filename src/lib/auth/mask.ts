/**
 * Adresse e-mail masquée pour les journaux (stdout, docs/SECURITE.md N20) : `kate@exemple.fr` → `k***@exemple.fr`.
 * La sortie du conteneur part dans des journaux gardés longtemps (Docker, collecte) : on y garde de quoi reconnaître un
 * compte (première lettre, domaine), jamais l'adresse entière d'un visiteur ou d'une personne qui tente de se connecter.
 * Module pur.
 */
export function maskEmail(email: string | null | undefined): string {
  if (typeof email !== "string" || !email) return "?";
  const at = email.lastIndexOf("@");
  // Pas une adresse (saisie libre d'un formulaire de connexion) : rien de lisible, seulement sa première lettre.
  if (at <= 0 || at === email.length - 1) return `${Array.from(email)[0] ?? "?"}***`;
  const first = Array.from(email.slice(0, at))[0];
  // Domaine borné (une saisie énorme ne remplit pas le journal) et sans caractère de contrôle.
  const domain = email.slice(at + 1, at + 1 + 80).replace(/[\p{Cc}\p{Cf}\s]/gu, "");
  return `${first}***@${domain}`;
}
