"use client";

/**
 * Textes d'interface de l'admin DANS la toile de l'éditeur (lot 130b). La toile est une page publique rendue en vue brouillon : son
 * fournisseur next-intl porte les messages du SITE (fr / en du contenu), pas ceux de l'admin. Cette vue brouillon (et elle seule : admin
 * vérifié, voir PreviewBanner) ajoute un fournisseur imbriqué avec le catalogue d'admin et la langue d'interface du compte, indépendante
 * de la langue du site. Les commandes d'édition rendues dans les composants publics (EditOnly) le retrouvent par un petit magasin de module.
 * Jamais servi sans session admin : le catalogue n'est lu que par PreviewBanner, derrière isAdminPreview().
 */
import { NextIntlClientProvider, type AbstractIntlMessages, useLocale, useMessages, useTimeZone } from "next-intl";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { makeAdminTranslator, type AdminT } from "@/i18n/admin-lang";

export type AdminIntlData = { locale: string; messages: AbstractIntlMessages };

let current: AdminIntlData | null = null;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const snapshot = () => current;

/** Catalogue d'admin de la page courante (null hors vue admin). Pour EditOnly, qui est rendu dans l'arbre du site public. */
export function useAdminIntlData(): AdminIntlData | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/**
 * Traducteur d'un espace de noms d'admin pour un attribut ou un texte posé HORS d'un <EditOnly> dans l'arbre du site (ex. un `data-placeholder`
 * de la vue brouillon). Null tant que le catalogue n'est pas là (rendu serveur, première hydratation) : l'appelant n'écrit alors rien.
 */
export function useAdminTranslator(namespace: string): AdminT | null {
  const data = useAdminIntlData();
  return useMemo(() => (data ? makeAdminTranslator(data.locale.startsWith("en") ? "en" : "fr", data.messages as never, namespace) : null), [data, namespace]);
}

export function AdminIntlProvider({ locale, messages, children }: AdminIntlData & { children: ReactNode }) {
  useEffect(() => {
    current = { locale, messages };
    listeners.forEach((l) => l());
    return () => {
      current = null;
      listeners.forEach((l) => l());
    };
  }, [locale, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
      {children}
    </NextIntlClientProvider>
  );
}

/** Enveloppe des commandes d'édition posées dans l'arbre du site : textes de l'admin, langue d'interface. */
export function AdminIntlBoundary({ children }: { children: ReactNode }) {
  const data = useAdminIntlData();
  const locale = useLocale();
  const messages = useMessages() as AbstractIntlMessages;
  const timeZone = useTimeZone() ?? "Europe/Paris";
  if (data) {
    return (
      <NextIntlClientProvider locale={data.locale} messages={data.messages} timeZone="Europe/Paris">
        {children}
      </NextIntlClientProvider>
    );
  }
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
