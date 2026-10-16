import { getTranslations } from "next-intl/server";
import { z } from "zod";

import CvPages from "@/components/CvPages";
import Eyebrow from "@/components/Eyebrow";
import { getMedia } from "@/lib/media";
import { downloadName } from "@/lib/pdf/limits";

import { FieldOps } from "./FieldOps";
import { hasText } from "./optional-fields";
import { inline, localized, localizedText, mediaRef, textStyle, tr, type BlockContext } from "./types";

export const cvSchema = z.object({
  /** PDF de la médiathèque (pages rendues en images à l'envoi). */
  mediaId: mediaRef.optional(),
  eyebrow: localized.optional(),
  title: localized.optional(),
  intro: localizedText.optional(),
  /** Texte du bouton (sinon « Télécharger mon CV »). */
  button: localized.optional(),
  /** Nom du fichier téléchargé, sans extension ([a-z0-9-], « cv » sinon). */
  fileName: z.string().max(60).regex(/^[a-z0-9-]*$/).optional(),
});

function sizeLabel(bytes: number, locale: string): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} ${locale === "fr" ? "Mo" : "MB"}`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} ${locale === "fr" ? "Ko" : "KB"}`;
}

/**
 * CV : les pages du PDF en images (lisibles, cliquables pour la visionneuse)
 * et un bouton bien visible qui télécharge le PDF d'origine (pièce jointe,
 * nom de fichier propre). Sur la toile : « Dépose ton CV (PDF) ici », puis
 * Remplacer au survol ou dépôt d'un PDF sur le bloc. Sans PDF prêt : rien en
 * public (publication refusée sans PDF, registre).
 */
export default async function CvBlock({ props, ctx }: { props: z.infer<typeof cvSchema>; ctx: BlockContext }) {
  const media = await getMedia(props.mediaId);
  const pdf = media?.pdf ?? null;
  if (!pdf && !ctx.edit) return null;
  const t = await getTranslations({ locale: ctx.locale, namespace: "cv" });
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  const title = props.title ? tr(props.title, ctx.locale) : "";
  const alt = media?.alt ? tr(media.alt, ctx.locale) : "";
  const button = (props.button && tr(props.button, ctx.locale)) || t("download");
  const href = pdf ? `${pdf.href}?name=${downloadName(props.fileName)}` : null;

  const shown = (v: { fr: string; en: string } | undefined) => v !== undefined && (ctx.edit ? true : hasText(v));
  const body = (
    <div className={ctx.edit ? "cv-block relative" : "cv-block"}>
      <FieldOps ctx={ctx} type="cv" props={props} />
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-2xl">
          {/* Étiquette, titre, présentation : des champs qui n'existent que s'ils ont été demandés (lot 27). */}
          {shown(props.eyebrow) && (
            <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
              {tr(props.eyebrow!, ctx.locale)}
            </Eyebrow>
          )}
          {shown(props.title) && (
            <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.25rem)] text-ink" {...inline(ctx, "title")} {...ph("Titre")}>
              {title}
            </h2>
          )}
          {shown(props.intro) && (
            <p className="mt-4 text-base leading-relaxed text-ink-soft" {...inline(ctx, "intro")} {...ph("Présentation")}>
              {tr(props.intro!, ctx.locale)}
            </p>
          )}
        </div>
        {href && pdf ? (
          <div className="flex flex-col items-start gap-2">
            {/* download : enregistrer plutôt que naviguer ; le serveur l'impose de toute façon (pièce jointe). */}
            <a className="btn cv-download" href={href} download={`${downloadName(props.fileName)}.pdf`} type="application/pdf">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {ctx.edit || textStyle(ctx, "button").style ? <span {...inline(ctx, "button")}>{button}</span> : button}
            </a>
            <span className="cv-download-meta">{t("pdf", { size: sizeLabel(pdf.size, ctx.locale) })}</span>
          </div>
        ) : null}
      </header>

      <div className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" {...(ctx.edit ? { "data-edit-media": "mediaId", "data-edit-media-kind": "pdf" } : {})}>
        {pdf ? (
          <CvPages
            pages={pdf.pages}
            alt={alt || title}
            texts={{ page: t.raw("page") as string, open: t.raw("open") as string, pages: t("pages") }}
          />
        ) : (
          <span className="pe-media-empty pe-media-pdf" lang="fr">
            <span>{media ? "Aperçu du PDF en préparation…" : "Dépose ton CV (PDF) ici"}</span>
            {!media && (
              <button type="button" className="pe-empty-action" data-edit-empty-media="mediaId">
                Choisir dans la médiathèque
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
  if (ctx.cell) return body;
  return <section className={ctx.edit ? "shell pt-[var(--section-gap)] pe-field-host" : "shell pt-[var(--section-gap)]"}>{body}</section>;
}
