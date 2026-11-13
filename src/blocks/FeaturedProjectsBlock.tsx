import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import ProjectStrip from "@/components/ProjectStrip";
import { Link } from "@/i18n/navigation";
import { getFeaturedProjects } from "@/lib/gallery";
import { claimEager } from "@/lib/eager";
import { hrefForPage } from "@/lib/pages";

import { stripProject } from "./strip-project";
import { inline, localized, pageRef, tr, type BlockContext, localizedText } from "./types";

export const featuredProjectsSchema = z.object({
  eyebrow: localized,
  title: localized,
  intro: localizedText,
  limit: z.number().int().min(1).max(12).default(2),
  /** Projets choisis (slugs, dans l'ordre). Absent : les projets « mis en avant ». */
  projects: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(12).optional(),
  more: z.object({ label: localized, pageId: pageRef }).optional(),
});

export default async function FeaturedProjectsBlock({
  props,
  ctx,
}: {
  props: z.infer<typeof featuredProjectsSchema>;
  ctx: BlockContext;
}) {
  const eager = claimEager(2);
  const projects = await getFeaturedProjects(ctx.locale, props.limit, props.projects);
  const moreHref = props.more ? await hrefForPage(props.more.pageId, ctx.locale) : null;

  return (
    <>
      <section className="shell pt-[var(--section-gap)]">
        <header className="max-w-2xl">
          <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.75rem)] text-ink" {...inline(ctx, "title")}>
            {tr(props.title, ctx.locale)}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ink-soft" {...inline(ctx, "intro")}>
            {tr(props.intro, ctx.locale)}
          </p>
        </header>
      </section>

      {projects.map((project, index) => (
        <ProjectStrip key={project.slug} project={stripProject(project)} eager={index === 0 ? eager : 0} deep={index % 2 === 0} />
      ))}

      {props.more && moreHref && (
        <section className="shell">
          <Link className="link-underline text-sm" href={moreHref}>
            {tr(props.more.label, ctx.locale)} <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}
    </>
  );
}
