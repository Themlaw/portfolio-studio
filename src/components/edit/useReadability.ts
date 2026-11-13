"use client";

/**
 * Lisibilité en mots dans la langue de l'interface d'admin (lot 130b) : le verdict (bonne / juste / insuffisante), « Lisibilité : … » et
 * l'info-bulle du rapport de contraste. Les fonctions de readability.ts (module pur, testé par node) restent en français ; les composants
 * d'admin passent par ce crochet, qui lit le catalogue (espace editMenusReadability) et le séparateur décimal de la langue.
 */
import { useLocale, useTranslations } from "next-intl";

import { AA } from "@/themes/contrast";

import { fmtRatio, readability, type Readability } from "./readability";

export function useReadability() {
  const t = useTranslations("editMenusReadability");
  const lang = useLocale().slice(0, 2);
  return {
    /** Verdict en mots (« bonne », « juste », « insuffisante ») d'un résultat de readability() / pairsReadability(). */
    word: (r: Readability) => t(r.level),
    /** « Lisibilité : bonne » */
    text: (ratio: number, need: number = AA) => t("text", { verdict: t(readability(ratio, need).level) }),
    /** Info-bulle : le chiffre derrière le verdict. */
    tip: (ratio: number, need: number = AA) => t("tip", { ratio: fmtRatio(ratio, lang), need: fmtRatio(need, lang) }),
  };
}
