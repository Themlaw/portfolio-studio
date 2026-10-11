/**
 * POST /admin/api/themes/import — import d'un thème exporté (archive ZIP,
 * multipart, champ « file »). Admin connecté et même origine ; réception en
 * flux plafonnée (IMPORT_LIMITS.maxZipBytes) ; archive et contenu validés par
 * src/lib/themes/transfer.ts. Crée une copie non livrée, jamais mise en ligne.
 * Réponse JSON : { ok, theme: { id, name } } ou { ok: false, message }.
 */
import { readFile, rm } from "node:fs/promises";

import { assertAdmin } from "@/lib/auth/guard";
import { uploadTmpDir } from "@/lib/jobs/worker";
import { isSameOrigin } from "@/lib/preview";
import { revalidateTheme } from "@/lib/revalidate";
import { IMPORT_LIMITS, importThemePackage, ThemeImportError } from "@/lib/themes/transfer";
import { receiveOneFile, UploadError } from "@/lib/upload/receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  let tmpPath: string | null = null;
  try {
    const file = await receiveOneFile(request, uploadTmpDir(), { maxBytes: IMPORT_LIMITS.maxZipBytes });
    tmpPath = file.tmpPath;
    const theme = await importThemePackage(await readFile(file.tmpPath));
    revalidateTheme();
    return json(200, { ok: true, theme });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    if (error instanceof ThemeImportError) return json(422, { ok: false, message: `Import refusé : ${error.message}` });
    console.error("[themes] import en échec", error);
    return json(500, { ok: false, message: "L'import a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur." });
  } finally {
    if (tmpPath) await rm(tmpPath, { force: true });
  }
}
