import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import ScrollHint from "@/components/hero/ScrollHint";

/**
 * Hero « type-only » : une phrase, un mot mis en valeur (.hero-mark), et une
 * note en marge (assets.heroNote) dans la police de légende du thème.
 */
export default function HeroTypeOnly({ note }: { note?: string }) {
  const t = useTranslations("home.hero");
  const tSite = useTranslations("site");

  return (
    <section
      className="hero hero-type relative flex min-h-[calc(100svh-var(--header-h))] flex-col justify-end"
      aria-label={tSite("name")}
    >
      {note && (
        <p className="hero-note" aria-hidden="true">
          {note}
        </p>
      )}

      <div className="shell pb-16 pt-40 md:pb-24">
        <Eyebrow>{tSite("name")}</Eyebrow>
        <h1 className="mt-6 max-w-5xl font-display text-[clamp(2.6rem,7.5vw,6.5rem)] leading-[1.02] text-ink">
          {t.rich("statement", {
            mark: (chunks) => <span className="hero-mark">{chunks}</span>,
          })}
        </h1>
        <p className="caption-text mt-8 max-w-xl font-caption text-[0.78rem] tracking-[0.2em] uppercase text-ink-soft">
          {tSite("role")}
        </p>
      </div>

      <div className="shell pb-10">
        <ScrollHint />
      </div>
    </section>
  );
}
