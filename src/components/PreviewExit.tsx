"use client";

import { useEffect, useRef } from "react";

/**
 * « Quitter l'aperçu » du bandeau (formulaire natif vers POST
 * /admin/apercu/quitter, qui ramène à l'écran de l'admin d'origine), et
 * raccourci Échap — sauf pendant une saisie ou quand une fenêtre (visionneuse,
 * dialogue) est ouverte : Échap la ferme d'abord.
 */
/** `label` et `title` : textes de l'admin dans la langue d'interface, fournis par le bandeau (rendu serveur, hors du fournisseur de la toile). */
export default function PreviewExit({ label, title }: { label: string; title: string }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (window.top !== window) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
      form.current?.requestSubmit();
    };
    // Capture : on regarde AVANT que la visionneuse ne se ferme sur ce même Échap.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <form ref={form} method="post" action="/admin/apercu/quitter">
      <button type="submit" aria-keyshortcuts="Escape" title={title}>
        {label}
      </button>
    </form>
  );
}
