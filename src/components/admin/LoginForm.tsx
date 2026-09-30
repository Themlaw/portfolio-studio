"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { authClient } from "@/lib/auth/client";

/** Messages précis par code d'erreur Better Auth (jamais un message générique). */
function passwordError(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429) return "Trop de tentatives. Attends une minute avant de réessayer.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Identifiants incorrects.";
    case "INVALID_EMAIL":
      return "Cette adresse e-mail n'est pas valide.";
    case "PASSWORD_TOO_SHORT":
      return "Mot de passe trop court.";
    case "EMAIL_PASSWORD_DISABLED":
    case "PASSWORD_DISABLED":
      return "La connexion par mot de passe est désactivée : utilise Authentik.";
    case "ACCOUNT_THROTTLED":
      return error.message ?? "Trop d'échecs pour ce compte : attends quelques secondes avant de réessayer.";
    default:
      return "La connexion a échoué. Réessaie, ou utilise l'autre méthode.";
  }
}

export default function LoginForm({
  oidc,
  password,
  initialError,
}: {
  oidc: boolean;
  password: boolean;
  initialError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  // Avant hydratation, aucun envoi possible : un envoi natif du formulaire
  // mettrait le mot de passe dans l'URL (GET) ou dans les journaux.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  async function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    setPending(false);
    if (error) {
      setError(passwordError(error));
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  async function onAuthentik() {
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.social({
      provider: "authentik",
      callbackURL: "/admin",
      errorCallbackURL: "/admin/connexion",
    });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Trop de tentatives. Attends une minute avant de réessayer."
          : `Authentik est injoignable pour l'instant (code ${error.status ?? "?"}).`,
      );
    }
  }

  return (
    <div>
      {/* Zone d'erreur au-dessus des champs, annoncée aux lecteurs d'écran. */}
      <div className="a-login-status" role="alert" aria-live="assertive">
        {error && <p className="a-alert">{error}</p>}
      </div>
      {oidc && (
        <button type="button" className="a-btn a-btn-primary a-btn-block" onClick={onAuthentik} disabled={pending || !ready}>
          Se connecter avec Authentik
        </button>
      )}
      {oidc && password && <div className="a-login-sep">ou</div>}
      {password && (
        <form method="post" onSubmit={onPassword} noValidate>
          <div className="a-field">
            <label htmlFor="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="a-input" />
          </div>
          <div className="a-field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="a-input" />
          </div>
          <button type="submit" className={`a-btn a-btn-block ${oidc ? "" : "a-btn-primary"}`} disabled={pending || !ready}>
            {pending ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      )}
      {!oidc && !password && <p className="a-alert">Aucune méthode de connexion n&apos;est configurée.</p>}
    </div>
  );
}
