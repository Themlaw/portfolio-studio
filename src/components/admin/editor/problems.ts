/**
 * Problèmes d'une publication refusée, dits dans la langue de l'interface (lot 24, lot 130b : traducteur `t` de l'espace `editorProblems`). `fieldErrors` du serveur est un dictionnaire
 * « chemin technique → message » (`blocks.2.props.children.0.props.title.fr`) ; l'éditeur en fait une liste dont chaque ligne
 * nomme la rubrique (ou le composant) et le champ, et sait vers quel bloc de la toile mener. Module pur : testé par node.
 */
import { blockAtPath, type TreeBlock } from "@/blocks/tree";
import type { AdminT } from "@/i18n/admin-lang";

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

/** Champs d'un composant, tels que les nomme l'éditeur : clés `field_<nom>` du catalogue. */
const FIELD_KEYS = new Set(["eyebrow", "title", "intro", "description", "paragraphs", "caption", "label", "cta", "button", "submit", "success", "error", "fields", "help", "statement", "scroll", "mediaId", "pageId", "project", "children", "more", "href", "url", "email", "alt", "name", "formId", "portraitCaption", "contactEyebrow", "contactLabel", "socialEyebrow", "reel", "look", "size", "layout", "edits"]);

/** Problèmes de la page elle-même (clés qui ne désignent pas un bloc) : clé `page_<clé>` du catalogue (le point devient « _ »). */
const PAGE_KINDS: Record<string, Problem["kind"]> = { collection: "page", accent: "form", "site.palette": "page", blocks: "page", slug: "form", title: "form" };

/** « title.fr » → « Titre (FR) » ; « paragraphs.0.fr » → « Paragraphe 1 (FR) » ; chemin inconnu → null. */
export function fieldLabel(rest: string, t: AdminT): string | null {
  const parts = rest.split(".").filter(Boolean);
  const out: string[] = [];
  let lang = "";
  for (const part of parts) {
    if (part === "fr" || part === "en") lang = part.toUpperCase();
    else if (/^\d+$/.test(part)) {
      if (out.length) out[out.length - 1] = t("withNumber", { label: out[out.length - 1], n: Number(part) + 1 });
    } else if (FIELD_KEYS.has(part)) out.push(t(`field_${part}`));
  }
  if (!out.length) return null;
  return lang ? t("withLang", { fields: out.join(", "), lang }) : out.join(", ");
}

/**
 * Liste des problèmes, dans l'ordre de la page (rubriques d'abord, puis la page et le site).
 * `labelOf` : nom d'un type de bloc pour l'artiste (« Texte », « Grille »…).
 */
export function describeProblems(blocks: TreeBlock[], errors: Record<string, string>, labelOf: (type: string) => string, t: AdminT): Problem[] {
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
          ? t("whereBlock", { n: top + 1, label: labelOf(block.type) })
          : t("whereChild", { label: labelOf(block.type), n: top + 1, parent: labelOf(parent.type) });
      const uid = typeof (block as { uid?: unknown }).uid === "string" ? ((block as { uid: string }).uid) : null;
      out.push({ key, uid, where, field: m[3] ? fieldLabel(m[3], t) : null, message, kind: "block", order: [top, ...idx] });
      continue;
    }
    const pageKind = Object.hasOwn(PAGE_KINDS, key) ? PAGE_KINDS[key] : null;
    out.push({ key, uid: null, where: t("wherePage"), field: pageKind ? t(`page_${key.replace(".", "_")}`) : null, message, kind: pageKind ?? "page", order: [Number.MAX_SAFE_INTEGER] });
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
