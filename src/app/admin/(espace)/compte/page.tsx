import AccountSecurity from "@/components/admin/AccountSecurity";
import PageHeader from "@/components/admin/PageHeader";
import { readAuthConfig } from "@/lib/auth/config";
import { getAdminLang, getAdminT } from "@/i18n/admin-server";
import { requireAdmin } from "@/lib/auth/guard";
import { listUserSessions, SESSION_IDLE_S, SESSION_MAX_MS } from "@/lib/auth/sessions";

export async function generateMetadata() {
  return { title: (await getAdminT("account"))("title") };
}
export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await requireAdmin();
  const t = await getAdminT("account");
  const lang = await getAdminLang();
  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
      />
      <AccountSecurity
        email={session.user.email}
        passwordEnabled={readAuthConfig().passwordEnabled}
        sessions={listUserSessions(session.user.id, session.session.id)}
        idleDays={SESSION_IDLE_S / 86_400}
        maxDays={SESSION_MAX_MS / 86_400_000}
        lang={lang}
      />
    </>
  );
}
