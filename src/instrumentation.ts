/**
 * Au démarrage du serveur Node : migrations + seed (src/lib/db/start.ts).
 * Jamais pendant `next build` : le build ne dépend d'aucune base. Le code
 * Node (process.exit, better-sqlite3) vit dans un module importé seulement
 * sur le runtime nodejs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { start } = await import("./lib/db/start");
  await start();
}
