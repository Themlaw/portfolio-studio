"use client";

/**
 * Sélecteur de couleur de l'administration (lot 29) : remplace le `<input type="color">` du navigateur par le même
 * sélecteur que l'éditeur visuel (carré saturation × luminosité, bande de teinte, code couleur). Une pastille (la couleur
 * courante) ouvre la fenêtre, posée sous elle ; Échap, clic extérieur ou « Fermer » la referment. La valeur émise est
 * `#rrggbb` (minuscules), comme l'ancien sélecteur. Le contraste n'est jamais jugé ici : les écrans qui l'utilisent
 * affichent leur propre avertissement (non bloquant).
 */
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { Popover } from "@/components/edit/ColorPicker";
import { useDismiss } from "@/components/edit/useDismiss";

import "@/app/admin/typo-controls.css";

export default function AdminColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const t = useTranslations("colorPicker");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(pop, () => setOpen(false), { enabled: open });
  return (
    <span className="cpw tc">
      <button
        ref={trigger}
        type="button"
        className="cpw-chip"
        style={{ background: value }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t("picker", { label })}
        title={t("choose")}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <Popover
          id={id}
          ref={pop}
          value={value}
          swatch={() => value}
          onChange={(c) => c && onChange(c.slice(0, 7).toLowerCase())}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
          solid={{ noReset: true }}
          live
        />
      )}
    </span>
  );
}
