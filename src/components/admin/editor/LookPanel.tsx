"use client";

/**
 * Panneau « Mise en page » de l'éditeur visuel (lot 2) :
 * - pour le bloc choisi : espace haut / bas, arrondi des images, position du
 *   titre, fond du métier (ouverture), cadrages et styles de texte posés sur
 *   la page (avec « Réinitialiser ») ;
 * - quand rien n'est choisi : « Styles du site » (textes par rôle, arrondi des
 *   images), brouillon du site publié avec la page comme l'en-tête.
 * Mêmes crans que la toile (src/lib/look.ts).
 */
import { useState } from "react";

import TypoControls from "@/components/edit/TypoControls";
import {
  BACKDROP_LABELS,
  BACKDROPS,
  RADII,
  RADIUS_LABELS,
  ROLE_LABELS,
  ROLES,
  SPACE_LABELS,
  SPACES,
  type Look,
  type PaletteColor,
  type Role,
  type SiteStyles,
  type TextStyle,
  type TileKey,
} from "@/lib/look";

import "@/app/admin/look-panel.css";

const TITLE_TYPES = new Set(["section-title", "collection-intro", "hero", "project-board", "collection-tiles"]);
const MEDIA_TYPES = new Set(["image", "video-single", "cv", "grid", "project-board", "profile", "featured-project", "collection-tiles", "hero", "video", "collection-projects", "featured-projects"]);
const TILE_LABELS: Record<TileKey, string> = { characters: "Personnages", backgrounds: "Décors", animation: "Animation" };
const CROP_LABELS: Record<string, string> = { mediaId: "Image", backgroundMediaId: "Fond de l'ouverture", portraitMediaId: "Portrait" };

function Segmented<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  auto = "Auto",
  help,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T | undefined) => void;
  auto?: string | null;
  help?: string;
}) {
  return (
    <div className="lp-field" role="group" aria-label={label}>
      <span className="lp-label">{label}</span>
      <div className="a-seg lp-seg">
        {auto !== null && (
          <button type="button" aria-pressed={value === undefined} onClick={() => onChange(undefined)} title="Valeur du thème">
            {auto}
          </button>
        )}
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
            {labels[o]}
          </button>
        ))}
      </div>
      {help && <p className="lp-help">{help}</p>}
    </div>
  );
}

const TEXT_LABELS: Record<string, string> = {
  eyebrow: "Étiquette",
  title: "Titre",
  intro: "Présentation",
  caption: "Légende",
  cta: "Bouton",
  "site.name": "Nom (commun au site)",
  "site.role": "Métier (commun au site)",
  portraitCaption: "Légende du portrait",
  submit: "Bouton d'envoi",
};
const textLabel = (k: string) => TEXT_LABELS[k] ?? (k.startsWith("paragraphs.") ? `Paragraphe ${Number(k.split(".")[1]) + 1}` : k);

