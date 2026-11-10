"use client";

/**
 * Apparition au défilement (lot 133) : effet et cascade d'un bloc, dans le panneau de réglages. Écrit `props.reveal` (src/blocks/reveal.ts),
 * valable pour tous les types du registre. Sans effet par défaut ; l'Aperçu l'anime, la toile d'édition jamais. Jamais le premier bloc de la page.
 * `onCascade` (planche libre) : l'effet de chaque image, décalé image après image.
 */
import { REVEAL_KINDS, REVEAL_MAX_DELAY, type Reveal } from "@/blocks/reveal";

const KIND_LABELS: Record<(typeof REVEAL_KINDS)[number], string> = { fade: "Fondu", slide: "Glissé", scale: "Échelle" };

export default function RevealPanel({ value, first, onChange, onCascade }: { value: Reveal | undefined; first: boolean; onChange: (next: Reveal | null) => void; onCascade?: (kind: Reveal["kind"] | null) => void }) {
  return (
    <section className="lp lp-reveal" aria-label="Apparition au défilement" data-testid="reveal-section">
      <div className="lp-field" role="group" aria-label="Apparition au défilement">
        <span className="lp-label">Apparition au défilement</span>
        <div className="a-seg lp-seg">
          <button type="button" aria-pressed={value === undefined} onClick={() => onChange(null)}>
            Aucune
          </button>
          {REVEAL_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={value?.kind === k} data-reveal-kind={k} onClick={() => onChange({ kind: k, ...(value?.delay ? { delay: value.delay } : {}) })}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        {value && (
          <label className="lp-field">
            <span className="lp-label">Décalage en cascade : {value.delay ?? 0}</span>
            <input type="range" min={0} max={REVEAL_MAX_DELAY} step={1} value={value.delay ?? 0} aria-label="Décalage en cascade" data-testid="reveal-delay" onChange={(e) => onChange({ kind: value.kind, ...(Number(e.target.value) ? { delay: Number(e.target.value) } : {}) })} />
          </label>
        )}
        {onCascade && (
          <div className="a-seg lp-seg" role="group" aria-label="Apparition des images">
            {REVEAL_KINDS.map((k) => (
              <button key={k} type="button" data-reveal-cascade={k} onClick={() => onCascade(k)}>
                Images en cascade : {KIND_LABELS[k]}
              </button>
            ))}
            <button type="button" onClick={() => onCascade(null)}>
              Images fixes
            </button>
          </div>
        )}
        <p className="lp-help">{first ? "Le premier bloc de la page s'affiche tout de suite : l'apparition n'y joue pas." : "Le bloc apparaît quand on arrive dessus. Visible dans l'Aperçu ; coupé si le visiteur réduit les animations."}</p>
      </div>
    </section>
  );
}
