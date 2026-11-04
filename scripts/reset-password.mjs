#!/usr/bin/env node
/**
 * Réinitialise le mot de passe d'un administrateur ET coupe toutes les sessions (audit de sécurité, P3 : procédure d'incident).
 * Fonctionne dans l'image de production (distroless : ni shell ni sqlite3) ; seule dépendance : better-sqlite3, déjà dans l'image.
 *
 *   node reset-password.mjs <e-mail> [dossier-de-données]       (défaut : $DATA_DIR ou /data)
 *
 * Le nouveau mot de passe est lu sur l'entrée standard (une ligne, 8 à 128 caractères) ; sans entrée (ou ligne vide), un mot de
 * passe aléatoire est tiré et affiché UNE fois. Il n'est jamais passé en argument (il resterait dans l'historique et `ps`).
 * Exemples (site arrêté de préférence ; possible aussi site en marche, la base est en WAL) :
 *   docker compose run --rm --no-deps -T --entrypoint /nodejs/bin/node portfolio reset-password.mjs moi@exemple.fr < /dev/null
 *   printf '%s\n' 'ma nouvelle phrase de passe' | docker compose run --rm --no-deps -T --entrypoint /nodejs/bin/node portfolio reset-password.mjs moi@exemple.fr
 *
 * Effets, dans une transaction : empreinte scrypt au format de Better Auth (`sel:clé`, N=16384, r=16, p=1, 64 octets, mot de
 * passe NFKC) dans le compte « credential » de l'utilisateur (créé s'il n'existe pas) ; TOUTES les sessions supprimées (tous
 * les utilisateurs : en cas d'intrusion, personne ne garde une session ouverte) ; jetons de vérification supprimés ; délais
 * de connexion remis à zéro. Si l'admin ne se connecte que par Authentik (AUTH_PASSWORD_DISABLED), le mot de passe est
 * enregistré mais ne sert pas : couper les sessions reste utile.
 */
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 };

/** Même calcul que Better Auth (@better-auth/utils/password) : vérifiable par `verifyPassword` de better-auth/crypto. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, SCRYPT.dkLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 }, (err, key) => (err ? reject(err) : resolve(`${salt}:${key.toString("hex")}`))),
  );
}

/** Mot de passe tiré au hasard : 4 groupes de 5 caractères sans ambiguïté (≈ 100 bits). */
export function randomPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

async function readStdin() {
  if (process.stdin.isTTY) {
    process.stderr.write("Nouveau mot de passe (ligne vide = mot de passe aléatoire) : ");
  }
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.includes("\n") || data.length > 4096) break;
  }
  return data.split(/\r?\n/)[0];
}

export async function resetPassword(dataDir, email, password) {
  const db = new Database(path.join(dataDir, "portfolio.db"), { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const user = db.prepare("select id, email from user where lower(email) = lower(?)").get(email.trim());
    if (!user) {
      const known = db.prepare("select email from user order by created_at").all().map((u) => u.email);
      throw new Error(`aucun utilisateur « ${email} »${known.length ? ` (comptes : ${known.join(", ")})` : " (aucun compte)"}`);
    }
    const hash = await hashPassword(password);
    const now = Date.now();
    const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((t) => t.name));
    let sessions = 0;
    db.transaction(() => {
      const account = db.prepare("select id from account where user_id = ? and provider_id = 'credential'").get(user.id);
      if (account) db.prepare("update account set password = ?, updated_at = ? where id = ?").run(hash, now, account.id);
      else db.prepare("insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, ?, ?)").run(randomUUID(), user.id, user.id, hash, now, now);
      sessions = db.prepare("delete from session").run().changes;
      if (tables.has("verification")) db.prepare("delete from verification").run();
      if (tables.has("auth_throttle")) db.prepare("delete from auth_throttle").run();
    })();
    return { email: user.email, sessions };
  } finally {
    db.close();
  }
}

async function main() {
  const [email, dir] = process.argv.slice(2);
  if (!email || email.startsWith("-")) {
    console.error("Usage : node reset-password.mjs <e-mail> [dossier-de-données]  (nouveau mot de passe sur l'entrée standard)");
    process.exit(2);
  }
  const dataDir = dir ?? process.env.DATA_DIR ?? "/data";
  let password = (await readStdin()).trim();
  const generated = password === "";
  if (generated) password = randomPassword();
  if (password.length < 8 || password.length > 128) {
    console.error("Mot de passe refusé : entre 8 et 128 caractères.");
    process.exit(2);
  }
  try {
    const r = await resetPassword(dataDir, email, password);
    console.log(`Mot de passe de ${r.email} réinitialisé ; ${r.sessions} session(s) coupée(s) : tout le monde doit se reconnecter.`);
    if (generated) console.log(`Nouveau mot de passe (affiché une seule fois, change-le ensuite dans Admin → Sécurité du compte) : ${password}`);
  } catch (error) {
    console.error(`Échec : ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
