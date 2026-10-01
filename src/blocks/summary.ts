/** Résumé lisible d'un bloc à partir du gabarit déclaré dans le registre. */
const COLLECTIONS: Record<string, string> = { characters: "Personnages", backgrounds: "Décors", animation: "Animation" };

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.length ? String(value.length) : "";
  if (typeof value === "object") {
    const o = value as { fr?: unknown; en?: unknown };
    return String(o.fr || o.en || "").replace(/<\/?mark>/g, "");
  }
  if (typeof value === "string") return (Object.hasOwn(COLLECTIONS, value) ? COLLECTIONS[value] : undefined) ?? value;
  return String(value);
}

export function renderSummary(template: string, props: Record<string, unknown>): string {
  return template
    .split(" · ")
    .map((part) => {
      let empty = false;
      const text = part.replace(/\{([\w.]+)\}/g, (_, key: string) => {
        const v = display(key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], props));
        if (!v) empty = true;
        return v;
      });
      return empty ? "" : text.trim();
    })
    .filter(Boolean)
    .join(" · ");
}
