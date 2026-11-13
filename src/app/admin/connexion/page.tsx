import { NextIntlClientProvider } from "next-intl";
import Link from "next/link";
import { redirect } from "next/navigation";

import LoginForm from "@/components/admin/LoginForm";
import { getSettingsForAdmin } from "@/lib/admin";
import { readAuthConfig } from "@/lib/auth/config";
import { getAdminSession } from "@/lib/auth/guard";
import { intlLocale } from "@/i18n/admin-lang";
import { getAdminLang, getAdminMessages, getAdminT } from "@/i18n/admin-server";
import { siteNameFor } from "@/lib/site-schema";

export async function generateMetadata() {
  return { title: (await getAdminT("login"))("title") };
}

/**
 * Messages des erreurs renvoyées par le retour OIDC (?error=<code>). Seuls ces
 * codes connus sont affichés ; aucun texte venu de l'URL n'est jamais repris.
 */
const OAUTH_ERRORS: Record<string, string> = {
  admin_not_allowed: "notAllowed",
  // Même message que admin_not_allowed : ne pas révéler qu'un compte existe
  // déjà avec cet e-mail (le code distinct reste dans les journaux serveur).
  account_not_linked: "notAllowed",
  email_not_verified: "emailNotVerified",
  email_not_found: "emailNotFound",
  state_mismatch: "stateMismatch",
  invalid_code: "invalidCode",
  unable_to_get_user_info: "userInfo",
  please_restart_the_process: "restart",
};

const UNKNOWN_ERROR = "failed";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdminSession()) redirect("/admin");
  const { error } = await searchParams;
  const t = await getAdminT("login");
  const config = readAuthConfig();
  const site = getSettingsForAdmin();
  const initialError = error ? t(Object.hasOwn(OAUTH_ERRORS, error) ? OAUTH_ERRORS[error] : UNKNOWN_ERROR) : null;

  // Sans session, le layout ne fournit aucun catalogue : l'écran de connexion n'embarque que les textes de la méthode active
  // (rien d'Authentik quand seul le mot de passe est activé, rien du formulaire quand seul Authentik l'est).
  const AUTHENTIK_KEYS = ["notAllowed", "emailNotVerified", "emailNotFound", "stateMismatch", "invalidCode", "userInfo", "restart", "authentikDown", "withAuthentik"];
  const PASSWORD_KEYS = ["email", "password", "signingIn", "signIn", "badCredentials", "invalidEmail", "passwordTooShort", "throttled"];
  const drop = [...(config.oidc ? [] : [...AUTHENTIK_KEYS, "passwordDisabled"]), ...(config.passwordEnabled ? [] : PASSWORD_KEYS)];
  const full = ((await getAdminMessages()) as { login?: Record<string, string> }).login ?? {};
  const loginMessages = Object.fromEntries(Object.entries(full).filter(([k]) => !drop.includes(k)));
  const lang = await getAdminLang();
  return (
    <NextIntlClientProvider locale={intlLocale(lang)} messages={{ login: loginMessages }}>
    <main className="a-login">
      <div className="a-login-card">
        <span className="a-brand">
          {siteNameFor(site.site.name, "fr") || "Portfolio"}
          <small>{t("administration")}</small>
        </span>
        <h1>{t("title")}</h1>
        <p className="muted">{t("intro")}</p>
        <LoginForm oidc={Boolean(config.oidc)} password={config.passwordEnabled} initialError={initialError} />
        <p className="a-login-foot">
          <Link href="/">{t("backToSite")}</Link>
        </p>
      </div>
    </main>
    </NextIntlClientProvider>
  );
}
