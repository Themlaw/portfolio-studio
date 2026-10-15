/**
 * Envoi du formulaire de contact (bloc « contact-form », v0.13). Public, hors
 * du proxy (matcher : /api exclu). Garde-fous :
 * - même origine (Sec-Fetch-Site, sinon Origin = hôte). Ce n'est PAS une
 *   protection contre un script (qui forge ces en-têtes) : seulement contre un
 *   formulaire d'un autre site. La protection, ce sont les limites ci-dessous ;
 * - JSON ; corps refusé d'entrée si Content-Length > 32 Ko, puis lu en flux en
 *   comptant les OCTETS et coupé dès le dépassement (413), jamais lu en entier ;
 * - formulaire désigné par son identifiant stable (`formId`, gardé d'une
 *   publication à l'autre), sur une page PUBLIÉE ; l'envoi est validé contre
 *   SA définition publiée (src/lib/contact-form.ts) ;
 * - champ piège rempli → réponse « reçu », rien d'enregistré ;
 * - limites : 5 envois / 10 min par client (IP calculée comme l'auth : N
 *   proxys de confiance, AUTH_TRUSTED_PROXY_HOPS — la partie gauche de
 *   X-Forwarded-For, inventable, est ignorée), 60 / heure tous clients
 *   confondus, 2 000 messages gardés au plus (au-delà : 503, signalé dans
 *   l'admin) ; messages de plus d'un an purgés à chaque envoi.
 * Pas de serveur d'envoi d'e-mail : le message est rangé (Admin → Messages).
 */
import { createHash } from "node:crypto";

import { and, count, eq, gt, inArray, isNull, lt } from "drizzle-orm";

import { readAuthConfig } from "@/lib/auth/config";
import { clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { ContactFormSchema, FORM_BLOCK_TYPES, isFormBlock, MESSAGES_CAP, validateSubmission } from "@/lib/contact-form";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;
const WINDOW_S = 600;
const MAX_PER_CLIENT = 5;
const MAX_PER_HOUR = 60;
/** Messages gardés au plus (boîte pleine : 503 et avertissement dans l'admin). */
const MAX_MESSAGES = MESSAGES_CAP;
const KEEP_DAYS = 365;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

/** Empreinte de l'IP client (calculée comme pour l'authentification). */
function ipHash(req: Request): string {
  const ip = clientIpFromForwarded(req.headers.get("x-forwarded-for"), readAuthConfig().trustedProxyHops) ?? UNKNOWN_IP;
  return createHash("sha256").update(`contact:${ip}`).digest("hex").slice(0, 32);
}

/** Corps lu en flux, coupé dès que MAX_BODY octets sont dépassés ; null si trop gros. */
async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Formulaire publié désigné par son identifiant stable. */
function findForm(formId: string) {
  const rows = getDb()
    .select({ id: schema.blocks.id, props: schema.blocks.props, pageId: schema.blocks.pageId, type: schema.blocks.type })
    .from(schema.blocks)
    .innerJoin(schema.pages, eq(schema.blocks.pageId, schema.pages.id))
    .where(and(inArray(schema.blocks.type, [...FORM_BLOCK_TYPES]), eq(schema.pages.published, true), isNull(schema.pages.deletedAt)))
    .all();
  for (const row of rows) {
    const props = parseJson(row.props);
    // « Contact » sans l'option formulaire : aucun formulaire à désigner (même si des champs traînent dans ses réglages).
    if (!isFormBlock(row.type, props)) continue;
    const form = ContactFormSchema.safeParse(props);
    if (form.success && form.data.formId === formId) return { ...row, form: form.data };
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { ok: false, error: "Origine refusée." });
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json(415, { ok: false, error: "JSON attendu." });
  const text = await readBody(req);
  if (text === null) return json(413, { ok: false, error: "Envoi trop lourd." });
  const body = parseJson(text) as { form?: unknown; locale?: unknown; values?: unknown; website?: unknown } | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.form !== "string" || !/^[a-z0-9]{6,32}$/.test(body.form))
    return json(400, { ok: false, error: "Envoi invalide." });
  const extra = Object.keys(body).filter((k) => !["form", "locale", "values", "website"].includes(k));
  if (extra.length) return json(400, { ok: false, error: "Envoi invalide." });
  const locale = body.locale === "en" ? "en" : "fr";

  const found = findForm(body.form);
  if (!found) return json(404, { ok: false, error: "Formulaire introuvable." });

  // Piège à robots : réponse normale, rien d'enregistré.
  if (typeof body.website === "string" && body.website.trim()) return json(200, { ok: true });

  const result = validateSubmission(found.form, body.values, locale);
  if (!result.ok) return json(400, { ok: false, error: result.error, ...(result.field ? { field: result.field } : {}) });

  const db = getDb();
  const now = Date.now();
  // Ménage : les messages de plus d'un an partent.
  db.delete(schema.messages).where(lt(schema.messages.createdAt, new Date(now - KEEP_DAYS * 86400_000))).run();
  const total = db.select({ n: count() }).from(schema.messages).get()?.n ?? 0;
  if (total >= MAX_MESSAGES) return json(503, { ok: false, error: "Boîte de messages pleine : réessaie plus tard." });
  const lastHour = db.select({ n: count() }).from(schema.messages).where(gt(schema.messages.createdAt, new Date(now - 3600_000))).get()?.n ?? 0;
  if (lastHour >= MAX_PER_HOUR) return json(429, { ok: false, error: "Trop d'envois en ce moment : réessaie dans une heure." });
  const hash = ipHash(req);
  const recent =
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(and(eq(schema.messages.ipHash, hash), gt(schema.messages.createdAt, new Date(now - WINDOW_S * 1000))))
      .get()?.n ?? 0;
  if (recent >= MAX_PER_CLIENT) return json(429, { ok: false, error: "Trop d'envois : réessaie dans quelques minutes." });

  db.insert(schema.messages)
    .values({
      pageId: found.pageId,
      blockId: found.id,
      subject: found.form.subject[locale] || found.form.subject.fr,
      fields: JSON.stringify(result.values.map(({ label, value }) => ({ label, value }))),
      replyTo: result.replyTo,
      ipHash: hash,
      createdAt: new Date(now),
    })
    .run();
  return json(200, { ok: true });
}
