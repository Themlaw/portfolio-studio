"use client";

/**
 * Papier dessiné (kit Photoshop, groupe « 3 · Papier ») dans l'éditeur de
 * thème : la tuile couvre le fond du site ; sous le bandeau du haut (collant)
 * elle gêne la lecture, donc il reste un aplat de la couleur de fond sauf si
 * on demande le contraire ici.
 */
import { PAPER_ON_CARDS_DEFAULT, PAPER_OVER_HERO_MAX, type KitAssets, type Theme } from "@/themes/schema";

export default function PaperSettings({ theme, onChange }: { theme: Theme; onChange: (kit: KitAssets) => void }) {
  const kit = theme.assets.kit ?? {};
  if (!kit.paper) return null;
  const paper = kit.paper;
  return (
    <section className="a-panel" aria-labelledby="t-papier">
      <h3 id="t-papier" className="a-subhead">
        Papier dessiné
      </h3>
      <label className="a-guide-check">
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
      <label className="a-guide-check">
        <input
          type="checkbox"
          checked={paper.onCards === true}
          data-testid="paper-on-cards"
          onChange={(e) => {
            const next = { ...paper };
            if (e.target.checked) next.onCards = true;
            else delete next.onCards;
            onChange({ ...kit, paper: next });
          }}
        />
        Papier visible sur les cartes
      </label>
      <p className="a-help">
        Décoché (par défaut) : les cartes des blocs sont des aplats opaques qui cachent le papier. Coché : le papier est dessiné par-dessus la couleur
        de chaque carte, sous son contenu. Chaque carte peut garder son choix (menu « Carte » de la toile : « Comme le site », « Sous la carte » ou « Sur la carte »).
      </p>
      {paper.onCards && (
        <label className="a-field">
          Intensité du papier sur les cartes : {Math.round((paper.onCardsOpacity ?? PAPER_ON_CARDS_DEFAULT) * 100)} %
          <input
            type="range"
            min={0}
            max={Math.round(PAPER_OVER_HERO_MAX * 100)}
            step={1}
            value={Math.round((paper.onCardsOpacity ?? PAPER_ON_CARDS_DEFAULT) * 100)}
            data-testid="paper-on-cards-opacity"
            onChange={(e) => onChange({ ...kit, paper: { ...paper, onCardsOpacity: Number(e.target.value) / 100 } })}
          />
        </label>
      )}
    </section>
  );
}
