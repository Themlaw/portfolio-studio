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
  const url = logo.svg ?? logo.webp ?? logo.avif;
  return (
    <figure className="a-logo-tile" data-tone={tone} style={{ background: ground }}>
      <span
        className="a-logo-sample"
        role="img"
        aria-label={`Ton logo sur un ${label}`}
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
    setBusy("Envoi de l'image…");
    try {
      const up = await sendFile(file, () => undefined);
      if (!up.ok) return toast(up.message, "error");
      setBusy("Préparation de l'image…");
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
      if (!ready) return toast(`« ${file.name.slice(0, 60)} » : l'image n'a pas pu être préparée.`, "error");
      const res = await importThemeLogoAction(up.media.id);
      if (!res.ok) return toast(res.message, "error");
      setLogo(res.data.signature);
      toast("Logo importé : il garde ses couleurs. Enregistre pour le garder.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <p className="a-help a-step-intro">Ton logo remplace ton nom écrit en haut à gauche de toutes les pages.</p>
      {locked}
      {!locked && (
        <>
          <div className="a-logo-tiles" data-testid="logo-preview">
            {logo ? (
              <>
                <LogoSample logo={logo} ground={light} ink={dark} tinted={tinted} tone="light" label="fond clair" />
                <LogoSample logo={logo} ground={dark} ink={light} tinted={tinted} tone="dark" label="fond foncé" />
              </>
            ) : (
              <p className="a-help" data-testid="logo-none">
                Pas de logo pour l&apos;instant : ton nom est écrit en texte dans l&apos;en-tête. Importe une image, ou dessine ton logo dans Photoshop.
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
              {busy ?? (logo ? "Remplacer par une image…" : "Importer une image…")}
            </button>
            <Link className="a-btn a-btn-quiet" href={`/admin/themes/${encodeURIComponent(themeId)}/kit`} data-testid="logo-kit">
              Le dessiner dans Photoshop → ouvrir le kit
            </Link>
            {logo && (
              <button type="button" className="a-btn a-btn-quiet" onClick={() => setLogo(undefined)} data-testid="logo-remove">
                Retirer le logo (revenir au nom écrit)
              </button>
            )}
          </div>
          <p className="a-help">PNG ou WebP sur fond transparent, rogné au plus près du dessin : c&apos;est ce qui rend le mieux.</p>
          {logo && (
            <fieldset className="a-fieldset a-logo-colors" data-testid="logo-colors">
              <legend>Couleurs du logo</legend>
              <label className="a-logo-choice">
                <input type="radio" name="logo-colors" checked={!tinted} onChange={() => setLogo({ ...logo, colors: true })} data-testid="logo-keep" />
                <span>
                  <strong>Garder mes couleurs</strong>
                  <small>Le logo est montré tel qu&apos;il a été dessiné ou importé.</small>
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
                  <strong>Prendre la couleur du texte</strong>
                  <small>Seule la forme est gardée : le logo s&apos;écrit comme ton texte, dans sa couleur.</small>
                </span>
              </label>
              {tinted && <p className="a-help">Un logo enregistré avant cette version peut avoir perdu ses couleurs : importe-le de nouveau pour les retrouver.</p>}
            </fieldset>
          )}
        </>
      )}
      {favicon && (
        <section className="a-guide-block a-fav-block" data-testid="logo-favicon" aria-label="Icône de l'onglet">
          {favicon}
        </section>
      )}
      {!locked && (
        <Advanced id="logo" count={kit.cursors?.off ? 1 : 0} hint="Le curseur de la souris se dessine, lui aussi, dans le kit Photoshop.">
          <CursorSettings theme={theme} onChange={onKit} />
        </Advanced>
      )}
    </>
  );
}
