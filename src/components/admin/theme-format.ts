/** Date lisible d'une version (« 22 oct. à 14 h 20 » / « 22 Oct at 14:20 »), en heure de Paris : le même texte côté serveur et dans le navigateur. `locale` : la locale Intl de l'interface (fr-FR par défaut). */
export function formatWhen(ms: number, locale = "fr-FR"): string {
  const en = locale.startsWith("en");
  const parts = new Intl.DateTimeFormat(en ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return en ? `${get("day")} ${get("month")} at ${get("hour")}:${get("minute")}` : `${get("day")} ${get("month")} à ${get("hour")} h ${get("minute")}`;
}
