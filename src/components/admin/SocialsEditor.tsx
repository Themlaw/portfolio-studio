"use client";

/**
 * Liste des réseaux dans l'admin (écran Réglages, panneau En-tête / Pied de
 * l'éditeur visuel). Ajouter et modifier passent par le MÊME choix de réseau
 * que la toile (`SocialPicker` : réseaux classiques, « Autre lien », adresse
 * reconnue) ; liens « à compléter » signalés, jamais publiés.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import SocialIcon from "@/components/SocialIcon";
import SocialPicker, { type SocialPickerClasses } from "@/components/SocialPicker";
import { editedKind, isPlaceholderHref, socialKind, type SocialItem } from "@/lib/site-schema";

const CLASSES: SocialPickerClasses = {
  title: "a-sp-title",
  grid: "a-sp-grid",
  form: "a-sp-form",
  field: "a-sp-field",
  hint: "a-sp-hint",
  error: "a-field-error",
  button: "a-btn a-btn-primary a-btn-small",
  back: "a-link-btn a-sp-back",
};

const MAX = 12;

export default function SocialsEditor({
  items,
  onChange,
  errors = {},
  error,
  disabled = false,
}: {
  items: SocialItem[];
  onChange: (next: SocialItem[]) => void;
  /** Erreurs par chemin `<index>.href` / `<index>.label` (validation serveur). */
  errors?: Record<string, string | undefined>;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("socials");
  /** « add » : nouveau réseau ; un nombre : modification de ce lien. */
  const [open, setOpen] = useState<"add" | number | null>(null);
  const moved = (from: number, to: number) => {
    const next = items.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  };
  return (
    <div className="a-socials" data-testid="socials-editor">
      {items.length === 0 && <p className="a-help">{t("none")}</p>}
      <ol className="a-socials-list">
        {items.map((s, i) => {
          const placeholder = isPlaceholderHref(s.href);
          const err = errors[`${i}.href`] ?? errors[`${i}.label`];
          return (
            <li key={`${i}-${s.href}`} className="a-socials-row" data-social-row={i}>
              <span className="a-socials-icon" aria-hidden="true">
                <SocialIcon kind={s.kind} label={s.label} href={s.href} />
              </span>
              <span className="a-socials-main">
                <strong>{s.label}</strong>
                <span className="a-socials-href">{placeholder ? t("missingHref") : s.href.replace(/^mailto:/, "")}</span>
                {placeholder && (
                  <span className="a-field-error" data-testid="social-placeholder">
                    {t("placeholder")}
                  </span>
                )}
                {err && <span className="a-field-error">{err}</span>}
              </span>
              <span className="a-list-tools">
                <button type="button" className="a-icon-btn" aria-label={t("editLabel", { label: s.label })} title={t("edit")} disabled={disabled} aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  ✎
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("moveUp", { label: s.label })} disabled={disabled || i === 0} onClick={() => onChange(moved(i, i - 1))}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("moveDown", { label: s.label })} disabled={disabled || i === items.length - 1} onClick={() => onChange(moved(i, i + 1))}>
                  ↓
                </button>
                <button
                  type="button"
                  className="a-icon-btn a-danger-text"
                  aria-label={t("remove", { label: s.label })}
                  disabled={disabled}
                  onClick={() => {
                    setOpen(null);
                    onChange(items.filter((_, j) => j !== i));
                  }}
                >
                  ✕
                </button>
              </span>
              {open === i && (
                <div className="a-sp-panel">
                  <SocialPicker
                    mode="edit"
                    editLabel
                    initialHref={s.href}
                    initialLabel={s.label}
                    classes={CLASSES}
                    onDone={({ href, label }) => {
                      const kind = editedKind(s.kind, href);
                      onChange(items.map((x, j) => (j === i ? { label: label || x.label, href, ...(kind ? { kind } : {}) } : x)));
                      setOpen(null);
                    }}
                  />
                  <button type="button" className="a-link-btn" onClick={() => setOpen(null)}>
                    {t("cancel")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="a-field-error">{error}</p>}
      {open === "add" ? (
        <div className="a-sp-panel">
          <SocialPicker
            mode="add"
            classes={CLASSES}
            onDone={({ href, label, network }) => {
              onChange([...items, { label, href, kind: socialKind(network, href) }]);
              setOpen(null);
            }}
          />
          <button type="button" className="a-link-btn" onClick={() => setOpen(null)}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <button type="button" className="a-btn a-btn-small" data-testid="social-add" disabled={disabled || items.length >= MAX} onClick={() => setOpen("add")}>
          {t("add")}
        </button>
      )}
    </div>
  );
}
