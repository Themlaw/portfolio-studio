/**
 * Amorçage du premier administrateur : si AUCUN utilisateur n'existe et que
 * ADMIN_EMAIL + ADMIN_PASSWORD sont définis, crée le compte (mot de passe haché
 * par Better Auth). Idempotent ; le mot de passe n'apparaît jamais dans les logs.
 * Insertion directe (Drizzle) : le crochet validateUserInfo de Better Auth
 * exige un contexte de requête que le démarrage n'a pas.
 */
import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { count } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export async function ensureFirstAdmin(): Promise<void> {
  const db = getDb();
  const [{ n }] = db.select({ n: count() }).from(schema.user).all();
  if (n > 0) {
    if (process.env.ADMIN_PASSWORD) {
      console.warn(
        "[auth] ADMIN_PASSWORD ignoré : un administrateur existe déjà. Change le mot de passe depuis l'admin, et retire cette variable.",
      );
    }
    return;
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.warn(
      "[auth] aucun administrateur : définis ADMIN_EMAIL et ADMIN_PASSWORD (premier démarrage), ou connecte-toi avec Authentik (ADMIN_EMAILS / AUTH_ADMIN_GROUP).",
    );
    return;
  }
  if (password.length < 8) {
    console.error("[auth] ADMIN_PASSWORD trop court (8 caractères minimum) : administrateur non créé.");
    return;
  }

  const hash = await hashPassword(password);
  const now = new Date();
  const userId = randomUUID();
  try {
    db.transaction((tx) => {
      tx.insert(schema.user)
        .values({ id: userId, name: email.split("@")[0], email, emailVerified: true, createdAt: now, updatedAt: now })
        .run();
      tx.insert(schema.account)
        .values({
          id: randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: hash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    console.log(`[auth] premier administrateur créé : ${email}`);
  } catch (error) {
    // Démarrage concurrent : un autre processus l'a créé entre-temps.
    if (String(error).includes("UNIQUE")) return;
    throw error;
  }
}
