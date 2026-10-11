import Eyebrow from "@/components/Eyebrow";
import ScrollHint from "@/components/hero/ScrollHint";
import { heroMarks, type HeroContent } from "@/components/hero/types";
import { Link } from "@/i18n/navigation";

/**
 * Hero « spotlight » : pas de décor, un faisceau (halo du token accentGlow,
 * dessiné en CSS par .hero-spotlight), le nom en grand et l'accès direct
 * à la demoreel.
 */
export default function HeroSpotlight({ content }: { content: HeroContent }) {
  const marks = heroMarks(content);

  return (
    <section
      className="hero hero-spotlight flex min-h-[calc(100svh-var(--header-h))] flex-col"
      aria-label={content.name}
    >
      <div className="shell flex flex-1 flex-col items-center justify-center pb-10 pt-24 text-center">
        <Eyebrow {...marks.eyebrow}>{content.eyebrow}</Eyebrow>
        <h1 className="mt-6 font-display text-[clamp(3.25rem,12vw,10rem)] leading-[0.9] text-ink" {...marks.name}>
          {content.name}
        </h1>
        <p className="hero-kicker caption-text mt-7 max-w-xl font-caption text-[0.8rem] tracking-[0.28em] uppercase" {...marks.role}>
          {content.role}
        </p>
        <Link href={content.reelHref} className="btn mt-10">
          <span aria-hidden="true">▶</span>
          <span {...marks.reel}>{content.reel}</span>
        </Link>
      </div>

      <div className="shell flex justify-center pb-10">
        {content.showScroll && <ScrollHint label={content.scroll} mark={marks.scroll} />}
      </div>
    </section>
  );
}
