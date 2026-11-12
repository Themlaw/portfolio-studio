"use client";

/**
 * Réglage « Cadre du thème sur toutes les photos » (lot 62, Admin → Thèmes, quand le thème en ligne dessine un cadre). Non par défaut :
 * le cadre du kit n'est posé que sur les photos qui le choisissent (menu « Cadre » de la barre d'une image) ; en le mettant sur Oui,
 * toutes les photos SANS choix l'ont aussi. Un choix explicite (Aucun, Bordure) passe toujours avant.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { saveThemeFrameAllAction } from "@/app/admin/(espace)/themes/frame-actions";

import { toast } from "./editing";

export default function PhotoFrameSetting({ initial }: { initial: boolean }) {
  const t = useTranslations("photoFrame");
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
      <h2 id="frame-all">{t("title")}</h2>
      <p className="a-help">
        {t("help")}
      </p>
      <div className="a-seg a-frame-all-seg" role="radiogroup" aria-label={t("title")}>
        <button type="button" role="radio" aria-checked={!on} className="a-btn a-btn-small" data-testid="frame-all-off" disabled={busy} onClick={() => choose(false)}>
          {t("no")}
        </button>
        <button type="button" role="radio" aria-checked={on} className="a-btn a-btn-small" data-testid="frame-all-on" disabled={busy} onClick={() => choose(true)}>
          {t("yes")}
        </button>
      </div>
    </section>
  );
}
