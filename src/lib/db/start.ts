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
  // Configuration de l'authentification : avertissements, puis refus net de
  // démarrer sans secret valable (hors du mode développement explicite PORTFOLIO_DEV=1, src/lib/dev-mode.ts).
  const { readAuthConfig } = await import("../auth/config");
  const authConfig = readAuthConfig();
  for (const warning of authConfig.warnings) console.warn(`[auth] ${warning}`);
  if (authConfig.secretError) {
    console.error(
      `[auth] ÉCHEC du démarrage : ${authConfig.secretError}. Génère-le avec « openssl rand -base64 48 » et passe-le en variable d'environnement.`,
    );
    process.exit(1);
  }

  // Volume inscriptible ? Sinon, arrêt avec la commande de réparation.
  const { dataDir } = await import("./index");
  const { dataWriteMessage, dataWriteProblem } = await import("./writable");
  const problem = dataWriteProblem(dataDir());
  if (problem) {
    console.error(dataWriteMessage(dataDir(), problem));
    process.exit(1);
  }

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
    // Projets créés dans un brouillon puis oubliés (plus cités, plus de 24 h).
    const { cleanupDraftProjects } = await import("../edit/draft-cleanup");
    const cleaned = cleanupDraftProjects();
    if (cleaned) console.log(`[db] ${cleaned} projet(s) en brouillon oublié(s) supprimé(s)`);
    const { ensureFirstAdmin } = await import("../auth/seed-admin");
    await ensureFirstAdmin();
    // Worker des traitements (images) : un job à la fois, reprise des orphelins.
    const { startWorker } = await import("../jobs/worker");
    await startWorker();
    // Journal d'édition (lot 97) : base à part (edit-log.db), ouverte et purgée ici ; jamais fatal.
    try {
      const { warmLog } = await import("../journal/store");
      console.log(`[journal] edit-log.db : ${warmLog()} entrée(s) (30 jours ou 20 000 lignes au plus)`);
    } catch (error) {
      console.error("[journal] initialisation en échec (le site démarre quand même) :", error);
    }
    // Sauvegardes (lot 50) : restauration détectée, puis sauvegardes automatiques si WITH_BACKUP=1. Jamais fatal.
    try {
      const { healRestoredMedia } = await import("../backup/restore");
      await healRestoredMedia();
      const { startBackups } = await import("../backup/service");
      await startBackups();
    } catch (error) {
      console.error("[backup] initialisation en échec (le site démarre quand même) :", error);
    }
  } catch (error) {
    console.error("[db] ÉCHEC du démarrage (migrations/seed/admin) : arrêt du serveur.", error);
    process.exit(1);
  }
}
