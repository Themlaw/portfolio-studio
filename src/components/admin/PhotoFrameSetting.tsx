"use client";

/**
 * Réglage « Cadre du thème sur toutes les photos » (lot 62, Admin → Thèmes, quand le thème en ligne dessine un cadre). Non par défaut :
 * le cadre du kit n'est posé que sur les photos qui le choisissent (menu « Cadre » de la barre d'une image) ; en le mettant sur Oui,
 * toutes les photos SANS choix l'ont aussi. Un choix explicite (Aucun, Bordure) passe toujours avant.
 */
import { useState } from "react";

import { saveThemeFrameAllAction } from "@/app/admin/(espace)/themes/frame-actions";

import { toast } from "./editing";

export default function PhotoFrameSetting({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const choose = async (next: boolean) => {
    if (next === on || busy) return;
    setBusy(true);
    const before = on;
    setOn(next);
    const r = await saveThemeFrameAllAction(next);
    setBusy(false);
    if (!r.ok) {
      setOn(before);
      toast(r.message, "error");
    }
  };
  return (
    <section className="a-panel" aria-labelledby="frame-all" data-testid="frame-all-setting">
      <h2 id="frame-all">Cadre du thème sur toutes les photos</h2>
      <p className="a-help">
        Ton thème dessine un cadre. Sur « Non », tes photos n&apos;en ont pas : tu le poses photo par photo, avec le bouton « Cadre » de la barre d&apos;une image. Sur « Oui », toutes les photos qui n&apos;ont
        pas de choix l&apos;ont.
      </p>
      <div className="a-seg a-frame-all-seg" role="radiogroup" aria-label="Cadre du thème sur toutes les photos">
        <button type="button" role="radio" aria-checked={!on} className="a-btn a-btn-small" data-testid="frame-all-off" disabled={busy} onClick={() => choose(false)}>
          Non
        </button>
        <button type="button" role="radio" aria-checked={on} className="a-btn a-btn-small" data-testid="frame-all-on" disabled={busy} onClick={() => choose(true)}>
          Oui
        </button>
      </div>
    </section>
  );
}
