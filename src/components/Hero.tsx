import { getLocale } from "next-intl/server";

import HeroParallax from "@/components/hero/HeroParallax";
import HeroSpotlight from "@/components/hero/HeroSpotlight";
import HeroTypeOnly from "@/components/hero/HeroTypeOnly";
import type { HeroContent } from "@/components/hero/types";
import type { AppLocale } from "@/i18n/routing";
import { getActiveTheme } from "@/lib/theme";
import { thumbHashToDataURL } from "thumbhash";

/**
 * Hero de l'accueil.
 *
 * Seule exception au principe « un composant ne lit pas le thème » : la
 * variante de hero est STRUCTURELLE (calques animés, faisceau, ou texte
 * seul — trois DOM différents), donc choisie ici, côté serveur. Les trois
 * sous-composants ne contiennent aucune valeur visuelle : tout passe par les
 * tokens et variants.css. Les textes viennent du bloc « hero » et des réglages.
 */
/**
 * Aperçu ThumbHash d'un plan, pour les plans opaques seulement. Sur un plan
 * détouré, l'alpha flouté déborde de la silhouette et dessine la boîte de
 * rognage en bande claire (défaut phase 6c) : pas d'aperçu, le ciel du plan
 * du fond reste visible jusqu'au chargement. Bit 23 de l'en-tête = hasAlpha.
 */
function planPlaceholder(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  const bytes = Buffer.from(hash, "base64");
  const hasAlpha = ((bytes[0] | (bytes[1] << 8) | (bytes[2] << 16)) >> 23) & 1;
  return hasAlpha ? undefined : thumbHashToDataURL(bytes);
}

export default async function Hero({ content }: { content: HeroContent }) {
  const theme = await getActiveTheme();
  const locale = (await getLocale()) as AppLocale;

  switch (theme.variants.hero) {
    case "parallax-layers": {
      // Plans dessinés (kit) : données seulement, le placeholder ThumbHash
      // décodé ici (le client ne reçoit qu'une petite image PNG).
      const plans = (theme.assets.kit?.plans ?? []).map((p) =>
        p ? { ...p, placeholder: planPlaceholder(p.thumbhash) } : null,
      );
      return <HeroParallax layers={theme.assets.kit?.plansOnly ? [] : (theme.assets.heroLayers ?? [])} plans={plans} content={content} />;
    }
    case "spotlight":
      return <HeroSpotlight content={content} />;
    case "type-only":
      return <HeroTypeOnly note={theme.assets.heroNote?.[locale]} content={content} />;
  }
}
