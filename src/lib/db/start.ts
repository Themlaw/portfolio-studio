/**
 * Démarrage (runtime nodejs) : migrations + seed, ou arrêt du processus.
 *
 * Un échec ici (volume non inscriptible, migration cassée…) arrête le
 * processus : mieux vaut un conteneur qui redémarre en boucle, visible, qu'un
 * serveur qui répond 500 sur toutes les pages.
 */
const MAX_ATTEMPTS = 8;

function isBusy(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

export async function start(): Promise<void> {
  try {
    const { bootstrap } = await import("./bootstrap");
    // Plusieurs processus sur une base neuve : le passage en WAL ou le
    // BEGIN IMMEDIATE peuvent renvoyer SQLITE_BUSY malgré busy_timeout.
    // On réessaie (tout est idempotent) avant de renoncer.
    for (let attempt = 1; ; attempt++) {
      try {
        await bootstrap();
        break;
      } catch (error) {
        if (!isBusy(error) || attempt >= MAX_ATTEMPTS) throw error;
        console.warn(`[db] base occupée (tentative ${attempt}/${MAX_ATTEMPTS}), nouvel essai…`);
        await new Promise((r) => setTimeout(r, 150 * attempt + Math.random() * 100));
      }
    }
  } catch (error) {
    console.error("[db] ÉCHEC du démarrage (migrations/seed) : arrêt du serveur.", error);
    process.exit(1);
  }
}
