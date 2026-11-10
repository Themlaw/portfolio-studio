"use client";

/**
 * Étape 5 « Logo » (lot 61) : le logo du thème (`assets.kit.signature`), vu sur fond clair ET sur fond foncé, avec le choix
 * « Garder mes couleurs » (par défaut, même pour un logo d'une seule couleur) ou « Prendre la couleur du texte ».
 *
 * Deux façons de l'avoir : importer une image (envoyée à la médiathèque par la file d'envoi commune, puis copiée comme logo du
 * thème : importThemeLogoAction) ou le dessiner dans Photoshop (kit). Rien n'est écrit avant « Enregistrer ».
 * « Prendre la couleur du texte » = on retire `colors` : variants.css rend la même image en masque teinté. Un logo déjà enregistré
 * garde son réglage d'origine (sans `colors` : teinté), seul un clic ici le change.
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

import { mediaStatusAction } from "@/app/admin/(espace)/medias/actions";
import { importThemeLogoAction } from "@/app/admin/(espace)/themes/actions";
import { luminance } from "@/themes/contrast";
import { resolvePalette } from "@/themes/palette";
import type { KitAssets, KitImage, Theme } from "@/themes/schema";

import CursorSettings from "../CursorSettings";
import { toast } from "../editing";
import { sendFile } from "../uploads";
import { Advanced } from "./controls";

const ACCEPT = "image/png,image/webp,image/jpeg,image/avif,image/gif";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Le logo sur un fond : image telle quelle (`colors`) ou forme teintée par la couleur du texte. */
function LogoSample({ logo, ground, ink, tinted, tone, label }: { logo: KitImage; ground: string; ink: string; tinted: boolean; tone: "light" | "dark"; label: string }) {
  const t = useTranslations("guide");
  const url = logo.svg ?? logo.webp ?? logo.avif;
  return (
    <figure className="a-logo-tile" data-tone={tone} style={{ background: ground }}>
      <span
        className="a-logo-sample"
        role="img"
        aria-label={t("logoOn", { label })}
        data-testid={`logo-sample-${tone}`}
        data-tinted={tinted}
        style={
          tinted
            ? { aspectRatio: `${logo.w} / ${logo.h}`, backgroundColor: ink, WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")` }
            : { aspectRatio: `${logo.w} / ${logo.h}`, backgroundImage: `url("${url}")` }
        }
      />
      <figcaption style={{ color: ink }}>{label}</figcaption>
    </figure>
  );
}

export default function LogoStep({
  theme,
  themeId,
  onKit,
  locked,
  favicon,
}: {
  theme: Theme;
  themeId: string;
  onKit: (kit: KitAssets) => void;
  /** Icône de l'onglet (lot 83) : le MÊME composant et le même réglage de site que Réglages → Référencement, rendu par le serveur. */
  favicon?: ReactNode;
  /** Thème livré : lecture seule (message et copie proposés par l'éditeur). */
  locked: ReactNode | null;
}) {
  const t = useTranslations("guide");
  const kit = theme.assets.kit ?? {};
  const logo = kit.signature;
  const tinted = logo ? logo.colors !== true : false;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Fonds de démonstration : le plus clair et le plus foncé des deux couleurs du thème (le texte prend l'autre).
  const p = resolvePalette(theme.tokens.color, theme.tokens.palette);
  const [light, dark] = luminance(p.bg) >= luminance(p.ink) ? [p.bg, p.ink] : [p.ink, p.bg];

  const setLogo = (next: KitImage | undefined) => {
    const k: KitAssets = { ...kit };
    if (next) k.signature = next;
    else delete k.signature;
    onKit(k);
  };

  const importImage = async (file: File) => {
    setBusy(t("sendingImage"));
    try {
      const up = await sendFile(file, () => undefined);
      if (!up.ok) return toast(up.message, "error");
      setBusy(t("preparingImage"));
      let ready = false;
      for (let i = 0; i < 300; i++) {
        const st = await mediaStatusAction([up.media.id]);
        const row = st.ok ? st.data[0] : undefined;
        if (row?.status === "ready") {
          ready = true;
          break;
        }
        if (!row || row.status === "failed") break;
        await sleep(700);
      }
      if (!ready) return toast(t("imageFailed", { name: file.name.slice(0, 60) }), "error");
      const res = await importThemeLogoAction(up.media.id);
      if (!res.ok) return toast(res.message, "error");
      setLogo(res.data.signature);
      toast(t("logoImported"));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <p className="a-help a-step-intro">{t("logoIntro")}</p>
      {locked}
      {!locked && (
        <>
          <div className="a-logo-tiles" data-testid="logo-preview">
            {logo ? (
              <>
                <LogoSample logo={logo} ground={light} ink={dark} tinted={tinted} tone="light" label={t("lightGround")} />
                <LogoSample logo={logo} ground={dark} ink={light} tinted={tinted} tone="dark" label={t("darkGround")} />
              </>
            ) : (
              <p className="a-help" data-testid="logo-none">
                {t("noLogo")}
              </p>
            )}
          </div>
          <div className="a-logo-actions">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              data-testid="logo-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importImage(f);
              }}
            />
            <button type="button" className="a-btn" onClick={() => fileRef.current?.click()} disabled={busy !== null} data-testid="logo-import">
              {busy ?? (logo ? t("replaceImage") : t("importImage"))}
            </button>
            <Link className="a-btn a-btn-quiet" href={`/admin/themes/${encodeURIComponent(themeId)}/kit`} data-testid="logo-kit">
              {t("drawInPhotoshop")}
            </Link>
            {logo && (
              <button type="button" className="a-btn a-btn-quiet" onClick={() => setLogo(undefined)} data-testid="logo-remove">
                {t("removeLogo")}
              </button>
            )}
          </div>
          <p className="a-help">{t("logoFormatHelp")}</p>
          {logo && (
            <fieldset className="a-fieldset a-logo-colors" data-testid="logo-colors">
              <legend>{t("logoColors")}</legend>
              <label className="a-logo-choice">
                <input type="radio" name="logo-colors" checked={!tinted} onChange={() => setLogo({ ...logo, colors: true })} data-testid="logo-keep" />
                <span>
                  <strong>{t("keepColors")}</strong>
                  <small>{t("keepColorsHelp")}</small>
                </span>
              </label>
              <label className="a-logo-choice">
                <input
                  type="radio"
                  name="logo-colors"
                  checked={tinted}
                  onChange={() => {
                    const next = { ...logo };
                    delete next.colors;
                    setLogo(next);
                  }}
                  data-testid="logo-tint"
                />
                <span>
                  <strong>{t("useTextColor")}</strong>
                  <small>{t("useTextColorHelp")}</small>
                </span>
              </label>
              {tinted && <p className="a-help">{t("lostColors")}</p>}
            </fieldset>
          )}
        </>
      )}
      {favicon && (
        <section className="a-guide-block a-fav-block" data-testid="logo-favicon" aria-label={t("tabIcon")}>
          {favicon}
        </section>
      )}
      {!locked && (
        <Advanced id="logo" count={kit.cursors?.off ? 1 : 0} hint={t("cursorHint")}>
          <CursorSettings theme={theme} onChange={onKit} />
        </Advanced>
      )}
    </>
  );
}
