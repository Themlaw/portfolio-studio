import { getTranslations } from "next-intl/server";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { boardMarks } from "@/lib/board-marks";
import { boardWorkCount, getProjectBoard } from "@/lib/gallery";

import { ownLayoutOf, ownTextOf } from "./board-layout";
import { boardRefs, countKey, pageCounts, type TreeBlock } from "./tree";
import { inline, localized, localizedText, projectSlug, textStyle, tr, type BlockContext } from "./types";

export const sectionTitleSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  intro: localizedText.optional(),
  /**
   * Titre lié à un projet : son nom (titre) et sa présentation (texte) viennent du projet ; l'étiquette
   * reste celle du bloc.
   */
  linked: z.boolean().optional(),
  /** Projet repris par un titre lié (v0.19). Absent : le projet du conteneur qui le porte (grille, ancien conteneur). */
  project: projectSlug.optional(),
  /**
   * Titre principal de la page (lot 22) : un <h1>, en grand, sous l'espace du haut de page (rendu de l'ancien « En-tête
   * de collection »). Absent ou faux : un titre de section (<h2>). Un Titre inséré en haut d'une page sans ouverture
   * naît principal ; les pages existantes ne changent pas.
   */
  main: z.boolean().optional(),
  /** Compteurs « N œuvres · M projets » sous le titre, calculés depuis les planches de la page (un champ qui n'existe que s'il est demandé). */
  counts: z.boolean().optional(),
});

/**
 * Titre de section : étiquette, titre, présentation, compteurs. Même rendu que l'ancien
 * en-tête des « Projets mis en avant » (la migration 0014 s'appuie dessus :
 * parité au pixel). Peut reprendre le nom et la présentation d'un projet
 * (`linked` + `project`, projet créé sur la page : nom modifiable en place,
 * comme sur sa planche) ; à défaut de `project`, celui du conteneur.
 *
 * Titre principal (`main`) : le rendu exact de l'ancien « En-tête de collection » (migration 0022 : parité au pixel).
 */
export default async function SectionTitleBlock({ props, ctx }: { props: z.infer<typeof sectionTitleSchema>; ctx: BlockContext }) {
  const slug = props.project ?? ctx.project;
  // Lot 111 : le titre lié montre les textes que le bloc Projet de la MÊME page porte pour ce projet (copie propre), sinon ceux du projet.
  const ownText = props.linked && slug ? (boardRefs((ctx.pageBlocks ?? []) as TreeBlock[]).map((r) => (r.slug === slug ? ownTextOf(r.block.props) : null)).find(Boolean) ?? null) : null;
  const project = props.linked && slug ? await getProjectBoard(slug, ctx.locale, undefined, null, ownText) : null;
  if (props.linked && !project && !ctx.edit) return null;
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  const main = props.main === true && !props.linked && !ctx.cell;
  const withCounts = props.counts === true && !props.linked;
  const own = !props.linked;
  const Heading = main ? "h1" : "h2";
  // Vue brouillon : le nom et la présentation du projet se modifient en place (v0.15). Le contenu
  // est celui du projet (une seule source, partagée avec sa planche) ; seule la mise en forme est celle du bloc.
  const linkedEdit = props.linked && project?.edit ? project.edit : null;
  const title = props.linked ? (project?.title ?? "") : props.title ? tr(props.title, ctx.locale) : "";
  const intro = props.linked ? (project?.description ?? "") : props.intro ? tr(props.intro, ctx.locale) : null;

  // Compteurs : calculés depuis le contenu de la page (brouillon sur la toile, version publiée en ligne).
  let counts: string | null = null;
  if (withCounts) {
    const tg = await getTranslations("gallery");
    const tp = await getTranslations("projects");
    const blocks = ctx.pageBlocks ?? [];
    const known = new Map<string, number | null>();
    await Promise.all(
      boardRefs(blocks).map(async (b) => {
        const key = countKey(b.slug, b.collection, b.block);
        if (!known.has(key)) known.set(key, null);
        known.set(key, await boardWorkCount(b.slug, b.collection, ownLayoutOf(b.block.props)));
      }),
    );
    const total = pageCounts(blocks, (slug, c, block) => known.get(countKey(slug, c, block)) ?? null);
    counts = `${tg("count", { count: total.works })} · ${tp("count", { count: total.projects })}`;
  }

  const op = (field: "eyebrow" | "intro" | "counts", has: boolean, add: string, remove: string) => (
    <button type="button" className="pe-field-op" data-edit-field-op={`${has ? "remove" : "add"}-${field}`}>
      {has ? remove : add}
    </button>
  );
  const header = (
    <header
      className={`${main ? `page-head${withCounts ? "" : " mb-[var(--t-space-l)]"}` : "title-head"} max-w-2xl${ctx.edit && own ? " relative pe-field-host" : ""}`}
      {...(linkedEdit ? { ...boardMarks(linkedEdit), "data-edit-board-label": project?.title } : {})}
    >
      {/* Étiquette, présentation, compteurs : des champs qui n'existent que s'ils ont été demandés (lot 19a, 22). */}
      {ctx.edit && own && (
        <div className="pe-field-ops" {...(ctx.cell ? { "data-cell": "" } : {})}>
          {op("eyebrow", props.eyebrow !== undefined, "+ Ajouter une étiquette", "Retirer l'étiquette")}
          {op("intro", props.intro !== undefined, "+ Ajouter une présentation", "Retirer la présentation")}
          {op("counts", props.counts === true, "+ Ajouter les compteurs", "Retirer les compteurs")}
        </div>
      )}
      {(props.eyebrow || (ctx.edit && props.linked)) && (
        <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
          {props.eyebrow ? tr(props.eyebrow, ctx.locale) : ""}
        </Eyebrow>
      )}
      <Heading
        className={`mt-4 font-display ${main ? "text-[clamp(2.75rem,8vw,6rem)]" : "text-[clamp(2rem,5vw,3.75rem)]"} text-ink`}
        {...(props.linked ? { ...(linkedEdit ? { "data-project-inline": "title", "data-look-key": "title" } : {}), ...textStyle(ctx, "title") } : inline(ctx, "title"))}
        {...ph(props.linked ? (slug ? "Nom du projet" : "Choisis le projet du titre") : "Titre")}
      >
        {title}
      </Heading>
      {/* Présentation : un champ qui n'existe que s'il a été demandé (clé `intro`) ; un « Titre » neuf n'en réserve pas (lot 19a). */}
      {(intro !== null || (ctx.edit && props.intro !== undefined)) && (
        <p
          className={`${main ? "mt-6" : "mt-5"} text-base leading-relaxed text-ink-soft`}
          {...(props.linked ? { ...(linkedEdit ? { "data-project-inline": "description", "data-look-key": "intro" } : {}), ...textStyle(ctx, "intro") } : inline(ctx, "intro"))}
          {...ph(props.linked ? "Présentation du projet" : "Présentation")}
        >
          {intro ?? ""}
        </p>
      )}
      {counts !== null && (
        <p className="eyebrow mt-6" {...(ctx.edit ? { title: "Compté automatiquement depuis les projets de cette page", "data-edit-counter": "", "data-look-key": "counts" } : {})} {...textStyle(ctx, "counts")}>
          {counts}
        </p>
      )}
    </header>
  );
  if (ctx.cell) return header;
  const edit = ctx.edit && own ? " pe-field-host" : "";
  if (main) return <section className={`page-top shell${withCounts ? " pb-[clamp(1rem,3vw,2rem)]" : ""}${edit}`}>{header}</section>;
  return <section className={`shell pt-[var(--section-gap)]${edit}`}>{header}</section>;
}
