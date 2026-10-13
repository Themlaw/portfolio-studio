import Eyebrow from "@/components/Eyebrow";
import HeroBackdropMedia from "@/components/hero/HeroBackdrop";
import ScrollHint from "@/components/hero/ScrollHint";
import { heroMarks, type HeroContent } from "@/components/hero/types";
import { Link } from "@/i18n/navigation";

/**
 * Hero « spotlight » : pas de décor, un faisceau (halo du token accentGlow,
 * dessiné en CSS par .hero-spotlight), le nom en grand et l'accès direct
 * à la demoreel. Une image ou vidéo de fond choisie dans l'éditeur se place
 * derrière le faisceau ; les petits textes reçoivent alors le halo `.hero-halo`
 * (le titre, en très grand corps, tient seul).
 */
export default function HeroSpotlight({ content }: { content: HeroContent }) {
  const marks = heroMarks(content);
  const bg = content.background;
  const halo = bg ? " hero-halo" : "";

  return (
    <section
      className="hero hero-spotlight flex min-h-[calc(100svh-var(--header-h))] flex-col"
      aria-label={content.name}
      {...(content.edit ? { "data-edit-media": "backgroundMediaId", "data-edit-media-kind": "background" } : {})}
    >
      {bg ? (
        <div className="hero-backdrop absolute inset-0 -z-10">
          <HeroBackdropMedia bg={bg} />
        </div>
      ) : null}
      <div className="shell flex flex-1 flex-col items-center justify-center pb-10 pt-24 text-center">
        <Eyebrow className={halo.trim()} {...marks.eyebrow}>{content.eyebrow}</Eyebrow>
        <h1 className="mt-6 font-display text-[clamp(3.25rem,12vw,10rem)] leading-[0.9] text-ink" {...marks.name}>
          {content.name}
        </h1>
        <p className={`hero-kicker caption-text mt-7 max-w-xl font-caption text-[0.8rem] tracking-[0.28em] uppercase${halo}`} {...marks.role}>
          {content.role}
        </p>
        <Link href={content.reelHref} className="btn mt-10">
          <span aria-hidden="true">▶</span>
          <span {...marks.reel}>{content.reel}</span>
        </Link>
      </div>

      <div className="shell flex justify-center pb-10">
        {content.showScroll &&
          (bg ? (
            <div className="hero-halo">
              <ScrollHint label={content.scroll} mark={marks.scroll} />
            </div>
          ) : (
            <ScrollHint label={content.scroll} mark={marks.scroll} />
          ))}
      </div>
    </section>
  );
}
