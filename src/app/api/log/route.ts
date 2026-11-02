/**
 * POST /api/log — erreurs du navigateur et échecs d'enregistrement de l'admin (lot 97).
 * Session admin obligatoire (401 sinon) et même origine ; corps JSON borné à 8 Ko ; 40 événements par minute et par utilisateur.
 * Les événements vont dans le journal d'édition (src/lib/journal). Réponse 204 : rien à lire côté navigateur.
 */
import { getAdminSession } from "@/lib/auth/guard";
import { allowClientEvent, ingestClientEvent, MAX_BODY_BYTES } from "@/lib/journal/client-events";
import { isSameOrigin } from "@/lib/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const status = (code: number, message?: string) =>
  message
    ? new Response(JSON.stringify({ ok: false, message }), { status: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })
    : new Response(null, { status: code, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return status(401, "Session requise.");
  if (!isSameOrigin(request)) return status(403, "Origine refusée.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return status(413, "Message trop gros.");
  if (!allowClientEvent(session.user.id)) return status(429, "Trop d'événements : réessaie dans une minute.");
  // Lecture bornée même sans Content-Length (flux).
  const reader = request.body?.getReader();
  if (!reader) return status(400, "Corps vide.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return status(413, "Message trop gros.");
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return status(400, "JSON invalide.");
  }
  return ingestClientEvent(session.user.id, body) ? status(204) : status(400, "Événement invalide.");
}
