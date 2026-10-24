"use client";

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
      toast("Enregistré · visible sur tout le site");
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
        <h2 id="s-partage">Partage et moteurs de recherche</h2>
        <p className="a-help">Ce qui s&apos;affiche quand quelqu&apos;un colle le lien de ton site (Instagram, messageries…) ou te cherche sur Google.</p>
        <div className="a-form-grid">
          <TextareaI18n
            label="Description du site"
            help="Une ou deux phrases, utilisées quand une page n'a pas la sienne."
            value={value.description}
            onChange={(description) => setValue((v) => ({ ...v, description }))}
            error={errorAt(errors, "description")}
          />
          <MediaPicker
            label="Image affichée quand on partage ton site"
            help="Utilisée quand une page n'a pas d'image à elle (sinon, la première image de la page). Une image large, d'environ 1200 × 630, rend le mieux."
            value={value.shareImage ?? undefined}
            onChange={(v) => setValue((s) => ({ ...s, shareImage: v ?? null }))}
            error={errors.shareImage}
            context={context}
          />
        </div>
        <div className="a-share-preview" aria-label="Aperçu d'un lien partagé" data-testid="share-preview">
          <p className="a-card-label">Voici comment ton lien apparaîtra</p>
          <div className="a-share-card">
            {share?.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={share.preview} alt="" />
            ) : (
              <span className="a-share-none muted">Pas d&apos;image : un lien partagé s&apos;affichera sans vignette.</span>
            )}
            <strong>{siteName}</strong>
            <span className="muted">{value.description.fr || "Ajoute une description pour qu'elle apparaisse ici."}</span>
          </div>
        </div>
      </section>
      <SaveBar dirty={dirty} saving={saving} onSave={save} error={error} />
    </form>
    <section className="a-panel" aria-labelledby="s-icone" data-testid="seo-icon">
      <h2 id="s-icone">Icône de l&apos;onglet</h2>
      <FaviconSetting initial={favicon} media={media} siteName={siteName} colors={colors} scope="reglages" />
    </section>
    </>
  );
}
