"use client";

/**
 * Textes d'aide posés comme ATTRIBUTS par les composants du site en vue brouillon (lot 130b) : `data-placeholder` (montré par la feuille
 * d'édition quand un champ est vide), `data-site-hint` et `data-edit-label` (étiquettes « commun à toutes les pages »). Ces composants sont
 * ceux du site public : ils écrivent le français dans le HTML (identique octet pour octet hors vue brouillon). Avec une interface d'admin
 * en anglais, cette couche remplace la valeur par sa traduction (catalogue `canvasTexts`, clé = texte français sans accent ni ponctuation).
 * Valeur inconnue (déjà traduite par le serveur, ou saisie) : laissée telle quelle. Rien à faire en français.
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";

const ATTRIBUTES = ["data-placeholder", "data-site-hint", "data-edit-label"];

/** Clé du catalogue pour un texte français : minuscules, sans accent, tout ce qui n'est pas lettre ou chiffre devient « _ ». */
export const textKey = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function CanvasTexts() {
  const t = useTranslations("canvasTexts");
  const lang = useLocale();
  useEffect(() => {
    if (lang.startsWith("fr")) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      for (const el of document.querySelectorAll<HTMLElement>(ATTRIBUTES.map((a) => `[${a}]`).join(","))) {
        for (const attribute of ATTRIBUTES) {
          const value = el.getAttribute(attribute);
          if (!value) continue;
          const key = textKey(value);
          if (!key || !t.has(key)) continue;
          const next = t(key);
          if (next !== value) el.setAttribute(attribute, next);
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRIBUTES });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [lang, t]);
  return null;
}
