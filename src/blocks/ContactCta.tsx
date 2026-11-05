import type { ReactNode } from "react";

import ContactButton from "@/components/ContactButton";
import { contactActionOf } from "@/lib/contact-form";
import { getSiteView } from "@/lib/settings";

import { contactTarget } from "./contact-target";
import type { BlockContext } from "./types";

/**
 * Bouton d'appel au contact (lot 125). « Ouvrir l'e-mail » : l'ancien lien mailto:. Sinon (défaut, anciens boutons compris) :
 * un lien qui garde le mailto: comme repli sans JavaScript (ou l'ancre du formulaire de la page) et que le navigateur
 * remplace par la fenêtre du formulaire ou le défilement jusqu'au bloc formulaire de la page.
 */
export default async function ContactCta({ ctx, action, className, children }: { ctx: BlockContext; action: unknown; className: string; children: ReactNode }) {
  const { site } = await getSiteView(ctx.locale, ctx.pageId);
  const mailto = `mailto:${site.email}`;
  if (contactActionOf(action) === "mail") {
    return (
      <a className={className} href={mailto}>
        {children}
      </a>
    );
  }
  const target = await contactTarget(ctx);
  return (
    <ContactButton
      className={className}
      mailto={mailto}
      locale={ctx.locale}
      preview={Boolean(ctx.edit)}
      pageId={ctx.pageId > 0 ? ctx.pageId : null}
      target={target.mode === "scroll" ? { mode: "scroll", anchor: target.anchor } : { mode: "modal", form: target.form }}
    >
      {children}
    </ContactButton>
  );
}
