"use client";

/**
 * Menu « Plus » de la barre du haut (lot 24) : reçoit les actions secondaires quand la place manque
 * (Abandonner les modifications, largeur d'aperçu), pour que « Publier » reste visible de 1024 à 1920 px.
 * Fermeture par `useDismiss` (clic à l'extérieur, Échap).
 */
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { useDismiss } from "@/components/edit/useDismiss";

export type DeviceChoice = { id: string; label: string; width: number | null };

export default function TopMore({
  devices,
  device,
  onDevice,
  onDiscard,
}: {
  /** Largeurs d'aperçu rangées dans le menu (absent : elles restent dans la barre). */
  devices?: DeviceChoice[];
  device?: string;
  onDevice?: (id: string) => void;
  /** « Abandonner les modifications » rangé dans le menu (absent : le bouton reste dans la barre). */
  onDiscard?: () => void;
}) {
  const t = useTranslations("editorPanelsMore");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, () => setOpen(false), { enabled: open });
  if (!devices && !onDiscard) return null;
  return (
    <div ref={root} className="ve-more">
      <button type="button" className="a-btn ve-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("label")} title={t("label")} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="ve-more-pop" role="menu" aria-label={t("label")}>
          {devices && onDevice && (
            <div className="ve-more-group" role="group" aria-label={t("previewWidth")}>
              <span className="ve-more-title">{t("previewWidth")}</span>
              {devices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={device === d.id}
                  title={d.width ? t("deviceTitle", { label: d.label, width: d.width }) : d.label}
                  onClick={() => {
                    onDevice(d.id);
                    setOpen(false);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {onDiscard && (
            <button
              type="button"
              role="menuitem"
              className="ve-more-danger"
              onClick={() => {
                setOpen(false);
                onDiscard();
              }}
            >
              {t("discard")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
