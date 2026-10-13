"use client";

/**
 * Papier dessiné (kit Photoshop, groupe « 3 · Papier ») dans l'éditeur de
 * thème : la tuile couvre le fond du site ; sous le bandeau du haut (collant)
 * elle gêne la lecture, donc il reste un aplat de la couleur de fond sauf si
 * on demande le contraire ici.
 */
import type { KitAssets, Theme } from "@/themes/schema";

export default function PaperSettings({ theme, onChange }: { theme: Theme; onChange: (kit: KitAssets) => void }) {
  const kit = theme.assets.kit ?? {};
  if (!kit.paper) return null;
  const paper = kit.paper;
  return (
    <section className="a-panel" aria-labelledby="t-papier">
      <h2 id="t-papier">Papier dessiné</h2>
      <label className="a-check">
        <input
          type="checkbox"
          checked={paper.underHeader === true}
          data-testid="paper-under-header"
          onChange={(e) => {
            const next = { ...paper };
            if (e.target.checked) next.underHeader = true;
            else delete next.underHeader;
            onChange({ ...kit, paper: next });
          }}
        />
        Papier sous le bandeau du haut
      </label>
      <p className="a-help">
        Décoché (par défaut) : le bandeau collant du haut est un aplat de la couleur de fond, la tuile couvre le reste du site. Coché : la tuile passe
        aussi derrière la navigation.
      </p>
    </section>
  );
}
