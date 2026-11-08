/**
 * Formulaire de contact (bloc « contact-form », v0.13) : définition des champs
 * et validation d'un envoi. Module pur (zod) : bloc, route d'envoi
 * (src/app/api/contact/route.ts), éditeur et tests.
 *
 * L'envoi suit la définition PUBLIÉE : types, longueurs, nombre de champs,
 * liste de choix stricte, aucun champ inconnu. Pas de serveur d'envoi
 * d'e-mail configuré : les messages arrivent dans Admin → Messages.
 */
import { z } from "zod";

const Loc = (max: number) => z.object({ fr: z.string().max(max), en: z.string().max(max) });

export const FIELD_TYPES = ["text", "email", "textarea", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_LABELS: Record<FieldType, string> = { text: "Texte court", email: "E-mail", textarea: "Texte long", select: "Choix dans une liste" };
/** Longueur maximale d'une réponse, par type. */
export const FIELD_MAX: Record<FieldType, number> = { text: 200, email: 254, textarea: 4000, select: 120 };
export const MAX_FIELDS = 12;
/** Messages gardés au plus (au-delà, les envois sont refusés et l'admin prévient). */
export const MESSAGES_CAP = 2000;

export const FormFieldSchema = z.object({
  id: z.string().regex(/^f[a-z0-9]{1,12}$/),
  type: z.enum(FIELD_TYPES),
  label: Loc(120),
  placeholder: Loc(120).optional(),
  help: Loc(240).optional(),
  required: z.boolean().default(false),
  /** Liste de choix (type « select »). */
  options: z.array(Loc(120)).max(20).optional(),
  /** Champ e-mail qui sert à répondre (un seul). */
  reply: z.boolean().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const ContactFormSchema = z.object({
  /**
   * Identifiant public et STABLE du formulaire (envoi : POST /api/contact) :
   * donné à la création ou à la copie du bloc (tree.ts, withFreshUids), gardé
   * d'une publication à l'autre (l'id de ligne en base, lui, change).
   */
  formId: z.string().regex(/^[a-z0-9]{6,32}$/).optional(),
  eyebrow: Loc(200).optional(),
  title: Loc(200).optional(),
  intro: Loc(2000).optional(),
  fields: z
    .array(FormFieldSchema)
    .min(1)
    .max(MAX_FIELDS)
    .refine((f) => new Set(f.map((x) => x.id)).size === f.length, "Champs en double.")
    .refine((f) => f.filter((x) => x.reply).length <= 1, "Un seul champ sert à répondre."),
  submit: Loc(80),
  success: Loc(400),
  error: Loc(400),
  /** Objet des messages reçus (boîte Admin → Messages). */
  subject: Loc(160),
});
export type ContactForm = z.infer<typeof ContactFormSchema>;

/** Types de bloc qui peuvent porter un formulaire : « contact » (option formulaire) et l'ancien « contact-form » (lu seulement). */
export const FORM_BLOCK_TYPES = ["contact", "contact-form"] as const;

/** Ce bloc est-il un formulaire de contact ? « Contact » avec l'option formulaire, ou l'ancien « Formulaire de contact ». */
export function isFormBlock(type: string, props: unknown): boolean {
  if (type === "contact-form") return true;
  return type === "contact" && Boolean(props) && typeof props === "object" && (props as { form?: unknown }).form === true;
}

/** Identifiant public d'un formulaire neuf (stable : gardé d'une publication à l'autre). */
export function newFormId(): string {
  return `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`.replace(/[^a-z0-9]/g, "").slice(0, 32);
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;
/** Adresse en ASCII imprimable seulement : ni homoglyphe (« а » cyrillique), ni signe invisible (docs/SECURITE.md §2.12). */
const ASCII_EMAIL = /^[\x21-\x7e]+$/;
/** Caractères de format (`\p{Cf}` : contrôles bidirectionnels U+202E…, espaces de largeur nulle) retirés des valeurs. */
const FORMAT_CHARS = /\p{Cf}/gu;

let n = 0;
/** Identifiant d'un champ neuf. */
export const newFieldId = () => `f${Date.now().toString(36).slice(-6)}${(n++ % 36).toString(36)}`;

/** Champ neuf d'un type donné (éditeur). */
export function makeField(type: FieldType): FormField {
  const L = (fr: string, en: string) => ({ fr, en });
  const base = { id: newFieldId(), type, required: type === "email" || type === "textarea" };
  switch (type) {
    case "email":
      return { ...base, label: L("Ton e-mail", "Your email"), placeholder: L("nom@domaine.fr", "name@domain.com") };
    case "textarea":
      return { ...base, label: L("Ton message", "Your message") };
    case "select":
      return { ...base, label: L("Sujet", "Topic"), options: [L("Projet", "Project"), L("Autre", "Other")] };
    default:
      return { ...base, label: L("Ton nom", "Your name") };
  }
}

/** Réglages d'un formulaire neuf (registre). */
/**
 * Option formulaire d'un « Contact » (réglages après l'activation ou la désactivation). Activer garde l'identifiant
 * existant (`formId`) : les messages reçus restent rattachés au même formulaire ; désactiver garde les champs saisis
 * (réactiver les retrouve) et l'identifiant, sans effet tant que `form` n'est pas vrai.
 */
export function withContactForm(value: Record<string, unknown>, on: boolean): Record<string, unknown> {
  if (!on) return { ...value, form: false };
  const defaults: Record<string, unknown> = { ...defaultContactForm() };
  delete defaults.intro;
  delete defaults.title;
  const formId = typeof value.formId === "string" && value.formId ? value.formId : newFormId();
  return { ...defaults, ...value, form: true, formId };
}

export function defaultContactForm(): ContactForm {
  const name = makeField("text");
  const email = { ...makeField("email"), reply: true };
  const message = makeField("textarea");
  return {
    title: { fr: "Écris-moi", en: "Write to me" },
    intro: { fr: "", en: "" },
    fields: [
      { ...name, id: "fname" },
      { ...email, id: "femail" },
      { ...message, id: "fmessage" },
    ],
    submit: { fr: "Envoyer", en: "Send" },
    success: { fr: "Merci, ton message est bien arrivé. Je te réponds vite.", en: "Thank you, your message arrived. I'll reply soon." },
    error: { fr: "L'envoi n'a pas marché. Réessaie dans un instant.", en: "Sending failed. Please try again in a moment." },
    subject: { fr: "Message depuis le site", en: "Message from the site" },
  };
}

export type Submission = { ok: true; values: { id: string; label: string; value: string }[]; replyTo: string | null } | { ok: false; error: string; field?: string };

/**
 * Valide un envoi contre la définition publiée : un objet { id: texte }, pas
 * de champ inconnu, obligatoires remplis, longueurs et types respectés, choix
 * dans la liste. `locale` : langue des libellés enregistrés.
 */
export function validateSubmission(form: ContactForm, input: unknown, locale: "fr" | "en"): Submission {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Envoi invalide." };
  const raw = input as Record<string, unknown>;
  const ids = new Set(form.fields.map((f) => f.id));
  const unknown = Object.keys(raw).find((k) => !ids.has(k));
  if (unknown) return { ok: false, error: "Champ inconnu.", field: unknown.slice(0, 40) };
  const values: { id: string; label: string; value: string }[] = [];
  let replyTo: string | null = null;
  for (const f of form.fields) {
    const v = raw[f.id];
    if (v !== undefined && typeof v !== "string") return { ok: false, error: "Valeur invalide.", field: f.id };
    const value = (v ?? "").replace(FORMAT_CHARS, "").replace(/\r\n?/g, "\n").trim();
    if (!value) {
      if (f.required) return { ok: false, error: "Champ obligatoire.", field: f.id };
      continue;
    }
    if (value.length > FIELD_MAX[f.type]) return { ok: false, error: "Texte trop long.", field: f.id };
    if (f.type !== "textarea" && value.includes("\n")) return { ok: false, error: "Valeur invalide.", field: f.id };
    if (f.type === "email" && (!ASCII_EMAIL.test(value) || !EMAIL.test(value))) return { ok: false, error: "Adresse e-mail invalide.", field: f.id };
    if (f.type === "select" && !(f.options ?? []).some((o) => o.fr === value || o.en === value)) return { ok: false, error: "Choix invalide.", field: f.id };
    if (f.type === "email" && f.reply) replyTo = value;
    values.push({ id: f.id, label: f.label[locale] || f.label.fr, value });
  }
  if (!values.length) return { ok: false, error: "Formulaire vide." };
  return { ok: true, values, replyTo };
}

/**
 * Lot 125 : le bouton « Me contacter » ouvre le formulaire de contact interne.
 * Réglage par bouton (absent = « form », y compris pour les anciens boutons) : "form" = formulaire, "mail" = ancien comportement (mailto:).
 */
export const CONTACT_ACTIONS = ["form", "mail"] as const;
export type ContactAction = (typeof CONTACT_ACTIONS)[number];
export const ContactActionSchema = z.enum(CONTACT_ACTIONS);
export const CONTACT_ACTION_LABELS: Record<ContactAction, string> = { form: "Ouvrir le formulaire de contact", mail: "Ouvrir l'e-mail" };
/** Réglage effectif d'un bouton : tout ce qui n'est pas « mail » ouvre le formulaire. */
export const contactActionOf = (v: unknown): ContactAction => (v === "mail" ? "mail" : "form");

/**
 * Formulaire intégré, pour un site qui n'a AUCUN formulaire de contact publié : nom, e-mail (réponse), message.
 * Identifiant réservé, reconnu par POST /api/contact ; le message arrive dans Admin → Messages comme les autres.
 */
export const DEFAULT_FORM_ID = "contactdefaut";
export function builtinContactForm(): ContactForm {
  return { ...defaultContactForm(), formId: DEFAULT_FORM_ID, title: { fr: "Me contacter", en: "Get in touch" }, intro: undefined };
}
