"use client";

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import ContactForm from "@/components/ContactForm";
import type { ModalForm } from "@/blocks/contact-target";

/**
 * Bouton « Me contacter » (lot 125). Rendu serveur : un lien dont l'adresse est le repli sans JavaScript (mailto:, ou l'ancre
 * du formulaire de la page). Avec JavaScript :
 *  - `scroll` : la page porte déjà un bloc formulaire, on défile jusqu'à lui et le premier champ prend le focus ;
 *  - `modal` : une fenêtre (<dialog> natif, ouvert en modal : focus piégé, fond inerte, Échap) contient le même formulaire
 *    (mêmes champs, même validation, même anti-spam, même confirmation) ; à la fermeture, le focus revient au bouton.
 * Sur la toile (édition), le clic n'ouvre rien (EditLayer annule déjà l'action du lien) ; en Aperçu de l'éditeur la fenêtre
 * s'ouvre mais l'envoi est simulé (rien n'est enregistré).
 */
export default function ContactButton({
  className,
  mailto,
  locale,
  preview,
  pageId,
  target,
  children,
}: {
  className: string;
  mailto: string;
  locale: string;
  preview: boolean;
  pageId: number | null;
  target: { mode: "scroll"; anchor: string | null } | { mode: "modal"; form: ModalForm };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [opens, setOpens] = useState(0);
  const link = useRef<HTMLAnchorElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reduced = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Sur la toile en édition : le lien n'ouvre rien (EditLayer.neutralizeLink) et n'ouvre pas non plus la fenêtre.
    if (document.documentElement.hasAttribute("data-edit-mode")) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (target.mode === "scroll") {
      const el = (target.anchor ? document.getElementById(target.anchor) : null) ?? document.querySelector<HTMLElement>(".contact-form");
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      el.querySelector<HTMLElement>("input:not([name=website]), textarea, select")?.focus({ preventScroll: true });
      return;
    }
    e.preventDefault();
    setMounted(true);
    setOpens((n) => n + 1);
    setOpen(true);
  };

  const close = useCallback(() => {
    setOpen(false);
    dialog.current?.close();
  }, []);

  // Ouverture : showModal() (focus piégé, fond inerte, Échap) puis premier champ.
  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>("input:not([name=website]), textarea, select")?.focus();
  }, [open, mounted]);

  // Fermeture (Échap, bouton, fond) : l'état suit, le focus revient au bouton.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onClose = () => {
      setOpen(false);
      link.current?.focus();
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [mounted]);

  const href = target.mode === "scroll" && target.anchor ? `#${target.anchor}` : mailto;
  const form = target.mode === "modal" ? target.form : null;
  const en = locale === "en";
  return (
    <>
      <a ref={link} className={className} href={href} onClick={onClick} {...(target.mode === "modal" ? { "aria-haspopup": "dialog" as const } : {})} data-contact-open="">
        {children}
      </a>
      {mounted &&
        form &&
        createPortal(
          <dialog
            ref={dialog}
            className="contact-dialog"
            aria-labelledby={titleId}
            onClick={(e) => {
              // Clic sur le fond (la boîte elle-même, hors du panneau) : ferme.
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="contact-dialog-panel">
              <div className="contact-dialog-head">
                <h2 id={titleId} className="font-display text-[clamp(1.5rem,4vw,2.25rem)] text-ink">
                  {form.title}
                </h2>
                <button type="button" className="contact-dialog-close" onClick={close} aria-label={en ? "Close" : "Fermer"}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <ContactForm key={opens} formId={form.formId} locale={locale} edit={false} dryRun={preview} pageId={pageId} fields={form.fields} texts={form.texts} />
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
