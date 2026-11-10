import { headers } from "next/headers";

import { getAdminT } from "@/i18n/admin-server";
import { clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { backupSummary } from "@/lib/backup/status";
import { readRedirectConfig } from "@/lib/domain";

/**
 * Diagnostic réseau (admins) : IP vue par l'app et en-têtes X-Forwarded-*
 * reçus, pour régler AUTH_TRUSTED_PROXY_HOPS derrière Pangolin/Newt.
 */
export default async function Diagnostic() {
  const t = await getAdminT("diagnostic");
  const h = await headers();
  const config = readAuthConfig();
  const xff = h.get("x-forwarded-for");
  const ip = clientIpFromForwarded(xff, config.trustedProxyHops) ?? UNKNOWN_IP;
  const rows: [string, string | null][] = [
    [t("clientIp"), ip === UNKNOWN_IP ? null : ip],
    ["AUTH_TRUSTED_PROXY_HOPS", String(config.trustedProxyHops)],
    ["X-Forwarded-For", xff],
    ["X-Forwarded-Proto", h.get("x-forwarded-proto")],
    ["X-Forwarded-Host", h.get("x-forwarded-host")],
    ["X-Real-IP", h.get("x-real-ip")],
    ["Host", h.get("host")],
    [t("publicUrl"), config.baseURL],
  ];
  // Anciens domaines (REDIRECT_FROM, lot 88) : ceux qui renvoient vers l'adresse principale, et ce qui a été corrigé ou ignoré.
  const redirects = readRedirectConfig();
  rows.push([t("redirectedDomains"), redirects.hosts.length ? redirects.hosts.join(", ") : t("none")]);
  for (const problem of [...redirects.errors, ...redirects.warnings]) rows.push([t("domainToFix"), problem]);
  const backup = backupSummary();
  if (backup) rows.push([t("lastBackup"), backup]);
  return (
    <section className="a-section" aria-labelledby="diagnostic">
      <h2 id="diagnostic">{t("title")}</h2>
      <p className="muted" style={{ marginBottom: 10, maxWidth: "70ch" }}>
        {t("intro")}
      </p>
      <div className="a-table-wrap">
        <dl className="a-dl">
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd className="mono">{value ?? <span className="muted">{t("absent")}</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
