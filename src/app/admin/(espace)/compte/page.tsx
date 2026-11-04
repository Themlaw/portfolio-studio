import AccountSecurity from "@/components/admin/AccountSecurity";
import PageHeader from "@/components/admin/PageHeader";
import { readAuthConfig } from "@/lib/auth/config";
import { requireAdmin } from "@/lib/auth/guard";
import { listUserSessions, SESSION_IDLE_S, SESSION_MAX_MS } from "@/lib/auth/sessions";

export const metadata = { title: "Sécurité du compte" };
export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await requireAdmin();
  return (
    <>
      <PageHeader
        title="Sécurité du compte"
        intro="Ton mot de passe et les appareils connectés à l'administration. Si tu as un doute (ordinateur perdu, connexion que tu ne reconnais pas), change ton mot de passe : tous les autres appareils sont déconnectés."
      />
      <AccountSecurity
        email={session.user.email}
        passwordEnabled={readAuthConfig().passwordEnabled}
        sessions={listUserSessions(session.user.id, session.session.id)}
        idleDays={SESSION_IDLE_S / 86_400}
        maxDays={SESSION_MAX_MS / 86_400_000}
      />
    </>
  );
}
