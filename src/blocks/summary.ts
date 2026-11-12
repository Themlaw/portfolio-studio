import type { AdminT } from "@/i18n/admin-lang";

import { FR_LABELS } from "./block-msg";

/** Résumé lisible d'un bloc à partir du gabarit déclaré dans le registre. */
const COLLECTIONS: Record<string, string> = FR_LABELS.collection;

function display(value: unknown, t?: AdminT): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.length ? String(value.length) : "";
  if (typeof value === "object") {
    const o = value as { fr?: unknown; en?: unknown };
    return String(o.fr || o.en || "").replace(/<\/?mark>/g, "");
  }
  if (typeof value === "string") return (Object.hasOwn(COLLECTIONS, value) ? (t ? t(`collection.${value}`) : COLLECTIONS[value]) : undefined) ?? value;
  return String(value);
}

/**
 * `{chemin}` : la valeur ; `{chemin|singulier|pluriel}` (gabarits anglais) : le mot au singulier si la valeur est 1. `t` (espace
 * blockRegLabels) : noms des collections dans la langue de l'interface ; sans lui, le français.
 */
export function renderSummary(template: string, props: Record<string, unknown>, t?: AdminT): string {
  return template
    .split(" · ")
    .map((part) => {
      let empty = false;
      const text = part.replace(/\{([\w.]+)(?:\|([^|}]*)\|([^|}]*))?\}/g, (_, key: string, one: string | undefined, many: string | undefined) => {
        const v = display(key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], props), t);
        if (!v) empty = true;
        return one !== undefined ? `${v} ${v === "1" ? one : many}` : v;
      });
      return empty ? "" : text.trim();
    })
    .filter(Boolean)
    .join(" · ");
}
