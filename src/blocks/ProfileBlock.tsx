import type { CSSProperties } from "react";
import Picture from "@/components/Picture";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { ContactActionSchema } from "@/lib/contact-form";
import EmailText from "@/components/EmailText";
import SocialIcon from "@/components/SocialIcon";
import { RATIO_VALUES, ratioCss } from "@/lib/images/formats";
import { getMedia } from "@/lib/media";
import { getSiteView } from "@/lib/settings";
import { socialKeys } from "@/lib/site-schema";

import ContactCta from "./ContactCta";
import { FieldOps } from "./FieldOps";
import { hasText } from "./optional-fields";
import { inline, localized, textStyle, tr, type BlockContext, localizedText } from "./types";

export const profileSchema = z.object({
  portraitMediaId: z.number().int().positive().optional(),
  /** Étiquettes et légende : facultatives (clé absente = rien, « + Ajouter … » sur la toile, lot 27). */
  portraitCaption: localized.optional(),
  eyebrow: localized.optional(),
  /** Le premier paragraphe est l'accroche (encre pleine). */
  paragraphs: z.array(localizedText).min(1).max(30),
  contactEyebrow: localized.optional(),
  /** Texte du bouton e-mail (absent : pas de bouton, l'adresse reste). */
  contactLabel: localized.optional(),
  /** Au clic sur le bouton (lot 125) : "form" (défaut, absent compris) ouvre le formulaire de contact, "mail" ouvre l'e-mail. */
  contactAction: ContactActionSchema.optional(),
  socialEyebrow: localized.optional(),
  /** false : le nom du site n'est pas répété ici (quand l'Ouverture de la page l'affiche déjà). Absent : affiché. */
  showName: z.boolean().optional(),
  /** Format imposé au portrait (cadré : « Cadrer » sur la toile). Auto : son format. */
  portraitRatio: z.enum(RATIO_VALUES).optional(),
});

/**
 * Page « À propos » : portrait encadré, présentation, contact et réseaux.
 * Nom, métier, e-mail et réseaux sont communs au site (brouillon du site sur
 * la toile, comme l'en-tête) ; le reste est propre au bloc.
 */
export default async function ProfileBlock({ props, ctx }: { props: z.infer<typeof profileSchema>; ctx: BlockContext }) {
  const [{ site, socials }, portrait] = await Promise.all([getSiteView(ctx.locale, ctx.pageId), getMedia(props.portraitMediaId)]);
  // Vue brouillon : clés stables des réseaux (aperçu instantané des ajouts, retraits, déplacements).
  const socialKeyList = socialKeys(socials);
  const [lead, ...rest] = props.paragraphs;
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  // Un champ n'existe que s'il a été demandé ; vide en public : aucune place (sur la toile, un champ présent reste saisissable).
  const shown = (v: { fr: string; en: string } | undefined) => v !== undefined && (ctx.edit ? true : hasText(v));
  const siteMark = (field: string, text: string) => ({
    ...(ctx.edit ? { "data-site-inline": field, "data-placeholder": text, "data-site-hint": "commun au site" } : {}),
    ...textStyle(ctx, `site.${field}`),
  });

  return (
    <section className={ctx.edit ? "page-top shell pe-field-host" : "page-top shell"}>
      <div className="grid gap-[clamp(2.5rem,6vw,5rem)] md:grid-cols-12">
        <div className="md:col-span-5 lg:col-span-4">
          <div
            className="profile-portrait mat md:sticky md:top-28"
            {...(props.portraitRatio && props.portraitRatio !== "auto" ? { "data-ratio": props.portraitRatio, style: { "--box-r": ratioCss(props.portraitRatio) } as CSSProperties } : {})}
            {...(ctx.edit ? { "data-edit-media": "portraitMediaId", "data-edit-media-kind": "image" } : {})}>
            {!portrait && ctx.edit && (
              <span className="pe-media-empty pe-media-portrait" lang="fr">
                <span>Dépose ton portrait ici</span>
                <button type="button" className="pe-empty-action" data-edit-empty-media="portraitMediaId">
                  Choisir dans la médiathèque
                </button>
              </span>
            )}
            {portrait && (() => {
              const picture = (
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
              );
              // Cadré avec zoom : le cadre rogne l'image agrandie.
              return ctx.look?.crop?.portraitMediaId ? <span className="profile-portrait-frame">{picture}</span> : picture;
            })()}
            {shown(props.portraitCaption) && (
              <p className="eyebrow pt-3" {...inline(ctx, "portraitCaption")} {...ph("Légende du portrait")}>
                {tr(props.portraitCaption!, ctx.locale)}
              </p>
            )}
          </div>
        </div>

        <div className={ctx.edit ? "md:col-span-7 lg:col-span-7 lg:col-start-6 relative" : "md:col-span-7 lg:col-span-7 lg:col-start-6"}>
          <FieldOps ctx={ctx} type="profile" props={props} />
          {shown(props.eyebrow) && (
            <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
              {tr(props.eyebrow!, ctx.locale)}
            </Eyebrow>
          )}
          {props.showName !== false && (
            <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5rem)] text-ink" {...siteMark("name", "Ton nom")}>
              {site.name}
            </h1>
          )}
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
              {shown(props.contactEyebrow) && (
                <Eyebrow {...inline(ctx, "contactEyebrow")} {...ph("Étiquette")}>
                  {tr(props.contactEyebrow!, ctx.locale)}
                </Eyebrow>
              )}
              <a href={`mailto:${site.email}`} className="email-link link-underline mt-3">
                <EmailText email={site.email} editable={ctx.edit ? siteMark("email", "ton@adresse.fr") : undefined} style={textStyle(ctx, "site.email").style} />
              </a>
              {shown(props.contactLabel) && (
                <ContactCta ctx={ctx} action={props.contactAction} className="btn mt-6">
                  {ctx.edit || textStyle(ctx, "contactLabel").style ? <span {...inline(ctx, "contactLabel")} {...ph("Texte du bouton")}>{tr(props.contactLabel!, ctx.locale)}</span> : tr(props.contactLabel!, ctx.locale)}
                  <span aria-hidden="true">→</span>
                </ContactCta>
              )}
            </div>

            <div>
              {shown(props.socialEyebrow) && (
                <Eyebrow {...inline(ctx, "socialEyebrow")} {...ph("Étiquette")}>
                  {tr(props.socialEyebrow!, ctx.locale)}
                </Eyebrow>
              )}
              <ul className="mt-3 space-y-2" {...(ctx.edit ? { "data-edit-socials": "", "data-site-hint": "commun au site" } : {})}>
                {socials.map((s, i) => (
                  <li key={`${s.label}-${i}`} {...(ctx.edit ? { "data-social-index": i, "data-social-key": socialKeyList[i] } : {})}>
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
