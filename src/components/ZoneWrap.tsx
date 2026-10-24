import type { CSSProperties, ReactNode } from "react";

import type { FondJoin } from "@/themes/fond";
import { borderVars, cardStyle, cardVars, paperAttributes, resolveSurface, surfaceAttributes, type CardPalette, type ResolvedSurface, type Surface } from "@/themes/surface";
import type { WallpaperLookup } from "@/themes/wallpaper";

export { default as FondWrap } from "./FondWrap";

/** Palette du thème et carte par défaut : lus une fois par page, seulement si une carte est rendue (ou en édition). */
export type CardEnv = { palette: CardPalette; defaults: ResolvedSurface; wallpapers?: WallpaperLookup };

/**
 * Couche extérieure d'une zone (lot 66, rendu commun de la « Surface ») : la carte de la rubrique, un aplat posé sur le papier du site
 * (src/app/look.css, `.surface-card`). La couche emboîtée (le fond de couleur ou le papier peint) est `FondWrap` (même dossier) : page, rubrique,
 * conteneur et planche de projet posent les MÊMES deux enveloppes, dans le même ordre (carte, puis fond dedans).
 * Vue brouillon (`edit`) : l'enveloppe est toujours là (sans carte : `data-surface="off"`, `display: contents`) pour que la toile puisse montrer
 * un choix tout de suite sans toucher aux nœuds de React.
 */
export function CardWrap({ surface, env, edit, join, id, children }: { surface: Surface | undefined; env: CardEnv; edit: boolean | undefined; join?: FondJoin; id: string; children: ReactNode }) {
  const defaults = edit ? { "data-card-default": JSON.stringify(env.defaults) } : {};
  if (!surface) {
    return edit ? (
      <div key={`card-${id}`} className="surface-card" data-surface="off" {...defaults}>
        <div className="card-in">{children}</div>
      </div>
    ) : (
      <>{children}</>
    );
  }
  const resolved = resolveSurface(surface, env.defaults);
  const paper = paperAttributes(surface, env.wallpapers);
  const style = cardStyle(resolved.color, env.palette);
  return (
    <div
      key={`card-${id}`}
      className="surface-card"
      {...surfaceAttributes(resolved)}
      {...paper.attrs}
      {...(join?.prev ? { "data-join-prev": "" } : {})}
      {...(join?.next ? { "data-join-next": "" } : {})}
      style={{ ...cardVars(style), ...borderVars(resolved, style, env.palette), ...paper.vars } as CSSProperties}
      {...(edit ? { ...defaults, "data-edit-surface": JSON.stringify(surface) } : {})}
    >
      <div className="card-in">{children}</div>
    </div>
  );
}
