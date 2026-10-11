"use client";

import { useState, type CSSProperties } from "react";

/**
 * Formulaire de contact public (bloc « contact-form »). Envoi en JSON vers
 * POST /api/contact (formulaire publié : `formId`, stable), avec un champ piège invisible
 * pour les robots. Sur la toile (`edit`), jamais envoyé : libellés, aides et
 * bouton portent les repères de texte en place, champs repérés
 * (`data-form-field`) pour la couche d'édition ; message de confirmation et
 * d'erreur rendus cachés, montrés par « Voir le message… » du panneau.
 */
type Field = {
  id: string;
  type: "text" | "email" | "textarea" | "select";
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
  reply: boolean;
  options: { value: string; label: string }[];
};

export default function ContactForm({
  formId,
  locale,
  fields,
  texts,
  edit,
  styles,
}: {
  /** Identifiant stable du formulaire publié (null sur la toile). */
  formId: string | null;
  locale: string;
  fields: Field[];
  texts: { submit: string; success: string; error: string };
  edit: boolean;
  /** Styles locaux des textes (barre typographique, lot 2), par chemin : `fields.0.label`, `submit`… */
  styles?: Record<string, CSSProperties>;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const mark = (path: string, placeholder: string) => ({ ...(edit ? { "data-inline": path, "data-placeholder": placeholder } : {}), ...(styles && Object.hasOwn(styles, path) ? { style: styles[path] } : {}) });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (edit || formId === null || state === "sending") return;
    const data = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) {
      const v = data.get(f.id);
      if (typeof v === "string" && v.trim()) values[f.id] = v;
    }
    setState("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: formId, locale, values, website: String(data.get("website") ?? "") }),
      });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };

  if (state === "sent" && !edit) {
    return (
      <p className="contact-form-status mt-8 text-base text-ink" role="status">
        {texts.success}
      </p>
    );
  }
  const input = "contact-input mt-2 block w-full rounded-md border border-line bg-bg px-3 py-2 text-base text-ink";
  return (
    <form className="mt-8 grid max-w-xl gap-6" onSubmit={onSubmit} noValidate={edit} data-form-edit={edit || undefined}>
      {fields.map((f, i) => (
        <div key={f.id} className="contact-field" {...(edit ? { "data-form-field": i, "data-form-reply": f.reply || undefined } : {})}>
          <label htmlFor={`cf-${f.id}`} className="caption-text block font-caption text-[0.75rem] tracking-[0.12em] uppercase text-ink-soft">
            <span {...mark(`fields.${i}.label`, "Libellé")}>{f.label}</span>
            {f.required && <span aria-hidden="true"> *</span>}
          </label>
          {f.type === "textarea" ? (
            <textarea id={`cf-${f.id}`} name={f.id} required={f.required} maxLength={4000} rows={5} placeholder={f.placeholder} className={input} />
          ) : f.type === "select" ? (
            <select id={`cf-${f.id}`} name={f.id} required={f.required} className={input} defaultValue="">
              <option value="" disabled>
                {f.placeholder || "—"}
              </option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`cf-${f.id}`}
              name={f.id}
              type={f.type === "email" ? "email" : "text"}
              required={f.required}
              maxLength={f.type === "email" ? 254 : 200}
              placeholder={f.placeholder}
              autoComplete={f.type === "email" ? "email" : "off"}
              className={input}
            />
          )}
          {(f.help || edit) && (
            <p className="mt-1 text-xs text-ink-soft" {...mark(`fields.${i}.help`, "Aide (facultative)")}>
              {f.help}
            </p>
          )}
        </div>
      ))}
      {/* Piège à robots : invisible, jamais rempli par une personne. */}
      <div aria-hidden="true" className="contact-trap">
        <label>
          Site web
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <button type="submit" className="btn" disabled={state === "sending"}>
          <span {...mark("submit", "Envoyer")}>{texts.submit}</span>
          <span aria-hidden="true">→</span>
        </button>
        {state === "failed" && !edit && (
          <p className="contact-form-status mt-4 text-sm text-ink" role="alert">
            {texts.error}
          </p>
        )}
      </div>
      {edit && (
        <>
          <p className="contact-form-pane mt-2 text-base text-ink" data-form-pane="success" {...mark("success", "Message de confirmation")}>
            {texts.success}
          </p>
          <p className="contact-form-pane mt-2 text-sm text-ink" data-form-pane="error" {...mark("error", "Message d'erreur")}>
            {texts.error}
          </p>
        </>
      )}
    </form>
  );
}
