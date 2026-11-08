/**
 * Jeton d'envoi du formulaire de contact (docs/SECURITE.md §2.3). Les pages
 * publiques sont en cache ISR : le jeton ne peut pas être écrit dans le HTML,
 * le formulaire le demande ici à l'affichage (réponse jamais mise en cache).
 * GET /api/contact/token?form=<formId> → { token, minDelayMs }. Aucune lecture
 * de la base : le formulaire est vérifié à l'envoi.
 */
import { issueContactToken, MIN_DELAY_MS } from "@/lib/contact-guard";

export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export function GET(req: Request): Response {
  const form = new URL(req.url).searchParams.get("form") ?? "";
  if (!/^[a-z0-9]{6,32}$/.test(form)) return new Response(JSON.stringify({ ok: false, error: "Formulaire invalide." }), { status: 400, headers });
  return new Response(JSON.stringify({ ok: true, token: issueContactToken(form), minDelayMs: MIN_DELAY_MS }), { status: 200, headers });
}
