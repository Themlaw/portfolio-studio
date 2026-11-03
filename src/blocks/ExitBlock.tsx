import { getTranslations } from "next-intl/server";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { hrefForPage } from "@/lib/pages";

import RandomPick from "./RandomPick";
import { inline, localized, localizedText, pageRef, type BlockContext } from "./types";

export const exitSchema = z.object({
  /** Étiquette au-dessus du titre (« Erreur 404 ») : un champ qui n'existe que s'il a été gardé. */
  eyebrow: localized.optional(),
  title: localized,
  /** Un ou plusieurs messages : un seul est tiré à chaque visite. */
  messages: z.array(localizedText).min(1).max(12),
  /** Libellé du bouton. */
  label: localized,
  /** Destination du bouton ; absente = l'accueil. */
  pageId: pageRef.optional(),
});

/** Texte d'une langue, ou `fallback` (le texte par défaut DE CETTE LANGUE) quand il est vide. */
export function textOr(value: { fr: string; en: string } | undefined, locale: AppLocale, fallback: string): string {
  const text = value?.[locale]?.trim();
  return text ? value![locale] : fallback;
}

/**
 * Bloc « Sortie » (lot 89) : ce qui ramène le visiteur sur le site depuis la page « Page introuvable » (titre, message, bouton).
 * Réservé à cette page, non supprimable (le registre le verrouille, l'éditeur et le serveur le refusent), toujours présent : sans lui, la
 * page ajoute elle-même un bouton « Retour à l'accueil » (src/app/[locale]/[[...slug]]/page.tsx).
 *
 * Même balisage que l'ancienne `NotFoundView` : avec les textes d'origine et un seul message, le rendu public est identique au pixel.
 * Un texte vide reprend le texte par défaut de la langue (messages/*.json, clé `notFound`). Plusieurs messages : un seul est montré,
 * tiré à chaque visite par le navigateur (RandomPick, la page est en cache) ; sur la toile ils sont tous visibles et modifiables.
 */
export default async function ExitBlock({ props, ctx }: { props: z.infer<typeof exitSchema>; ctx: BlockContext }) {
  const t = await getTranslations({ locale: ctx.locale, namespace: "notFound" });
  const href = await hrefForPage(props.pageId, ctx.locale);
  const eyebrow = props.eyebrow ? textOr(props.eyebrow, ctx.locale, t("eyebrow")) : null;
  const title = textOr(props.title, ctx.locale, t("title"));
  const label = textOr(props.label, ctx.locale, t("back"));
  const spoken = props.messages.map((m) => textOr(m, ctx.locale, "")).filter(Boolean);
  const messages = spoken.length ? spoken : [t("body")];
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  // Premier bloc de la page : sous l'espace du haut de page (comme l'ancienne 404) ; ailleurs, un espace de rubrique.
  const first = (ctx.pageBlocks?.[0]?.type ?? "exit") === "exit";
  const body = (text: string, i: number) => (
    <p key={i} className="mt-6 text-base leading-relaxed text-ink-soft" {...inline(ctx, `messages.${i}`)} {...ph(t("body"))}>
      {text}
    </p>
  );
  return (
    <section className={first ? "page-top shell" : "shell pt-[var(--section-gap)]"}>
      <div className="max-w-2xl">
        {eyebrow !== null && (
          <Eyebrow {...inline(ctx, "eyebrow")} {...ph(t("eyebrow"))}>
            {ctx.edit ? (props.eyebrow?.[ctx.locale] ?? "") : eyebrow}
          </Eyebrow>
        )}
        <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink" {...inline(ctx, "title")} {...ph(t("title"))}>
          {ctx.edit ? props.title[ctx.locale] : title}
        </h1>
        {ctx.edit ? (
          props.messages.map((m, i) => body(m[ctx.locale], i))
        ) : messages.length === 1 ? (
          body(messages[0], 0)
        ) : (
          <RandomPick>{messages.map((m, i) => body(m, i))}</RandomPick>
        )}
        <Link href={href} className="btn mt-10">
          {/* Public : le texte nu, comme l'ancienne 404 (parité au pixel) ; sur la toile, un repère de texte modifiable en place. */}
          {ctx.edit ? (
            <span {...inline(ctx, "label")} {...ph(t("back"))}>
              {props.label[ctx.locale]}
            </span>
          ) : (
            label
          )}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
