/**
 * Règle des NOUVEAUX mots de passe (changement, réinitialisation, amorçage du premier admin) : un seul endroit, sans dépendance,
 * pour que le serveur ET l'écran de l'admin (composant client) disent la même chose. La connexion ne vérifie jamais la longueur :
 * un compte existant au mot de passe plus court reste accessible (docs/SECURITE.md §2.4).
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
