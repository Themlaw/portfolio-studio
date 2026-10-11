"use client";

/**
 * Liste déroulante maison (lot 7) des réglages typographiques : remplace les
 * `<select>` natifs (leur ligne choisie sortait dans la couleur du système).
 * Bouton + liste (role="listbox") : flèches, Début / Fin, Entrée, Échap, saisie
 * de la première lettre ; fermeture au clic extérieur. Chaque option peut
 * porter son propre style (ex. sa graisse réelle) et être grisée. Habillage :
 * classes `ms-*` de src/app/admin/typo-controls.css.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

export type MenuOption = {
  value: string;
  label: string;
  /** Grisée et non choisissable (ex. graisse absente de la police). */
  disabled?: boolean;
  /** Aperçu : style de la ligne (graisse, police…). */
  style?: CSSProperties;
  /** Précision affichée à droite (ex. « indisponible »). */
  hint?: string;
};

export default function MenuSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  title,
  /** Option « aucune valeur » en tête (libellé), qui renvoie "". */
  emptyLabel,
}: {
  /** Nom accessible du bouton (« Taille », « Graisse »). */
  label: string;
  placeholder: string;
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  title?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const all: MenuOption[] = emptyLabel ? [{ value: "", label: emptyLabel }, ...options] : options;
  const current = options.find((o) => o.value === value);

  const show = () => {
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Clic (ou toucher) hors du menu : fermeture. Écouteur natif sur le document
  // de la toile : les barres de la toile arrêtent la propagation de React.
  useEffect(() => {
    if (!open) return;
    const doc = root.current?.ownerDocument ?? document;
    const onDown = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener("pointerdown", onDown, true);
    return () => doc.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // À l'ouverture : la liste prend le focus (la ligne active est posée par `show`).
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < all.length; i += dir) if (!all[i].disabled) return i;
    return from;
  };
  const choose = (i: number) => {
    const o = all[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close(true);
  };

  return (
    <span className="ms" ref={root}>
      <button
        ref={button}
        type="button"
        className="ms-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}${current ? ` : ${current.label}` : ""}`}
        title={title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="ms-value">{current?.label ?? placeholder}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          ref={list}
          id={id}
          className="ms-list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => move(a, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => move(a, -1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(move(-1, 1));
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(move(all.length, -1));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Tab") {
              setOpen(false);
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              const i = all.findIndex((o, n) => n > active && !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
              if (i >= 0) setActive(i);
            }
          }}
        >
          {all.map((o, i) => (
            <li
              key={o.value || "__empty"}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              data-active={i === active || undefined}
              data-value={o.value}
              className="ms-option"
              style={o.style}
              onPointerEnter={() => !o.disabled && setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="ms-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
