/**
 * Textes de la toile dans les composants SERVEUR de src/blocks (lot 130b) : placeholders, boutons « + Ajouter … » et états vides ne
 * sont rendus qu'en vue brouillon (`ctx.edit`, admin vérifié). On y lit la langue d'interface du compte et le catalogue d'admin ;
 * hors édition, rien n'est lu (le HTML public en cache ne dépend jamais de la session). Import dynamique : les tests Node qui
 * chargent le registre n'amènent pas next/headers.
 */
import { DEFAULT_ADMIN_LANG, type AdminT } from "@/i18n/admin-lang";

export async function editI18n(ctx: { edit?: boolean }, namespace = "blockPublic"): Promise<{ ta: AdminT; lang: string }> {
  if (!ctx.edit) return { ta: (key) => key, lang: DEFAULT_ADMIN_LANG };
  const { getAdminLang, getAdminT } = await import("@/i18n/admin-server");
  return { ta: await getAdminT(namespace), lang: await getAdminLang() };
}
