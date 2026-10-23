/** Date lisible d'une version (« 22 oct. à 14 h 20 »), en heure de Paris : le même texte côté serveur et dans le navigateur. */
export function formatWhen(ms: number): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} à ${get("hour")} h ${get("minute")}`;
}
