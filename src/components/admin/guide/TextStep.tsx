"use client";

/**
 * Étape 2 « Textes » (lot 61) : deux polices (titres, texte). La police des légendes et les sept styles par rôle sont dans
 * « Affiner (avancé) », avec le compteur de styles posés.
 */
import { useRecentFonts } from "@/components/edit/recent-fonts";
import { FONT_STACKS } from "@/themes/font-stacks";
import { FONT_IDS, type FontId, type Theme } from "@/themes/schema";

import { AIR_LABELS, AIRS, type Air } from "@/themes/backdrop-air";

import ThemeTypeEditor from "../ThemeTypeEditor";
import { Advanced } from "./controls";

function FontGrid({ role, label, help, value, onPick: pick }: { role: "display" | "body" | "caption"; label: string; help: string; value: FontId; onPick: (f: FontId) => void }) {
  // Lot 70 : « Récentes » (les polices choisies ces derniers temps, mémorisées par le serveur), celles qu'on peut poser ici en tête.
  const { recent, remember } = useRecentFonts();
  const recentIds = recent.flatMap((r) => (r.startsWith("embed:") && (FONT_IDS as readonly string[]).includes(r.slice(6)) ? [r.slice(6) as FontId] : []));
  const onPick = (f: FontId) => {
    remember(`embed:${f}`);
    pick(f);
  };
  return (
    <fieldset className="a-fieldset" data-font-role={role}>
      <legend>{label}</legend>
      <p className="a-help">{help}</p>
      {recentIds.length > 0 && (
        <div className="a-font-recent" role="group" aria-label="Polices récentes" data-testid={`font-recent-${role}`}>
          <span className="a-font-recent-title">Récentes</span>
          {recentIds.map((fid) => (
            <button key={fid} type="button" className="a-font-recent-choice" aria-pressed={value === fid} data-font-recent={fid} style={{ fontFamily: FONT_STACKS[fid].stack }} onClick={() => onPick(fid)}>
              {FONT_STACKS[fid].label}
            </button>
          ))}
        </div>
      )}
      <div className="a-font-grid">
        {FONT_IDS.map((fid: FontId) => (
          <label key={fid} className="a-font-choice">
            <input type="radio" name={`font-${role}`} checked={value === fid} onChange={() => onPick(fid)} />
            <span className="a-font-sample" style={{ fontFamily: FONT_STACKS[fid].stack, fontWeight: role === "display" ? FONT_STACKS[fid].headingWeight : 400 }}>
              Aa Titres
            </span>
            <span className="a-font-name">{FONT_STACKS[fid].label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function TextStep({
  theme,
  onFont,
  onType,
  onAir,
}: {
  theme: Theme;
  onFont: (role: "display" | "body" | "caption", font: FontId) => void;
  onType: (next: Theme["tokens"]["type"]) => void;
  /** Aération du fond de texte (lot 68) : défaut du site. */
  onAir: (air: Air) => void;
}) {
  const styled = Object.keys(theme.tokens.type ?? {}).length;
  return (
    <>
      <p className="a-help a-step-intro">Choisis la police de tes titres et celle de ton texte. Le reste se règle tout seul.</p>
      <FontGrid role="display" label="Titres" help="Ton nom, les titres de section." value={theme.tokens.font.display} onPick={(f) => onFont("display", f)} />
      <FontGrid role="body" label="Texte" help="Paragraphes et menus." value={theme.tokens.font.body} onPick={(f) => onFont("body", f)} />
      <fieldset className="a-fieldset" data-testid="text-air">
        <legend>Aération du fond de texte</legend>
        <p className="a-help">La couleur posée derrière un titre ou un texte (Bandeau, Surlignage) : serrée contre les lettres, ou avec plus d&apos;air. Chaque texte peut choisir la sienne.</p>
        <div className="a-seg" role="radiogroup" aria-label="Aération du fond de texte">
          {AIRS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={(theme.tokens.layout?.textAir ?? "normal") === a} data-air={a} onClick={() => onAir(a)}>
              {AIR_LABELS[a]}
            </button>
          ))}
        </div>
      </fieldset>
      <Advanced id="textes" count={styled} hint="La police des légendes, puis le style de chaque texte du site (police, graisse, italique, casse, espacement des lettres).">
        <FontGrid role="caption" label="Légendes" help="Étiquettes et légendes des œuvres." value={theme.tokens.font.caption} onPick={(f) => onFont("caption", f)} />
        <ThemeTypeEditor value={theme.tokens.type} onChange={onType} />
      </Advanced>
    </>
  );
}
