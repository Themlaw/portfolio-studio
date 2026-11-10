"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { errorAt, MediaPicker, TextareaI18n } from "@/app/admin/_fields";
import { saveSeoAction } from "@/app/admin/(espace)/reglages/actions";
import type { EditorContext } from "@/blocks/editor-types";
import type { AdminMediaRow } from "@/lib/admin";
import type { FaviconInput, MonoColorKey } from "@/lib/favicon-spec";
import type { SeoInput } from "@/lib/seo-schema";

import FaviconSetting from "./FaviconSetting";
import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";

/**
 * « Partage et moteurs de recherche » (lot 52) : la description du site, l'image qui s'affiche quand on colle ton lien
 * (réseaux, messageries) et l'icône de l'onglet. Un enregistrement met en ligne aussitôt, comme le reste des réglages.
 */
export default function SeoForm({
  initial,
  media,
  siteName,
  favicon,
  colors,
}: {
  initial: SeoInput;
  media: AdminMediaRow[];
  siteName: string;
  /** Icône de l'onglet (lot 83) : le même réglage que dans l'étape « Logo » de l'éditeur de thème. */
  favicon: FaviconInput;
  colors: Record<MonoColorKey, string>;
}) {
  const router = useRouter();
  const t = useTranslations("seo");
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const dirty = !same(value, saved);
  useUnsavedGuard(dirty);
  const context = { media: media.filter((m) => m.status === "ready") } as unknown as EditorContext;
  const share = media.find((m) => m.id === value.shareImage);

  const save = () =>
    start(async () => {
      const result = await saveSeoAction(value);
      if (!result.ok) {
        setError(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setError(null);
      setErrors({});
      setSaved(clone(value));
      toast(t("saved"));
      setTimeout(() => router.refresh(), 0);
    });

  return (
    <>
    <form
      className="a-form"
      data-testid="seo-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="a-panel" aria-labelledby="s-partage">
        <h2 id="s-partage">{t("shareTitle")}</h2>
        <p className="a-help">{t("shareIntro")}</p>
        <div className="a-form-grid">
          <TextareaI18n
            label={t("description")}
            help={t("descriptionHelp")}
            value={value.description}
            onChange={(description) => setValue((v) => ({ ...v, description }))}
            error={errorAt(errors, "description")}
          />
          <MediaPicker
            label={t("shareImage")}
            help={t("shareImageHelp")}
            value={value.shareImage ?? undefined}
            onChange={(v) => setValue((s) => ({ ...s, shareImage: v ?? null }))}
            error={errors.shareImage}
            context={context}
          />
        </div>
        <div className="a-share-preview" aria-label={t("previewLabel")} data-testid="share-preview">
          <p className="a-card-label">{t("previewTitle")}</p>
          <div className="a-share-card">
            {share?.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={share.preview} alt="" />
            ) : (
              <span className="a-share-none muted">{t("noImage")}</span>
            )}
            <strong>{siteName}</strong>
            <span className="muted">{value.description.fr || t("addDescription")}</span>
          </div>
        </div>
      </section>
      <SaveBar dirty={dirty} saving={saving} onSave={save} error={error} />
    </form>
    <section className="a-panel" aria-labelledby="s-icone" data-testid="seo-icon">
      <h2 id="s-icone">{t("iconTitle")}</h2>
      <FaviconSetting initial={favicon} media={media} siteName={siteName} colors={colors} scope="reglages" />
    </section>
    </>
  );
}
