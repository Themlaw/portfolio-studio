"use client";

import type { PagePaper } from "@/themes/wallpaper";
import { WALLPAPER_OPACITY_MIN, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "@/themes/schema";

type Choice = { id: number; name: string; thumb: string | null; size: number; opacity: number };

/**
 * Papier peint de la page (lot 35), dans les réglages de la page de l'éditeur visuel : « Comme le site » (défaut, rien ne change),
 * « Aucun » ou un motif de la bibliothèque (Thèmes → Papiers peints) avec sa taille et son opacité. Remplace le papier du site pour
 * CETTE page seulement. `value` null = comme le site. Le choix passe par l'éditeur (brouillon de la page, rechargement de la toile).
 */
export default function PageWallpaperField({ value, onChange, choices }: { value: PagePaper | null; onChange: (v: PagePaper | null) => void; choices: Choice[] }) {
  const mode = value ? value.mode : "site";
  const current = value?.mode === "wallpaper" ? choices.find((c) => c.id === value.wallpaper) : undefined;
  const size = value?.mode === "wallpaper" ? (value.size ?? current?.size ?? 300) : 300;
  const opacity = value?.mode === "wallpaper" ? (value.opacity ?? current?.opacity ?? 1) : 1;
  const pick = (id: number) => onChange({ mode: "wallpaper", wallpaper: id });
  const set = (p: { size?: number; opacity?: number }) => value?.mode === "wallpaper" && onChange({ ...value, ...p });
  return (
    <div className="a-span-2 a-page-wallpaper" data-testid="page-wallpaper">
      <fieldset className="a-fieldset">
        <legend className="a-field-label">Papier peint de la page</legend>
        <div className="a-seg" role="radiogroup" aria-label="Papier peint de la page">
          <button type="button" role="radio" aria-checked={mode === "site"} data-mode="site" className="a-btn a-btn-small" onClick={() => onChange(null)}>
            Comme le site
          </button>
          <button type="button" role="radio" aria-checked={mode === "none"} data-mode="none" className="a-btn a-btn-small" onClick={() => onChange({ mode: "none" })}>
            Aucun
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "wallpaper"}
            data-mode="wallpaper"
            className="a-btn a-btn-small"
            disabled={!choices.length}
            onClick={() => mode !== "wallpaper" && choices[0] && pick(choices[0].id)}
          >
            Un papier peint
          </button>
        </div>
        <p className="a-help">
          {choices.length
            ? "« Comme le site » : rien ne change. « Aucun » ou un papier peint remplace le papier du site sur cette page seulement."
            : "Aucun papier peint dans la bibliothèque : importe-en dans « Thèmes » → « Papiers peints »."}
        </p>
      </fieldset>
      {value?.mode === "wallpaper" && (
        <>
          <div className="a-wp-choices" role="radiogroup" aria-label="Motif" data-testid="page-wallpaper-choices">
            {choices.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={value.wallpaper === c.id} className="a-wp-choice" data-wallpaper-id={c.id} title={c.name} onClick={() => pick(c.id)}>
                <span className="a-wp-thumb" aria-hidden="true">
                  <span className="a-wp-half" data-tone="light" style={c.thumb ? { backgroundImage: `url("${c.thumb}")` } : undefined} />
                  <span className="a-wp-half" data-tone="dark" style={c.thumb ? { backgroundImage: `url("${c.thumb}")` } : undefined} />
                </span>
                <span className="a-wp-name">{c.name}</span>
              </button>
            ))}
            {!current && <p className="a-help">Ce papier peint n&apos;est plus dans la bibliothèque : la page n&apos;en montre plus. Choisis-en un autre.</p>}
          </div>
          <label className="a-field">
            Taille du motif : {size} px
            <input type="range" min={WALLPAPER_SIZE_MIN} max={WALLPAPER_SIZE_MAX} step={1} value={size} data-testid="page-wallpaper-size" onChange={(e) => set({ size: Number(e.target.value) })} />
          </label>
          <label className="a-field">
            Opacité : {Math.round(opacity * 100)} %
            <input
              type="range"
              min={Math.round(WALLPAPER_OPACITY_MIN * 100)}
              max={100}
              step={1}
              value={Math.round(opacity * 100)}
              data-testid="page-wallpaper-opacity"
              onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
            />
          </label>
          {(value.size !== undefined || value.opacity !== undefined) && (
            <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => onChange({ mode: "wallpaper", wallpaper: value.wallpaper })}>
              Reprendre les réglages du motif
            </button>
          )}
        </>
      )}
    </div>
  );
}
