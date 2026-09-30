import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import ScrollHint from "@/components/hero/ScrollHint";
import { Link } from "@/i18n/navigation";

/**
 * Hero « spotlight » : pas de décor, un faisceau (halo du token accentGlow,
 * dessiné en CSS par .hero-spotlight), le nom en grand et l'accès direct
 * à la demoreel.
 */
export default function HeroSpotlight() {
  const t = useTranslations("home.hero");
  const tSite = useTranslations("site");

  return (
    <section
      className="hero hero-spotlight flex min-h-[calc(100svh-var(--header-h))] flex-col"
      aria-label={tSite("name")}
    >
      <div className="shell flex flex-1 flex-col items-center justify-center pb-10 pt-24 text-center">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="mt-6 font-display text-[clamp(3.25rem,12vw,10rem)] leading-[0.9] text-ink">
          {tSite("name")}
        </h1>
        <p className="hero-kicker caption-text mt-7 max-w-xl font-caption text-[0.8rem] tracking-[0.28em] uppercase">
          {tSite("role")}
        </p>
        <Link href="/animation" className="btn mt-10">
          <span aria-hidden="true">▶</span>
          {t("reel")}
        </Link>
      </div>

      <div className="shell flex justify-center pb-10">
        <ScrollHint />
      </div>
    </section>
  );
}
