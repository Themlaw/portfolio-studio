import Picture from "@/components/Picture";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import SocialIcon from "@/components/SocialIcon";
import { getMedia } from "@/lib/media";
import { getSiteView } from "@/lib/settings";

import { inline, localized, tr, type BlockContext, localizedText } from "./types";

export const profileSchema = z.object({
  portraitMediaId: z.number().int().positive().optional(),
  portraitCaption: localized,
  eyebrow: localized,
  /** Le premier paragraphe est l'accroche (encre pleine). */
  paragraphs: z.array(localizedText).min(1).max(30),
  contactEyebrow: localized,
  contactLabel: localized,
  socialEyebrow: localized,
});

/**
 * Page « À propos » : portrait encadré, présentation, contact et réseaux.
 * Nom, métier, e-mail et réseaux sont communs au site (brouillon du site sur
 * la toile, comme l'en-tête) ; le reste est propre au bloc.
 */
export default async function ProfileBlock({ props, ctx }: { props: z.infer<typeof profileSchema>; ctx: BlockContext }) {
  const [{ site, socials }, portrait] = await Promise.all([getSiteView(ctx.locale, ctx.pageId), getMedia(props.portraitMediaId)]);
  const [lead, ...rest] = props.paragraphs;
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  const siteMark = (field: string, text: string) => (ctx.edit ? { "data-site-inline": field, "data-placeholder": text, "data-site-hint": "commun au site" } : {});

  return (
    <section className="shell pt-[clamp(6rem,14vh,10rem)]">
      <div className="grid gap-[clamp(2.5rem,6vw,5rem)] md:grid-cols-12">
        <div className="md:col-span-5 lg:col-span-4">
          <div className="mat md:sticky md:top-28" {...(ctx.edit ? { "data-edit-media": "portraitMediaId", "data-edit-media-kind": "image" } : {})}>
            {!portrait && ctx.edit && (
              <span className="pe-media-empty pe-media-portrait" lang="fr">
                Dépose ton portrait ici
              </span>
            )}
            {portrait && (
              <Picture
                src={portrait.url}
                sources={portrait.sources}
                alt={portrait.alt ? tr(portrait.alt, ctx.locale) : ""}
                width={portrait.width ?? 900}
                height={portrait.height ?? 1100}
                sizes="(min-width: 768px) 33vw, 100vw"
                className="h-auto w-full rounded-[2px]"
                priority
              />
            )}
            <p className="eyebrow pt-3" {...inline(ctx, "portraitCaption")} {...ph("Légende du portrait")}>
              {tr(props.portraitCaption, ctx.locale)}
            </p>
          </div>
        </div>

        <div className="md:col-span-7 lg:col-span-7 lg:col-start-6">
          <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
            {tr(props.eyebrow, ctx.locale)}
          </Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5rem)] text-ink" {...siteMark("name", "Ton nom")}>
            {site.name}
          </h1>
          <p className="caption-text mt-4 font-caption text-[0.72rem] tracking-[0.2em] uppercase text-secondary" {...siteMark("role", "Ton métier")}>
            {site.role}
          </p>

          <div className="mt-10 space-y-6 text-base leading-relaxed text-ink-soft">
            <p className="text-ink" {...inline(ctx, "paragraphs.0")} {...ph("Présentation")}>
              {tr(lead, ctx.locale)}
            </p>
            {rest.map((p, i) => (
              <p key={i} {...inline(ctx, `paragraphs.${i + 1}`)} {...ph("Paragraphe")}>
                {tr(p, ctx.locale)}
              </p>
            ))}
          </div>

          <hr className="rule my-12" />

          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <Eyebrow {...inline(ctx, "contactEyebrow")} {...ph("Étiquette")}>
                {tr(props.contactEyebrow, ctx.locale)}
              </Eyebrow>
              <a
                href={`mailto:${site.email}`}
                className="link-underline mt-3 block font-display text-xl break-words lg:text-2xl"
              >
                {ctx.edit ? <span {...siteMark("email", "ton@adresse.fr")}>{site.email}</span> : site.email}
              </a>
              <a className="btn mt-6" href={`mailto:${site.email}`}>
                {ctx.edit ? <span {...inline(ctx, "contactLabel")}>{tr(props.contactLabel, ctx.locale)}</span> : tr(props.contactLabel, ctx.locale)}
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <div>
              <Eyebrow {...inline(ctx, "socialEyebrow")} {...ph("Étiquette")}>
                {tr(props.socialEyebrow, ctx.locale)}
              </Eyebrow>
              <ul className="mt-3 space-y-2" {...(ctx.edit ? { "data-edit-socials": "", "data-site-hint": "commun au site" } : {})}>
                {socials.map((s, i) => (
                  <li key={`${s.label}-${i}`} {...(ctx.edit ? { "data-social-index": i } : {})}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer me"
                      className="social-link inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-primary"
                    >
                      <SocialIcon kind={s.kind} label={s.label} href={s.href} />
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
