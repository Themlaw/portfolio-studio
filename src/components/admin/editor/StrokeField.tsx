"use client";

/**
 * Couleur posée par-dessus le trait dessiné du kit (lot 110) : une teinte (le même sélecteur de couleur que partout) et une opacité,
 * mélangées au dessin d'origine. Sans teinte : le dessin du thème, tel quel. Utilisé pour le réglage par défaut du site, pour le
 * soulignement de l'en-tête et pour chaque rangée d'images qui défilent.
 */
import AdminColorPicker from "@/components/admin/AdminColorPicker";
import { rgbaToHex } from "@/lib/color";
import { readTint, type StrokeTint } from "@/lib/look";

const START_OPACITY = 60;
/** Gris moyen proposé tant qu'aucune couleur n'est choisie (calculé : aucune couleur écrite à la main). */
const START_COLOR = rgbaToHex({ r: 128, g: 128, b: 128, a: 1 });

export function StrokeField({ title, help, value, onChange, testid }: { title: string; help: string; value: unknown; onChange: (next: StrokeTint | undefined) => void; testid: string }) {
  const tint = readTint(value);
  const opacity = tint?.opacity ?? START_OPACITY;
  return (
    <section className="ve-box-field" aria-label={title} data-testid={testid}>
      <h3 className="a-subhead">{title}</h3>
      <p className="a-help">{help}</p>
      <div className="ve-stroke-row" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <AdminColorPicker label={title} value={tint?.color ?? START_COLOR} onChange={(color) => onChange({ color, opacity })} />
        <label className="ve-box-range" style={{ flex: "1 1 8rem" }}>
          <span>{tint ? `Opacité : ${opacity} %` : "Aucune couleur : le dessin d'origine"}</span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={opacity}
            disabled={!tint}
            aria-label={`${title} : opacité`}
            data-testid={`${testid}-opacity`}
            onChange={(e) => tint && onChange({ color: tint.color, opacity: Number(e.target.value) })}
          />
        </label>
        <button type="button" className="a-btn a-btn-small" disabled={!tint} data-testid={`${testid}-reset`} onClick={() => onChange(undefined)}>
          Revenir au dessin d&apos;origine
        </button>
      </div>
    </section>
  );
}
