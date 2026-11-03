"use client";

/**
 * Choix d'un papier peint dans un menu de la toile (lot 35), partagé par « Fond » (composant) et « Carte » (papier sur la carte) :
 * une grille de vignettes (les motifs de la bibliothèque, lus dans la page de la toile : `wallpaperCatalog`), puis la taille de la
 * tuile et l'opacité — `null` = celle du motif (réglée dans Thèmes → Papiers peints). Chaque vignette montre le motif sur un fond
 * clair ET un fond sombre (les motifs sont dessinés sur transparent). Bibliothèque vide : une phrase qui dit où en importer.
 */
import { PAPER_READABLE_MAX, PAPER_READABLE_WARNING, WALLPAPER_OPACITY_MIN, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "@/themes/schema";
import { effectivePaint, type WallpaperEntry } from "@/themes/wallpaper";

import { wallpaperCatalog } from "./optimistic";

import "@/app/admin/surface-menu.css";

const thumbOf = (e: WallpaperEntry) => (e.files.find((f) => f.w >= 240) ?? e.files.at(-1))?.url ?? "";

export function WallpaperGrid({ value, onPick }: { value: number | undefined; onPick: (id: number) => void }) {
  const list = [...wallpaperCatalog().values()];
  if (!list.length) {
    return (
      <p className="sm-hint" data-testid="wp-empty">
        Aucun papier peint pour l&apos;instant. Importe tes motifs dans « Thèmes » → « Papiers peints » (menu de gauche), puis recharge cette page.
      </p>
    );
  }
  return (
    <div className="wp-grid" role="radiogroup" aria-label="Papier peint" data-testid="wp-grid">
      {list.map((e) => (
        <button key={e.id} type="button" role="radio" aria-checked={value === e.id} className="wp-item" data-wallpaper-id={e.id} title={e.name} onClick={() => onPick(e.id)}>
          <span className="wp-thumb" aria-hidden="true">
            <span className="wp-half" data-tone="light" style={{ backgroundImage: `url("${thumbOf(e)}")` }} />
            <span className="wp-half" data-tone="dark" style={{ backgroundImage: `url("${thumbOf(e)}")` }} />
          </span>
          <span className="wp-name">{e.name}</span>
        </button>
      ))}
      {value !== undefined && !list.some((e) => e.id === value) && (
        <p className="sm-hint" data-testid="wp-missing">
          Ce papier peint n&apos;est plus dans la bibliothèque : choisis-en un autre.
        </p>
      )}
    </div>
  );
}

/** Taille de la tuile (px) et opacité : `size` / `opacity` absents = ceux du motif. Lot 90 : l'opacité va toujours de 0 à 100 % et montre la vraie valeur du rendu ;
 * `textOver` : du texte est posé sur ce fond, un avertissement non bloquant apparaît au-delà de 60 %. */
export function WallpaperPaintRows({
  entry,
  size,
  opacity,
  textOver = false,
  onChange,
}: {
  entry: WallpaperEntry | undefined;
  size: number | undefined;
  opacity: number | undefined;
  textOver?: boolean;
  onChange: (p: { size?: number | null; opacity?: number | null }, continuous?: boolean) => void;
}) {
  if (!entry) return null;
  const eff = effectivePaint(entry, { size, opacity });
  const opacityNow = eff.opacity;
  const custom = size !== undefined || opacity !== undefined;
  return (
    <>
      <div className="tc-row">
        <span className="sm-label">Taille</span>
        <input
          type="range"
          className="sm-range"
          min={WALLPAPER_SIZE_MIN}
          max={WALLPAPER_SIZE_MAX}
          step={1}
          value={eff.size}
          aria-label="Taille du motif"
          data-testid="wp-size"
          onChange={(e) => onChange({ size: Number(e.target.value) }, true)}
        />
        <span className="sm-hint">{eff.size} px</span>
      </div>
      <div className="tc-row">
        <span className="sm-label">Opacité</span>
        <input
          type="range"
          className="sm-range"
          min={Math.round(WALLPAPER_OPACITY_MIN * 100)}
          max={100}
          step={1}
          value={Math.round(opacityNow * 100)}
          aria-label="Opacité du motif"
          data-testid="wp-opacity"
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 }, true)}
        />
        <span className="sm-hint">{Math.round(opacityNow * 100)} %</span>
      </div>
      {textOver && opacityNow > PAPER_READABLE_MAX && (
        <p className="sm-warn" role="status" data-testid="wp-opacity-warning">
          <span className="sm-alert" aria-hidden="true">
            !
          </span>
          {PAPER_READABLE_WARNING}
        </p>
      )}
      {custom && (
        <div className="tc-row">
          <span className="sm-label" aria-hidden="true" />
          <button type="button" className="wp-reset" data-testid="wp-reset" onClick={() => onChange({ size: null, opacity: null })}>
            Reprendre les réglages du motif
          </button>
        </div>
      )}
    </>
  );
}
