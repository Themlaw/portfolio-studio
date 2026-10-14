/**
 * Problèmes d'une publication refusée, dits en français (lot 24). `fieldErrors` du serveur est un dictionnaire
 * « chemin technique → message » (`blocks.2.props.children.0.props.title.fr`) ; l'éditeur en fait une liste dont chaque ligne
 * nomme la rubrique (ou le composant) et le champ, et sait vers quel bloc de la toile mener. Module pur : testé par node.
 */
import { blockAtPath, type TreeBlock } from "@/blocks/tree";

export type Problem = {
  /** Chemin technique d'origine (clé stable). */
  key: string;
  /** Bloc de la toile à choisir et à montrer ; null = problème de la page ou du site. */
  uid: string | null;
  /** « Rubrique n° 3 « Texte » », ou « Composant « Image » de la rubrique n° 2 « Grille » ». */
  where: string;
  /** Champ concerné (« Titre (FR) »), s'il est connu. */
  field: string | null;
  message: string;
  /** Où mène la ligne : la rubrique, les réglages de la page, ou le formulaire de la page. */
  kind: "block" | "page" | "form";
};

/** Champs d'un composant, tels que les nomme l'éditeur. */
const FIELD_LABELS: Record<string, string> = {
  eyebrow: "Étiquette",
  title: "Titre",
  intro: "Présentation",
  description: "Description",
  paragraphs: "Paragraphe",
  caption: "Légende",
  label: "Libellé",
  cta: "Bouton",
  button: "Bouton",
  submit: "Bouton d'envoi",
  success: "Message de confirmation",
  error: "Message d'erreur",
  fields: "Champ",
  help: "Aide",
  statement: "Accroche",
  scroll: "Texte « Faire défiler »",
  mediaId: "Média",
  pageId: "Page de destination",
  project: "Projet",
  children: "Composant",
  more: "Lien",
  href: "Adresse",
  url: "Adresse",
  email: "Adresse e-mail",
  alt: "Texte alternatif",
  name: "Nom",
  formId: "Formulaire",
  portraitCaption: "Légende du portrait",
  contactEyebrow: "Étiquette du contact",
  contactLabel: "Texte du contact",
  socialEyebrow: "Étiquette des réseaux",
  reel: "Bande d'images",
  look: "Mise en page",
  size: "Taille",
  layout: "Agencement",
  edits: "Entrées",
};

/** Problèmes de la page elle-même (clés qui ne désignent pas un bloc). */
const PAGE_LABELS: Record<string, { field: string; kind: Problem["kind"] }> = {
  collection: { field: "Collection de la page", kind: "page" },
  accent: { field: "Couleur d'accent de la page", kind: "form" },
  "site.palette": { field: "Couleurs du site", kind: "page" },
  blocks: { field: "Structure de la page", kind: "page" },
  slug: { field: "Adresse de la page", kind: "form" },
  title: { field: "Titre de la page", kind: "form" },
};

/** « title.fr » → « Titre (FR) » ; « paragraphs.0.fr » → « Paragraphe 1 (FR) » ; chemin inconnu → null. */
export function fieldLabel(rest: string): string | null {
  const parts = rest.split(".").filter(Boolean);
  const out: string[] = [];
  let lang = "";
  for (const part of parts) {
    if (part === "fr" || part === "en") lang = part.toUpperCase();
    else if (/^\d+$/.test(part)) {
      if (out.length) out[out.length - 1] += ` ${Number(part) + 1}`;
    } else if (Object.hasOwn(FIELD_LABELS, part)) out.push(FIELD_LABELS[part]);
  }
  if (!out.length) return null;
  return `${out.join(", ")}${lang ? ` (${lang})` : ""}`;
}

/**
 * Liste des problèmes, dans l'ordre de la page (rubriques d'abord, puis la page et le site).
 * `labelOf` : nom d'un type de bloc pour l'artiste (« Texte », « Grille »…).
 */
export function describeProblems(blocks: TreeBlock[], errors: Record<string, string>, labelOf: (type: string) => string): Problem[] {
  const out: (Problem & { order: number[] })[] = [];
  for (const [key, message] of Object.entries(errors)) {
    const m = /^blocks\.(\d+)((?:\.props\.children\.\d+){0,2})(?:\.props\.(.*))?/.exec(key);
    const block = m ? blockAtPath(blocks, key) : null;
    if (m && block) {
      const top = Number(m[1]);
      const idx = (m[2].match(/\d+/g) ?? []).map(Number);
      const parent = blocks[top];
      const where =
        idx.length === 0
          ? `Rubrique n° ${top + 1} « ${labelOf(block.type)} »`
          : `Composant « ${labelOf(block.type)} » de la rubrique n° ${top + 1} « ${labelOf(parent.type)} »`;
      const uid = typeof (block as { uid?: unknown }).uid === "string" ? ((block as { uid: string }).uid) : null;
      out.push({ key, uid, where, field: m[3] ? fieldLabel(m[3]) : null, message, kind: "block", order: [top, ...idx] });
      continue;
    }
    const page = Object.hasOwn(PAGE_LABELS, key) ? PAGE_LABELS[key] : null;
    out.push({ key, uid: null, where: "Page", field: page?.field ?? null, message, kind: page?.kind ?? "page", order: [Number.MAX_SAFE_INTEGER] });
  }
  out.sort((a, b) => {
    for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
      const d = (a.order[i] ?? -1) - (b.order[i] ?? -1);
      if (d) return d;
    }
    return 0;
  });
  return out.map((p) => ({ key: p.key, uid: p.uid, where: p.where, field: p.field, message: p.message, kind: p.kind }));
}
