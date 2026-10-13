import Link from "next/link";
import { redirect } from "next/navigation";

import LoginForm from "@/components/admin/LoginForm";
import { getSettingsForAdmin } from "@/lib/admin";
import { readAuthConfig } from "@/lib/auth/config";
import { getAdminSession } from "@/lib/auth/guard";
import { siteNameFor } from "@/lib/site-schema";

export const metadata = { title: "Connexion" };

/**
 * Messages des erreurs renvoyées par le retour OIDC (?error=<code>). Seuls ces
 * codes connus sont affichés ; aucun texte venu de l'URL n'est jamais repris.
 */
const NOT_ALLOWED = "Ce compte Authentik n'est pas autorisé à administrer le site.";

const OAUTH_ERRORS: Record<string, string> = {
  admin_not_allowed: NOT_ALLOWED,
  // Même message que admin_not_allowed : ne pas révéler qu'un compte existe
  // déjà avec cet e-mail (le code distinct reste dans les journaux serveur).
  account_not_linked: NOT_ALLOWED,
  email_not_verified: "Authentik n'a pas vérifié l'adresse e-mail de ce compte.",
  email_not_found: "Authentik n'a pas transmis d'adresse e-mail pour ce compte.",
  state_mismatch: "La connexion Authentik a expiré ou a été ouverte dans un autre onglet. Recommence.",
  invalid_code: "Authentik a refusé le code de connexion. Recommence.",
  unable_to_get_user_info: "Impossible de lire ton profil Authentik. Vérifie la configuration du fournisseur.",
  please_restart_the_process: "La connexion Authentik a expiré. Recommence.",
};

const UNKNOWN_ERROR = "La connexion a échoué. Réessaie, ou utilise l'autre méthode.";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdminSession()) redirect("/admin");
  const { error } = await searchParams;
  const config = readAuthConfig();
  const site = getSettingsForAdmin();
  const initialError = error ? (Object.hasOwn(OAUTH_ERRORS, error) ? OAUTH_ERRORS[error] : UNKNOWN_ERROR) : null;

  return (
    <main className="a-login">
      <div className="a-login-card">
        <span className="a-brand">
          {siteNameFor(site.site.name, "fr") || "Portfolio"}
          <small>administration</small>
        </span>
        <h1>Connexion</h1>
        <p className="muted">Accès réservé à l&apos;administration du site.</p>
        <LoginForm oidc={Boolean(config.oidc)} password={config.passwordEnabled} initialError={initialError} />
        <p className="a-login-foot">
          <Link href="/">← Retour au site</Link>
        </p>
      </div>
    </main>
  );
}
