import ContactForm from "@/components/ContactForm";
import Eyebrow from "@/components/Eyebrow";
import { ContactFormSchema } from "@/lib/contact-form";

import { FieldOps } from "./FieldOps";
import { hasText } from "./optional-fields";
import { inline, textStyle, tr, type BlockContext } from "./types";

export const contactFormSchema = ContactFormSchema;

/**
 * Formulaire de contact (v0.13). Rendu serveur des textes ; le formulaire
 * lui-même est un composant client qui ne reçoit QUE ce qu'il affiche
 * (libellés, types, choix) : ni objet, ni réglage d'envoi. L'envoi passe par
 * POST /api/contact, validé contre la version PUBLIÉE du bloc (`formId` stable).
 * Sur la toile : textes modifiables en place, envoi impossible.
 */
export default function ContactFormBlock({ props, ctx }: { props: ReturnType<typeof ContactFormSchema.parse>; ctx: BlockContext }) {
  const L = (v: { fr: string; en: string } | undefined) => (v ? tr(v, ctx.locale) : "");
  // Un champ vide n'occupe aucune place en public ; sur la toile, un champ présent reste saisissable (lot 27).
  const shown = (v: { fr: string; en: string } | undefined) => v !== undefined && (ctx.edit ? true : hasText(v));
  const hasHead = shown(props.eyebrow) || shown(props.title) || shown(props.intro);
  return (
    <section className={ctx.edit ? "shell pt-[var(--section-gap)] pe-field-host" : "shell pt-[var(--section-gap)]"}>
      <div className={`contact-form rounded-lg border border-line bg-surface px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2.5rem,6vw,4.5rem)] shadow-card${ctx.edit ? " relative" : ""}`}>
        <FieldOps ctx={ctx} type="contact" props={{ ...props, form: true }} skip={["cta"]} />
        {hasHead && (
          <div className="max-w-xl">
            {shown(props.eyebrow) && (
              <Eyebrow {...inline(ctx, "eyebrow")} {...(ctx.edit ? { "data-placeholder": "Étiquette" } : {})}>
                {L(props.eyebrow)}
              </Eyebrow>
            )}
            {shown(props.title) && (
              <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...inline(ctx, "title")} {...(ctx.edit ? { "data-placeholder": "Titre" } : {})}>
                {L(props.title)}
              </h2>
            )}
            {shown(props.intro) && (
              <p className="mt-5 text-sm leading-relaxed text-ink-soft" {...inline(ctx, "intro")} {...(ctx.edit ? { "data-placeholder": "Présentation" } : {})}>
                {L(props.intro)}
              </p>
            )}
          </div>
        )}
        <ContactForm
          formId={!ctx.edit ? (props.formId ?? null) : null}
          locale={ctx.locale}
          edit={Boolean(ctx.edit)}
          fields={props.fields.map((f) => ({
            id: f.id,
            type: f.type,
            label: L(f.label),
            placeholder: L(f.placeholder),
            help: L(f.help),
            required: f.required,
            reply: Boolean(f.reply),
            options: (f.options ?? []).map((o) => ({ value: o.fr, label: L(o) })),
          }))}
          texts={{ submit: L(props.submit), success: L(props.success), error: L(props.error) }}
          // Barre typographique (lot 2) : styles locaux des libellés et du bouton, rendus par le composant client.
          styles={Object.fromEntries(
            [...props.fields.map((_, i) => `fields.${i}.label`), "submit", "success", "error"].flatMap((p) => {
              const st = textStyle(ctx, p).style;
              return st ? [[p, st]] : [];
            }),
          )}
        />
      </div>
    </section>
  );
}
