/** Envoi au formulaire de contact public (avec jeton signé si le serveur en exige un : PR #23). */
import { BASE, http, sleep } from "./secuC.mjs";

export async function contactToken(form) {
  const r = await http(`/api/contact/token?form=${encodeURIComponent(form)}`);
  if (r.status !== 200) return null;
  const j = await r.json();
  return j.token ?? null;
}
/** Envoi : jeton demandé, délai minimal attendu (3 s) s'il y a un jeton ; `xff` = X-Forwarded-For tel que l'app le reçoit. */
export async function contactSend(form, values, { xff = "203.0.113.50", token, wait = true, body = {} } = {}) {
  const t = token === undefined ? await contactToken(form) : token;
  if (t && wait) await sleep(3200);
  const r = await http("/api/contact", { method: "POST", body: { form, locale: "fr", values, website: "", ...(t ? { token: t } : {}), ...body }, headers: { "x-forwarded-for": xff } });
  let json = null;
  try { json = await r.clone().json(); } catch {}
  return { status: r.status, json };
}
