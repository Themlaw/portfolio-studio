/**
 * Contrôle de démarrage : DATA_DIR (et ses sous-dossiers) doit être inscriptible
 * par l'utilisateur du processus (1000:1000 dans l'image).
 *
 * Cas visé : un volume ou un dossier monté créé par root (Komodo, bind mount)
 * avant le premier démarrage. Docker n'initialise avec les propriétaires de
 * l'image QUE les volumes nommés vides ; sinon le processus ne peut rien écrire.
 * Plutôt qu'une erreur SQLite obscure, on s'arrête avec la commande exacte.
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Premier chemin non inscriptible (et son code d'erreur), ou null. */
export function dataWriteProblem(dir: string): { path: string; code: string } | null {
  for (const d of [dir, path.join(dir, "media"), path.join(dir, "tmp")]) {
    try {
      mkdirSync(d, { recursive: true });
      const probe = path.join(d, `.ecriture-${process.pid}`);
      writeFileSync(probe, "");
      rmSync(probe);
    } catch (error) {
      return { path: d, code: (error as NodeJS.ErrnoException).code ?? String(error) };
    }
  }
  // Base existante créée par un autre utilisateur : ouverte en lecture seule
  // par SQLite, elle échouerait à la première écriture.
  for (const f of ["portfolio.db", "portfolio.db-wal", "portfolio.db-shm"]) {
    const file = path.join(dir, f);
    if (!existsSync(file)) continue;
    try {
      accessSync(file, constants.R_OK | constants.W_OK);
    } catch (error) {
      return { path: file, code: (error as NodeJS.ErrnoException).code ?? String(error) };
    }
  }
  return null;
}

/**
 * Origine du montage de `dir` d'après /proc/self/mountinfo : nom du volume
 * Docker (…/volumes/<nom>/_data) ou chemin du dossier hôte (bind mount).
 * Indicatif : null si rien n'est reconnaissable.
 */
export function mountSource(dir: string): { volume?: string; hostPath?: string } | null {
  try {
    for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
      const fields = line.split(" ");
      if (fields[4] !== dir) continue;
      const root = fields[3].replace(/\\040/g, " ");
      const volume = /\/volumes\/([^/]+)\/_data$/.exec(root)?.[1];
      if (volume) return { volume };
      if (root !== "/") return { hostPath: root };
    }
  } catch {
    // hors Linux, ou /proc absent
  }
  return null;
}

/** Message d'arrêt : cause, puis commande de réparation à copier. */
export function dataWriteMessage(dir: string, problem: { path: string; code: string }): string {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const source = mountSource(dir);
  const volume = source?.volume ?? "<volume>";
  const lines = [
    `[data] ÉCHEC du démarrage : ${problem.path} n'est pas inscriptible par l'utilisateur ${uid}:${gid} (${problem.code}).`,
    `[data] Le volume ou le dossier monté sur ${dir} a sans doute été créé par root (Komodo, bind mount).`,
    `[data] Répare-le une fois, puis redémarre le conteneur :`,
  ];
  if (source?.hostPath) {
    lines.push(`[data]   dossier monté (bind) : sudo chown -R ${uid}:${gid} ${source.hostPath}`);
  } else {
    lines.push(`[data]   volume nommé : docker run --rm -v ${volume}:${dir} alpine chown -R ${uid}:${gid} ${dir}`);
    lines.push(`[data]   dossier monté (bind) : sudo chown -R ${uid}:${gid} <dossier sur l'hôte>`);
  }
  lines.push(`[data]   avec le docker-compose.yml du dépôt : docker compose --profile setup run --rm fix-permissions`);
  return lines.join("\n");
}
