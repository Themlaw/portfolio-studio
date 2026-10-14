/** Résultat d'une action d'édition de l'admin (sérialisable). */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export function fail(message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } {
  return { ok: false, message, fieldErrors };
}

export function done<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/** Erreurs zod → { "chemin.du.champ": "message" } (premier message par champ). */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[], prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] ??= frenchMessage(issue.message);
  }
  return out;
}

/** Messages zod usuels, en français et actionnables. */
function frenchMessage(message: string): string {
  if (/expected string, received undefined|Required/i.test(message)) return "Ce champ est obligatoire.";
  if (/Too small|at least 1/i.test(message)) return "Ce champ ne peut pas être vide.";
  if (/Invalid email/i.test(message)) return "Adresse e-mail invalide (ex. nom@domaine.fr).";
  if (/Invalid url|Invalid URL/i.test(message)) return "Adresse web invalide (ex. https://…).";
  if (/Too big|at most \d+|<=\s*\d+/i.test(message)) return "Ce texte est trop long : raccourcis-le.";
  if (/Invalid option|Invalid input|expected .* received/i.test(message)) return "Valeur incorrecte : vérifie ce champ.";
  return message;
}
