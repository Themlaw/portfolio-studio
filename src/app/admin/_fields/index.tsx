"use client";

/**
 * Kit de champs de l'admin : libellé au-dessus, aide en dessous, erreur sous
 * le champ fautif. Chaque champ i18n a des onglets FR/EN avec un indicateur
 * de langue manquante.
 */
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { EditorContext, L } from "@/blocks/editor-types";
import { MediaPickerDialog } from "@/components/admin/MediaLibrary";

const LANGS: { key: keyof L; label: string }[] = [
  { key: "fr", label: "FR" },
  { key: "en", label: "EN" },
];

/** Erreur à un chemin (ou à l'un de ses sous-chemins, ex. « title.fr »). */
export function errorAt(errors: Record<string, string> | undefined, path: string): string | undefined {
  if (!errors) return undefined;
  if (errors[path]) return errors[path];
  const sub = Object.keys(errors).find((k) => k.startsWith(`${path}.`));
  if (!sub) return undefined;
  const lang = sub.slice(path.length + 1).split(".")[0];
  return lang === "fr" || lang === "en" ? `${lang.toUpperCase()} : ${errors[sub]}` : errors[sub];
}

export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`a-field${error ? " a-field-invalid" : ""}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="a-field-label">{label}</span>}
      {children}
      {help && <p className="a-help">{help}</p>}
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function I18n({
  label,
  help,
  value,
  onChange,
  error,
  multiline = false,
  rows = 3,
}: {
  label: string;
  help?: string;
  value: L | undefined;
  onChange: (next: L) => void;
  error?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const t = useTranslations("fields");
  const id = useId();
  const [lang, setLang] = useState<keyof L>("fr");
  const v = value ?? { fr: "", en: "" };
  const inputId = `${id}-${lang}`;
  return (
    <Field label={label} help={help} error={error} htmlFor={inputId}>
      <div className="a-langs" role="tablist" aria-label={t("languageOf", { label })}>
        {LANGS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="tab"
            aria-selected={lang === l.key}
            className="a-lang"
            onClick={() => setLang(l.key)}
            title={v[l.key].trim() ? undefined : t("langMissing", { lang: l.label })}
          >
            {l.label}
            {!v[l.key].trim() && <span className="a-lang-missing" aria-label={t("missing")} />}
          </button>
        ))}
      </div>
      {multiline ? (
        <textarea
          id={inputId}
          className="a-input a-textarea"
          rows={rows}
          value={v[lang]}
          lang={lang}
          onChange={(e) => onChange({ ...v, [lang]: e.target.value })}
        />
      ) : (
        <input
          id={inputId}
          className="a-input"
          value={v[lang]}
          lang={lang}
          onChange={(e) => onChange({ ...v, [lang]: e.target.value })}
        />
      )}
    </Field>
  );
}

export function TextI18n(props: Omit<Parameters<typeof I18n>[0], "multiline">) {
  return <I18n {...props} />;
}

export function TextareaI18n(props: Omit<Parameters<typeof I18n>[0], "multiline">) {
  return <I18n {...props} multiline />;
}

export function TextField({
  label,
  help,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: "text" | "email";
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      <input id={id} type={type} className="a-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function UrlField(props: Omit<Parameters<typeof TextField>[0], "type">) {
  return <TextField {...props} placeholder={props.placeholder ?? "https://…"} />;
}

export function Toggle({
  label,
  help,
  checked,
  onChange,
  error,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className={`a-field a-toggle-field${error ? " a-field-invalid" : ""}`}>
      <label className="a-toggle" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="a-toggle-track" aria-hidden="true" />
        <span>{label}</span>
      </label>
      {help && <p className="a-help">{help}</p>}
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select<T extends string | number>({
  label,
  help,
  value,
  options,
  onChange,
  error,
  allowEmpty,
}: {
  label: string;
  help?: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T | undefined) => void;
  error?: string;
  /** Libellé de l'option vide, si le champ est facultatif. */
  allowEmpty?: string;
}) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      <select
        id={id}
        className="a-input a-select"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(undefined);
          const found = options.find((o) => String(o.value) === raw);
          onChange(found?.value);
        }}
      >
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export const COLLECTION_OPTIONS = [
  { value: "characters" as const, label: "characters" },
  { value: "backgrounds" as const, label: "backgrounds" },
  { value: "animation" as const, label: "animation" },
];

/** Collections avec leur libellé traduit (catalogue `fields`, clés `collection_<valeur>`). */
function useCollectionOptions() {
  const t = useTranslations("fields");
  return COLLECTION_OPTIONS.map((o) => ({ value: o.value, label: t(`collection_${o.value}`) }));
}

export function CollectionPicker({
  label,
  value,
  onChange,
  error,
  exclude = [],
  help,
}: {
  label?: string;
  value: string | undefined;
  onChange: (v: "characters" | "backgrounds" | "animation") => void;
  error?: string;
  exclude?: string[];
  help?: string;
}) {
  const t = useTranslations("fields");
  const options = useCollectionOptions();
  return (
    <Select
      label={label ?? t("collection")}
      help={help}
      value={value as "characters" | "backgrounds" | "animation" | undefined}
      options={options.filter((o) => !exclude.includes(o.value))}
      onChange={(v) => v && onChange(v)}
      error={error}
    />
  );
}

/**
 * Réglage de page « Cette page est la collection » (lot 22) : Personnages, Décors, Animation ou aucune. Une collection
 * n'a qu'une page : celles que d'autres pages ont déjà ne sont pas proposées (le serveur le contrôle aussi).
 */
export function PageCollectionField({
  value,
  onChange,
  pages,
  pageId,
  error,
}: {
  value: "characters" | "backgrounds" | "animation" | null | undefined;
  onChange: (v: "characters" | "backgrounds" | "animation" | null) => void;
  pages: { id: number; title: string; collection?: string | null }[];
  pageId: number;
  error?: string;
}) {
  const t = useTranslations("fields");
  const all = useCollectionOptions();
  const takenBy = (c: string) => pages.find((p) => p.collection === c && p.id !== pageId);
  const taken = all.filter((o) => takenBy(o.value));
  return (
    <Select
      label={t("pageIsCollection")}
      help={t("pageIsCollectionHelp", { taken: taken.length, list: taken.map((o) => t("takenItem", { label: o.label, title: takenBy(o.value)!.title })).join(" ; ") })}
      value={value ?? undefined}
      options={all.filter((o) => !takenBy(o.value))}
      allowEmpty={t("none")}
      onChange={(v) => onChange(v ?? null)}
      error={error}
    />
  );
}

export function PagePicker({
  label,
  help,
  value,
  onChange,
  error,
  context,
  optional,
}: {
  label: string;
  help?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  error?: string;
  context: EditorContext;
  optional?: string;
}) {
  return (
    <Select
      label={label}
      help={help}
      value={value}
      options={context.pages.map((p) => ({ value: p.id, label: `${p.title} (/${p.slug})` }))}
      onChange={onChange}
      error={error}
      allowEmpty={optional}
    />
  );
}

export function ProjectPicker({
  label,
  help,
  value,
  onChange,
  error,
  context,
}: {
  label: string;
  help?: string;
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  error?: string;
  context: EditorContext;
}) {
  const t = useTranslations("fields");
  const selected = value ?? [];
  return (
    <Field label={label} help={help} error={error}>
      <ul className="a-checklist">
        {context.projects.map((p) => {
          const index = selected.indexOf(p.slug);
          return (
            <li key={p.slug}>
              <label>
                <input
                  type="checkbox"
                  checked={index >= 0}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, p.slug] : selected.filter((s) => s !== p.slug))
                  }
                />
                <span>{p.title}</span>
                {index >= 0 && <span className="mono muted">{t("rank", { n: index + 1 })}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </Field>
  );
}

export function MediaPicker({
  label,
  help,
  value,
  onChange,
  error,
  context,
  kind = "image",
}: {
  label: string;
  help?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  error?: string;
  context: EditorContext;
  /** Type de média proposé. */
  kind?: "image" | "video" | "pdf";
}) {
  const t = useTranslations("fields");
  const [open, setOpen] = useState(false);
  const current = context.media.find((m) => m.id === value);
  // Textes par type de média : clés `picker_<type>_help | none | ref | change | choose` du catalogue `fields`.
  const words = {
    help: t(`picker_${kind}_help`),
    none: t(`picker_${kind}_none`),
    change: t(`picker_${kind}_change`),
    choose: t(`picker_${kind}_choose`),
  };
  return (
    <Field label={label} help={help ?? words.help} error={error}>
      <div className="a-media-field">
        <span className="a-media-field-thumb">
          {current?.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.thumb} alt="" />
          ) : (
            <span className="muted">{value ? t("processing") : words.none}</span>
          )}
        </span>
        <span className="a-media-field-name">{current?.name ?? (value ? t(`picker_${kind}_ref`, { id: value }) : "")}</span>
        <button type="button" className="a-btn a-btn-small" onClick={() => setOpen(true)}>
          {value ? words.change : words.choose}
        </button>
        {value !== undefined && (
          <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => onChange(undefined)}>
            {t("remove")}
          </button>
        )}
      </div>
      <MediaPickerDialog
        open={open}
        media={context.media.filter((m) => m.kind === kind)}
        title={label}
        onClose={() => setOpen(false)}
        onPick={(m) => {
          onChange(m.id);
          setOpen(false);
        }}
      />
    </Field>
  );
}

/** Liste éditable : ajout, suppression, déplacement (boutons, clavier compris). */
export function ListField<T>({
  label,
  help,
  items,
  onChange,
  make,
  render,
  addLabel,
  itemLabel,
  error,
  min = 0,
}: {
  label: string;
  help?: string;
  items: T[];
  onChange: (next: T[]) => void;
  make: () => T;
  render: (item: T, update: (next: T) => void, index: number) => React.ReactNode;
  addLabel: string;
  itemLabel: (index: number) => string;
  error?: string;
  min?: number;
}) {
  const t = useTranslations("fields");
  const move = (from: number, to: number) => {
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  return (
    <Field label={label} help={help} error={error}>
      <ol className="a-list">
        {items.map((item, i) => (
          <li key={i} className="a-list-item">
            <div className="a-list-head">
              <span className="a-list-title">{itemLabel(i)}</span>
              <span className="a-list-tools">
                <button type="button" className="a-icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t("moveUp", { item: itemLabel(i) })}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={t("moveDown", { item: itemLabel(i) })}>
                  ↓
                </button>
                <button
                  type="button"
                  className="a-icon-btn a-danger-text"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  disabled={items.length <= min}
                  aria-label={t("removeItem", { item: itemLabel(i) })}
                >
                  ✕
                </button>
              </span>
            </div>
            {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}
          </li>
        ))}
      </ol>
      <button type="button" className="a-btn a-btn-small" onClick={() => onChange([...items, make()])}>
        + {addLabel}
      </button>
    </Field>
  );
}
