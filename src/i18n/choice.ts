/**
 * Choix de langue du visiteur (lot 126). Cookie posé UNIQUEMENT quand le visiteur clique le sélecteur FR / EN : il ne vient jamais
 * du navigateur (Accept-Language) ni d'une simple visite d'une adresse /en/… Le proxy (src/proxy.ts) ne le lit que pour « / » et
 * les adresses sans langue ; une adresse avec langue prime toujours. Module sans dépendance : importé par le proxy et le sélecteur.
 */
export const LANG_CHOICE_COOKIE = "portfolio-lang";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Mémorise le choix (navigateur seulement). Silencieux si les cookies sont refusés. */
export function rememberLangChoice(locale: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LANG_CHOICE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
  } catch {
    /* cookies refusés : le choix ne sera pas retenu, la bascule fonctionne quand même */
  }
}
