/**
 * Instantané de sauvegarde SANS secrets d'authentification (audit de sécurité, P2). Appliqué à la copie de la base, jamais à
 * la base du site.
 *
 * Une archive téléchargée (ou copiée hors du serveur) ne doit pas donner d'accès durable :
 *  - `session` vidée : jetons de session (le cookie est signé par BETTER_AUTH_SECRET, absent de la base, mais rien ne sert de
 *    les garder) ; après une restauration, il suffit de se reconnecter ;
 *  - `verification` vidée : jetons de réinitialisation et états OAuth en cours (de courte durée, inutiles après une restauration) ;
 *  - `rate_limit` vidée : compteurs de Better Auth (adresses IP, rien à restaurer) ;
 *  - `account` : colonnes de jetons OAuth (Authentik) effacées. Le site ne les lit jamais (l'accès est revérifié par
 *    `oidc_identity`) ; une nouvelle connexion les réécrit. L'empreinte scrypt du mot de passe RESTE (sinon une restauration
 *    enfermerait l'admin dehors) : le téléchargement est donc protégé par une nouvelle saisie du mot de passe (unlock.ts).
 * La base est ensuite réécrite (VACUUM, `secure_delete`) : les lignes supprimées ne traînent pas dans des pages libres du fichier.
 * Tolérant : une table ou une colonne absente (ancienne base, base de test) est ignorée.
 */
import Database from "better-sqlite3";

export const SCRUBBED_TABLES = ["session", "verification", "rate_limit"] as const;
export const ACCOUNT_TOKEN_COLUMNS = ["access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at"] as const;

export type ScrubReport = { rows: Record<string, number>; accounts: number };

export function scrubSecrets(file: string): ScrubReport {
  const db = new Database(file);
  try {
    // La copie hérite du mode WAL de la base du site : on revient au journal classique (aucun -wal laissé à côté de l'archive).
    db.pragma("journal_mode = DELETE");
    db.pragma("secure_delete = ON");
    const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const report: ScrubReport = { rows: {}, accounts: 0 };
    db.transaction(() => {
      for (const t of SCRUBBED_TABLES) if (tables.has(t)) report.rows[t] = db.prepare(`delete from "${t}"`).run().changes;
      if (tables.has("account")) {
        const have = new Set((db.prepare(`pragma table_info("account")`).all() as { name: string }[]).map((c) => c.name));
        const cols = ACCOUNT_TOKEN_COLUMNS.filter((c) => have.has(c));
        if (cols.length) report.accounts = db.prepare(`update "account" set ${cols.map((c) => `"${c}" = null`).join(", ")} where ${cols.map((c) => `"${c}" is not null`).join(" or ")}`).run().changes;
      }
    })();
    db.exec("VACUUM");
    return report;
  } finally {
    db.close();
  }
}
