import Link from "next/link";

import { getAdminT } from "@/i18n/admin-server";

/** 403 : action d'administration sans session valide. */
export default async function Forbidden() {
  const t = await getAdminT("forbidden");
  return (
    <main className="a-login">
      <div className="a-login-card">
        <h1>{t("title")}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {t("text")}
        </p>
        <p style={{ marginTop: 16 }}>
          <Link href="/admin/connexion" className="a-btn a-btn-primary">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
