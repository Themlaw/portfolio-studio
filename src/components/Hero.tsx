import { getLocale } from "next-intl/server";

import HeroParallax from "@/components/hero/HeroParallax";
import HeroSpotlight from "@/components/hero/HeroSpotlight";
import HeroTypeOnly from "@/components/hero/HeroTypeOnly";
import type { AppLocale } from "@/i18n/routing";
import { getActiveTheme } from "@/lib/theme";

/**
 * Hero de l'accueil.
 *
 * Seule exception au principe « un composant ne lit pas le thème » : la
 * variante de hero est STRUCTURELLE (calques animés, faisceau, ou texte
 * seul — trois DOM différents), donc choisie ici, côté serveur. Les trois
 * sous-composants ne contiennent aucune valeur visuelle : tout passe par les
 * tokens et variants.css.
 */
export default async function Hero() {
  const theme = await getActiveTheme();
  const locale = (await getLocale()) as AppLocale;

  switch (theme.variants.hero) {
    case "parallax-layers":
      return <HeroParallax layers={theme.assets.heroLayers ?? []} />;
    case "spotlight":
      return <HeroSpotlight />;
    case "type-only":
      return <HeroTypeOnly note={theme.assets.heroNote?.[locale]} />;
  }
}
