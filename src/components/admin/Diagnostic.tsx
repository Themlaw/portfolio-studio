import { headers } from "next/headers";

import { clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { backupSummary } from "@/lib/backup/status";

/**
 * Diagnostic réseau (admins) : IP vue par l'app et en-têtes X-Forwarded-*
 * reçus, pour régler AUTH_TRUSTED_PROXY_HOPS derrière Pangolin/Newt.
 */
export default async function Diagnostic() {
  const h = await headers();
  const config = readAuthConfig();
  const xff = h.get("x-forwarded-for");
  const ip = clientIpFromForwarded(xff, config.trustedProxyHops) ?? UNKNOWN_IP;
  const rows: [string, string | null][] = [
    ["IP client retenue", ip === UNKNOWN_IP ? null : ip],
    ["AUTH_TRUSTED_PROXY_HOPS", String(config.trustedProxyHops)],
    ["X-Forwarded-For", xff],
    ["X-Forwarded-Proto", h.get("x-forwarded-proto")],
    ["X-Forwarded-Host", h.get("x-forwarded-host")],
    ["X-Real-IP", h.get("x-real-ip")],
    ["Host", h.get("host")],
    ["URL publique (PUBLIC_BASE_URL)", config.baseURL],
  ];
  const backup = backupSummary();
  if (backup) rows.push(["Dernière sauvegarde", backup]);
  return (
    <section className="a-section" aria-labelledby="diagnostic">
      <h2 id="diagnostic">Diagnostic</h2>
      <p className="muted" style={{ marginBottom: 10, maxWidth: "70ch" }}>
        Ce que le site voit de ta connexion. L&apos;IP retenue doit être la tienne (et non celle d&apos;un proxy) : c&apos;est
        elle qui sert à limiter les tentatives de connexion. Si ce n&apos;est pas le cas, ajuste AUTH_TRUSTED_PROXY_HOPS
        (nombre de proxys de confiance devant le site).
      </p>
      <div className="a-table-wrap">
        <dl className="a-dl">
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd className="mono">{value ?? <span className="muted">absent</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