export function BlockLookPanel({ type, look, inCell, onChange }: { type: string; look: Look; inCell: boolean; onChange: (next: Look) => void }) {
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });
  const texts = Object.keys(look.text ?? {});
  const crops = Object.keys(look.crop ?? {});
  const tileCrops = Object.keys(look.tileCrop ?? {}) as TileKey[];
  const vertical = type === "hero" || inCell;
  return (
    <section className="lp" aria-labelledby="lp-title">
      <h3 id="lp-title" className="lp-title">
        Mise en page
      </h3>
      <p className="lp-help">Aussi sur la page : poignées en haut et en bas du bloc choisi, « Aa » sur un texte, « Cadrer » sur une image.</p>
      {type !== "hero" && (
        <>
          <Segmented label="Espace en haut" value={look.spaceTop} options={SPACES} labels={SPACE_LABELS} onChange={(v) => set({ spaceTop: v })} />
          <Segmented label="Espace en bas" value={look.spaceBottom} options={SPACES} labels={SPACE_LABELS} onChange={(v) => set({ spaceBottom: v })} />
        </>
      )}
      {MEDIA_TYPES.has(type) && (
        <Segmented label="Coins des images" value={look.radius} options={RADII} labels={RADIUS_LABELS} onChange={(v) => set({ radius: v })} help="Auto : le réglage du site (Styles du site) ou du thème." />
      )}
      {TITLE_TYPES.has(type) && (
        <>
          <Segmented
            label="Titre : alignement"
            value={look.titleH}
            options={["left", "center", "right"] as const}
            labels={{ left: "Gauche", center: "Centre", right: "Droite" }}
            onChange={(v) => set({ titleH: v === "left" ? undefined : v })}
            auto={null}
          />
          {vertical && (
            <Segmented
              label="Titre : hauteur"
              value={look.titleV ?? (type === "hero" ? "bottom" : "top")}
              options={["top", "middle", "bottom"] as const}
              labels={{ top: "Haut", middle: "Milieu", bottom: "Bas" }}
              onChange={(v) => set({ titleV: v === (type === "hero" ? "bottom" : "top") ? undefined : v })}
              auto={null}
            />
          )}
        </>
      )}
      {type === "hero" && (
        <Segmented
          label="Fond derrière le métier"
          value={look.roleBackdrop}
          options={BACKDROPS}
          labels={BACKDROP_LABELS}
          onChange={(v) => set({ roleBackdrop: v })}
          help="Auto : celui du thème. Couleur et police du métier : « Aa » sur la page."
        />
      )}
      {(crops.length > 0 || tileCrops.length > 0) && (
        <div className="lp-field">
          <span className="lp-label">Cadrages</span>
          <ul className="lp-list">
            {crops.map((k) => (
              <li key={k}>
                {CROP_LABELS[k] ?? k} · zoom {Math.round((look.crop![k as "mediaId"]!.zoom ?? 1) * 100)} %
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const crop = { ...look.crop }; delete crop[k as "mediaId"]; set({ crop }); }}>
                  Recentrer
                </button>
              </li>
            ))}
            {tileCrops.map((k) => (
              <li key={`tile-${k}`}>
                Tuile « {TILE_LABELS[k]} » · zoom {Math.round((look.tileCrop![k]!.zoom ?? 1) * 100)} %
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const tileCrop = { ...look.tileCrop }; delete tileCrop[k]; set({ tileCrop }); }}>
                  Recentrer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {texts.length > 0 && (
        <div className="lp-field">
          <span className="lp-label">Textes personnalisés</span>
          <ul className="lp-list">
            {texts.map((k) => (
              <li key={k}>
                {textLabel(k)}
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const text = { ...look.text }; delete text[k]; set({ text }); }}>
                  Revenir au style global
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function SiteStylesPanel({
  styles,
  onChange,
  palette,
  installed,
  locked,
}: {
  styles: SiteStyles | undefined;
  onChange: (next: SiteStyles) => void;
  palette: Record<PaletteColor, string>;
  installed: string[];
  locked: string | null;
}) {
  const [open, setOpen] = useState<Role | null>(null);
  const roles = styles?.roles ?? {};
  const setRole = (role: Role, style: TextStyle | undefined) => {
    const next = { ...roles };
    if (style) next[role] = style;
    else delete next[role];
    onChange({ ...styles, roles: next });
  };
  return (
    <section className="lp lp-site" aria-labelledby="lp-site-title">
      <h3 id="lp-site-title" className="lp-title">
        Styles du site
      </h3>
      <p className="lp-help">
        Pour toutes les pages, publiés avec cette page (comme l&apos;en-tête). Un réglage posé sur un texte de la page passe devant.
      </p>
      {locked && <p className="a-field-error">Les styles du site sont en cours de modification sur la page « {locked} ».</p>}
      <Segmented label="Coins des images et cartes" value={styles?.radius} options={RADII} labels={RADIUS_LABELS} onChange={(v) => onChange({ ...styles, radius: v })} auto="Thème" />
      <ul className="lp-roles">
        {ROLES.map((role) => {
          const set = Object.keys(roles[role] ?? {}).length > 0;
          return (
            <li key={role} data-open={open === role || undefined}>
              <button type="button" className="lp-role" aria-expanded={open === role} onClick={() => setOpen(open === role ? null : role)}>
                <span>{ROLE_LABELS[role]}</span>
                <small>{set ? "personnalisé" : "thème"}</small>
              </button>
              {open === role && (
                <div className="lp-role-body">
                  <TypoControls value={roles[role] ?? {}} onChange={(s) => setRole(role, s)} installed={installed} swatch={(c) => palette[c]} resetLabel="Revenir au thème" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
