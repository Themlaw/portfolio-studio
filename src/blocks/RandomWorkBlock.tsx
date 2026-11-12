import type { CSSProperties } from "react";
import { z } from "zod";

import MediaFrame from "@/components/MediaFrame";
import Picture from "@/components/Picture";
import { Link } from "@/i18n/navigation";
import { getPoolWorks, sampleWorks, selectWorks, type PoolWork, type WorkSource } from "@/lib/random-works";

import RandomPick from "./RandomPick";
import { collection, inline, localized, type BlockContext } from "./types";
import { editI18n } from "./edit-i18n";

/** Œuvres envoyées au navigateur, qui en tire une à chaque visite (au-delà, un échantillon pris au hasard au rendu). */
export const MAX_CANDIDATES = 12;

export const randomWorkSchema = z.object({
  /** D'où vient l'œuvre : tout le portfolio, une catégorie (collection) ou une sélection d'œuvres. */
  source: z.enum(["all", "collection", "manual"]).default("all"),
  collection: collection.optional(),
  /** Sélection manuelle : identifiants d'emplacement (slug) des œuvres. */
  works: z.array(z.string().regex(/^[a-z0-9-]+$/).max(120)).max(200).optional(),
  /** Étiquette facultative au-dessus de l'œuvre (« Pour te consoler… »). */
  eyebrow: localized.optional(),
  /** Largeur : colonne de texte, ou large (cadre du site). */
  width: z.enum(["text", "wide"]).default("text"),
});

/**
 * « Une œuvre au hasard » (lot 89) : une œuvre PUBLIÉE tirée à chaque visite, avec son image (la chaîne responsive des blocs Image : AVIF /
 * WebP, dimensions, cadre du thème), son titre et un lien vers la page qui la présente. Jamais un brouillon, une œuvre à la corbeille ni un
 * projet qu'aucune page ne montre (src/lib/random-works.ts) ; source vide = le bloc n'est pas affiché (rien, pas même un espace).
 *
 * Le tirage se fait dans le navigateur (RandomPick) : la page est en cache. Sur la toile (vue brouillon), la première œuvre et une note
 * disent ce que le visiteur verra : un œuvre différente à chaque visite.
 * Disponible sur la page « Page introuvable » ; sur une page ordinaire il serait sans danger (voir le rapport du lot 89).
 */
export default async function RandomWorkBlock({ props, ctx }: { props: z.infer<typeof randomWorkSchema>; ctx: BlockContext }) {
  const { ta } = await editI18n(ctx);
  const pool = await getPoolWorks();
  const source: WorkSource | null =
    props.source === "collection" ? (props.collection ? { source: "collection", collection: props.collection } : null) : props.source === "manual" ? { source: "manual", works: props.works ?? [] } : { source: "all" };
  const works = source ? selectWorks(pool, source) : [];
  // Source vide : rien en public (pas même un espace) ; sur la toile, une note pour qu'on règle la source.
  if (!works.length && !ctx.edit) return null;
  const candidates = sampleWorks(works, MAX_CANDIDATES);
  const eyebrow = props.eyebrow?.[ctx.locale]?.trim() ? props.eyebrow[ctx.locale] : null;
  const figure = (w: PoolWork) => {
    const title = w.title[ctx.locale] || w.title.fr;
    const alt = w.alt?.[ctx.locale] || title;
    const href = w.path[ctx.locale] || w.path.fr;
    const ratio = w.width / Math.max(1, w.height);
    return (
      <figure key={w.slug} className={`block-image ${props.width === "text" ? "max-w-2xl" : ""}`} data-width={props.width} data-solo="" data-random-work={w.slug} style={{ "--ir": ratio.toFixed(4) } as CSSProperties}>
        <Link href={href} className="block">
          <MediaFrame ratio={ratio} grow fit="cover">
            <Picture src={w.url} sources={w.sources} alt={alt} width={w.width} height={w.height} sizes={props.width === "text" ? "(min-width: 768px) 672px, 100vw" : "(min-width: 1236px) 1200px, 100vw"} className="block-image-media" />
          </MediaFrame>
        </Link>
        <figcaption className="mt-3 text-sm text-ink-soft">
          <Link href={href} className="link-underline">
            {title}
          </Link>
        </figcaption>
      </figure>
    );
  };
  return (
    <section className="shell pt-[var(--section-gap)]" data-random-work-block="">
      {(eyebrow || ctx.edit) && (
        <p className="eyebrow mb-4 max-w-2xl" {...inline(ctx, "eyebrow")} {...(ctx.edit ? { "data-placeholder": ta("labelOptional") } : {})}>
          {ctx.edit ? (props.eyebrow?.[ctx.locale] ?? "") : eyebrow}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="text-sm text-ink-soft" data-random-empty="">
          {ta("noWork")}
        </p>
      ) : ctx.edit || candidates.length === 1 ? (
        figure(candidates[0])
      ) : (
        <RandomPick>{candidates.map(figure)}</RandomPick>
      )}
    </section>
  );
}
