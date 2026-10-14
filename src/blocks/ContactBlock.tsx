import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { ContactFormSchema } from "@/lib/contact-form";
import { getSiteView } from "@/lib/settings";

import ContactFormBlock from "./ContactFormBlock";
import { EmptyHint, FieldOps } from "./FieldOps";
import { hasText } from "./optional-fields";
import { inline, localized, tr, type BlockContext, localizedText } from "./types";

const F = ContactFormSchema.shape;

/**
 * Contact (v0.20, lot 27) : une invitation à t'écrire — un bouton vers ton e-mail — ou, avec l'option « formulaire »
 * (`form: true`), un formulaire dont les messages arrivent dans Admin → Messages. Un « Contact » avec formulaire
 * porte à plat les réglages de l'ancien « Formulaire de contact » (formId, fields, submit, success, error, subject).
 * Chaque texte est facultatif : sans sa clé, il n'occupe aucune place (sur la toile : « + Ajouter … »).
 */
export const contactSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  intro: localizedText.optional(),
  /** Texte du bouton e-mail (absent : pas de bouton). Sans objet avec le formulaire. */
  cta: localized.optional(),
  /** Option formulaire. */
  form: z.boolean().optional(),
  formId: F.formId,
  fields: F.fields.optional(),
  submit: F.submit.optional(),
  success: F.success.optional(),
  error: F.error.optional(),
  subject: F.subject.optional(),
});

export default async function ContactBlock({ props, ctx }: { props: z.infer<typeof contactSchema>; ctx: BlockContext }) {
  if (props.form === true) {
    const form = ContactFormSchema.safeParse(props);
    if (!form.success) {
      console.error("[blocks] Contact avec formulaire invalide :", form.error.issues[0]?.message);
      return null;
    }
    return <ContactFormBlock props={form.data} ctx={ctx} />;
  }
  const { site } = await getSiteView(ctx.locale, ctx.pageId);
  // Un champ vide n'occupe aucune place en public ; sur la toile, un champ présent reste saisissable.
  const shown = (v: { fr: string; en: string } | undefined) => v !== undefined && (ctx.edit ? true : hasText(v));
  const eyebrow = shown(props.eyebrow);
  const title = shown(props.title);
  const intro = shown(props.intro);
  const cta = shown(props.cta);
  const nothing = props.eyebrow === undefined && props.title === undefined && props.intro === undefined && props.cta === undefined;
  if (!ctx.edit && !eyebrow && !title && !intro && !cta) return null;
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  return (
    <section className={ctx.edit ? "shell pt-[var(--section-gap)] pe-field-host" : "shell pt-[var(--section-gap)]"}>
      <div
        className={
          ctx.edit
            ? "rounded-lg border border-line bg-surface px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2.5rem,6vw,4.5rem)] text-center shadow-card relative"
            : "rounded-lg border border-line bg-surface px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2.5rem,6vw,4.5rem)] text-center shadow-card"
        }
      >
        <FieldOps ctx={ctx} type="contact" props={props} />
        {nothing && ctx.edit && (
          <EmptyHint text="Ce contact est vide : ajoute ce que tu veux montrer." actions={[["title", "+ Ajouter un titre"], ["intro", "+ Ajouter une présentation"], ["cta", "+ Ajouter un bouton e-mail"]]} />
        )}
        {eyebrow && <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>{tr(props.eyebrow!, ctx.locale)}</Eyebrow>}
        {title && (
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...inline(ctx, "title")} {...ph("Titre")}>
            {tr(props.title!, ctx.locale)}
          </h2>
        )}
        {intro && (
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-ink-soft" {...inline(ctx, "intro")} {...ph("Présentation")}>
            {tr(props.intro!, ctx.locale)}
          </p>
        )}
        {cta && (
          <a className="btn mt-8" href={`mailto:${site.email}`}>
            {/* Enveloppé seulement en édition : le HTML public ne change pas. */}
            {ctx.edit ? <span {...inline(ctx, "cta")} {...ph("Texte du bouton")}>{tr(props.cta!, ctx.locale)}</span> : tr(props.cta!, ctx.locale)}
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    </section>
  );
}
