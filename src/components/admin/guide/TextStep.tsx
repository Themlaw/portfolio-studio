"use client";

/**
 * Étape 2 « Textes » (lot 61) : deux polices (titres, texte). La police des légendes et les sept styles par rôle sont dans
 * « Affiner (avancé) », avec le compteur de styles posés.
 */
import { FONT_STACKS } from "@/themes/font-stacks";
import { FONT_IDS, type FontId, type Theme } from "@/themes/schema";

import ThemeTypeEditor from "../ThemeTypeEditor";
import { Advanced } from "./controls";

function FontGrid({ role, label, help, value, onPick }: { role: "display" | "body" | "caption"; label: string; help: string; value: FontId; onPick: (f: FontId) => void }) {
  return (
    <fieldset className="a-fieldset" data-font-role={role}>
      <legend>{label}</legend>
      <p className="a-help">{help}</p>
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
}: {
  theme: Theme;
  onFont: (role: "display" | "body" | "caption", font: FontId) => void;
  onType: (next: Theme["tokens"]["type"]) => void;
}) {
  const styled = Object.keys(theme.tokens.type ?? {}).length;
  return (
    <>
      <p className="a-help a-step-intro">Choisis la police de tes titres et celle de ton texte. Le reste se règle tout seul.</p>
      <FontGrid role="display" label="Titres" help="Ton nom, les titres de section." value={theme.tokens.font.display} onPick={(f) => onFont("display", f)} />
      <FontGrid role="body" label="Texte" help="Paragraphes et menus." value={theme.tokens.font.body} onPick={(f) => onFont("body", f)} />
      <Advanced id="textes" count={styled} hint="La police des légendes, puis le style de chaque texte du site (police, graisse, italique, casse, espacement des lettres).">
        <FontGrid role="caption" label="Légendes" help="Étiquettes et légendes des œuvres." value={theme.tokens.font.caption} onPick={(f) => onFont("caption", f)} />
        <ThemeTypeEditor value={theme.tokens.type} onChange={onType} />
      </Advanced>
    </>
  );
}
