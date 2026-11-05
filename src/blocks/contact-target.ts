import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { builtinContactForm, ContactFormSchema, FORM_BLOCK_TYPES, isFormBlock, type ContactForm } from "@/lib/contact-form";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

import { tr, type BlockContext } from "./types";

/** Identifiant d'ancre du bloc formulaire (lot 125) : le bouton « Me contacter » défile jusqu'à lui. */
export const formAnchor = (formId: string) => `formulaire-${formId}`;

/** Ce que le client reçoit pour la fenêtre : uniquement ce qu'elle affiche (comme ContactFormBlock). */
export type ModalForm = {
  formId: string;
  title: string;
  fields: {
    id: string;
    type: "text" | "email" | "textarea" | "select";
    label: string;
    placeholder: string;
    help: string;
    hasHelp: boolean;
    required: boolean;
    reply: boolean;
    options: { value: string; label: string }[];
  }[];
  texts: { submit: string; success: string; error: string };
};

export type ContactTarget = { mode: "scroll"; anchor: string | null } | { mode: "modal"; form: ModalForm };

function modalForm(form: ContactForm, locale: BlockContext["locale"]): ModalForm {
  const L = (v: { fr: string; en: string } | undefined) => (v ? tr(v, locale) : "");
  return {
    formId: form.formId ?? "",
    title: L(form.title) || (locale === "en" ? "Get in touch" : "Me contacter"),
    fields: form.fields.map((f) => ({
      id: f.id,
      type: f.type,
      label: L(f.label),
      placeholder: L(f.placeholder),
      help: L(f.help),
      hasHelp: f.help !== undefined,
      required: f.required,
      reply: Boolean(f.reply),
      options: (f.options ?? []).map((o) => ({ value: o.fr, label: L(o) })),
    })),
    texts: { submit: L(form.submit), success: L(form.success), error: L(form.error) },
  };
}

/**
 * Où mène un bouton « Me contacter » réglé sur « formulaire » :
 *  1. la page porte déjà un bloc formulaire (niveau page) : on défile jusqu'à lui (pas de doublon) ;
 *  2. sinon le formulaire PUBLIÉ du site (le premier, dans l'ordre des pages) s'ouvre dans une fenêtre : mêmes champs, mêmes messages ;
 *  3. sinon le formulaire intégré (nom, e-mail, message).
 */
export async function contactTarget(ctx: BlockContext): Promise<ContactTarget> {
  for (const b of ctx.pageBlocks ?? []) {
    if (!isFormBlock(b.type, b.props)) continue;
    const form = ContactFormSchema.safeParse(b.props);
    if (form.success) return { mode: "scroll", anchor: form.data.formId ? formAnchor(form.data.formId) : null };
  }
  const rows = getDb()
    .select({ type: schema.blocks.type, props: schema.blocks.props })
    .from(schema.blocks)
    .innerJoin(schema.pages, eq(schema.blocks.pageId, schema.pages.id))
    .where(and(inArray(schema.blocks.type, [...FORM_BLOCK_TYPES]), eq(schema.pages.published, true), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.id), asc(schema.blocks.position))
    .all();
  for (const row of rows) {
    const props = parseJson(row.props);
    if (!isFormBlock(row.type, props)) continue;
    const form = ContactFormSchema.safeParse(props);
    if (form.success && form.data.formId) return { mode: "modal", form: modalForm(form.data, ctx.locale) };
  }
  return { mode: "modal", form: modalForm(builtinContactForm(), ctx.locale) };
}
