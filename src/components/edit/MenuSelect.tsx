"use client";

/**
 * Liste déroulante maison (lot 7) des réglages typographiques : remplace les
 * `<select>` natifs (leur ligne choisie sortait dans la couleur du système).
 * Bouton + liste (role="listbox") : flèches, Début / Fin, Entrée, Échap, saisie
 * de la première lettre ; fermeture par `useDismiss`. Chaque option peut
 * porter son propre style (ex. sa graisse réelle) et être grisée. Habillage :
 * classes `ms-*` de src/app/admin/typo-controls.css.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useDismiss } from "./useDismiss";

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

  // Clic extérieur, focus dans l'autre cadre : le hook commun (Échap reste géré par la liste).
  useDismiss(root, () => setOpen(false), { enabled: open, escape: false });

  // À l'ouverture : la liste prend le focus (la ligne active est posée par `show`).
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Hotfix v0.33.4 : la liste reste toute dans l'écran (décalée à gauche si elle sort à droite, au-dessus du bouton s'il n'y a pas la place dessous).
  useLayoutEffect(() => {
    const el = list.current;
    const b = button.current;
    if (!open || !el || !b) return;
    const win = el.ownerDocument.defaultView ?? window;
    const place = () => {
      el.style.left = "";
      el.style.top = "";
      el.style.maxHeight = "";
      const vw = el.ownerDocument.documentElement.clientWidth;
      const a = b.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const below = win.innerHeight - 8 - a.bottom - 4;
      const above = a.top - 8 - 4;
      let top = 0;
      if (r.height > below && above > below) {
        const h = Math.min(r.height, above);
        el.style.maxHeight = `${Math.round(h)}px`;
        top = -4 - h - a.height;
      } else if (r.height > below) el.style.maxHeight = `${Math.max(120, Math.round(below))}px`;
      const left = Math.min(0, vw - 8 - (a.left + r.width)) + Math.max(0, 8 - a.left);
      if (left) el.style.left = `${Math.round(left)}px`;
      if (top) el.style.top = `${Math.round(top + a.height)}px`;
    };
    place();
    win.addEventListener("resize", place);
    return () => win.removeEventListener("resize", place);
  }, [open]);

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
