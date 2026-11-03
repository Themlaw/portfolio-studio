import Link from "next/link";

import PageHeader from "@/components/admin/PageHeader";
import { facets, listEntries, RESULT_LABELS, TYPE_LABELS, type Entry, type Filters } from "@/lib/journal/store";

export const metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

const PER_PAGE = 100;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const when = (t: number) => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" });
/** Décalage de Paris (minutes) à un instant donné : minuit heure de Paris, été comme hiver. */
function parisOffsetMin(t: number): number {
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
  return m ? Number(m[1]) * 60 + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) : 0) : 60;
}
const dayStart = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return utc - parisOffsetMin(utc) * 60_000;
};

type Change = { p: string; a?: string; b?: string; note?: string };
type Summary = { changes?: Change[]; total?: number; reason?: string } | null;

function ChangeLine({ c }: { c: Change }) {
  return (
    <li>
      <code>{c.p}</code>
      {c.a !== undefined && c.b !== undefined ? <> : « {c.a} » → « {c.b} »</> : c.b !== undefined ? <> : « {c.b} »</> : c.a !== undefined ? <> : « {c.a} » retiré</> : null}
      {c.note ? <> ({c.note})</> : null}
    </li>
  );
}

function EntryRow({ e }: { e: Entry }) {
  const summary = e.summary as Summary;
  const changes = summary?.changes ?? [];
  const hidden = Math.max(0, (summary?.total ?? 0) - changes.length);
  return (
    <details className="a-journal-entry" data-testid="journal-entry" data-result={e.result} data-type={e.type} data-action={e.action}>
      <summary>
        <time dateTime={new Date(e.t).toISOString()}>{when(e.t)}</time>
        <span className="a-journal-result" data-result={e.result}>
          {RESULT_LABELS[e.result]}
        </span>
        <span className="a-journal-label">{e.label}</span>
      </summary>
      <dl className="a-journal-details">
        <dt>Type</dt>
        <dd>{TYPE_LABELS[e.type] ?? e.type}</dd>
        {e.page && (
          <>
            <dt>Page</dt>
            <dd>{e.page}</dd>
          </>
        )}
        {e.target && e.target !== e.page && (
          <>
            <dt>Cible</dt>
            <dd>{e.target}</dd>
          </>
        )}
        {(e.revFrom !== null || e.revTo !== null) && (
          <>
            <dt>Version de la page</dt>
            <dd>
              {e.revFrom ?? "?"} → {e.revTo ?? "?"}
            </dd>
          </>
        )}
        <dt>Compte</dt>
        <dd>{e.user ?? "inconnu"}</dd>
        {e.ms !== null && (
          <>
            <dt>Durée</dt>
            <dd>{String(e.ms).replace(".", ",")} ms</dd>
          </>
        )}
        <dt>Version du site</dt>
        <dd>{e.version}</dd>
        <dt>Nom technique</dt>
        <dd>
          <code>{e.action}</code>
        </dd>
        {summary?.reason && (
          <>
            <dt>Raison</dt>
            <dd>{summary.reason}</dd>
          </>
        )}
        {changes.length > 0 && (
          <>
            <dt>Ce qui change</dt>
            <dd>
              <ul>
                {changes.map((c, i) => (
                  <ChangeLine key={i} c={c} />
                ))}
                {hidden > 0 && <li>… et {hidden} autre(s)</li>}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}

/** Journal d'édition (lot 97) : qui a modifié quoi, quand, avec quel résultat. Lecture seule, filtres par un formulaire GET. */
export default async function JournalPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const pageRaw = one(q.page);
  const type = one(q.type);
  const result = one(q.resultat);
  const du = one(q.du);
  const au = one(q.au);
  const p = Math.max(1, Number(one(q.p)) || 1);
  const from = dayStart(du);
  const toStart = dayStart(au);
  const filters: Filters = {
    pageId: pageRaw === "none" ? "none" : Number(pageRaw) > 0 ? Number(pageRaw) : null,
    type: type || null,
    result: result || null,
    from,
    to: toStart === null ? null : toStart + 86_400_000,
  };
  const f = facets();
  const { rows, total } = listEntries(filters, PER_PAGE, (p - 1) * PER_PAGE);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (n: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ page: pageRaw, type, resultat: result, du, au })) if (v) u.set(k, v);
    if (n > 1) u.set("p", String(n));
    const s = u.toString();
    return `/admin/journal${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Journal"
        intro="Tout ce qui a été modifié sur le site : quand, depuis quelle page, avec quel résultat. Les erreurs vues dans ton navigateur y sont aussi. On garde 30 jours (20 000 lignes au plus). Aucun mot de passe, e-mail ni contenu d'image n'y est écrit."
        action={
          <Link className="a-btn" href="/admin/reglages">
            Retour aux réglages
          </Link>
        }
      />
      <form method="get" className="a-journal-filters" data-testid="journal-filters">
        <label>
          Page
          <select name="page" defaultValue={pageRaw} className="a-select">
            <option value="">Toutes</option>
            <option value="none">Hors page (réglages, thèmes, médiathèque…)</option>
            {f.pages.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue={type} className="a-select">
            <option value="">Tous</option>
            {f.types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t as keyof typeof TYPE_LABELS] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Résultat
          <select name="resultat" defaultValue={result} className="a-select">
            <option value="">Tous</option>
            {Object.entries(RESULT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Du
          <input type="date" name="du" defaultValue={du} className="a-input" />
        </label>
        <label>
          Au
          <input type="date" name="au" defaultValue={au} className="a-input" />
        </label>
        <button type="submit" className="a-btn a-btn-primary">
          Filtrer
        </button>
        <Link className="a-btn" href="/admin/journal">
          Tout afficher
        </Link>
      </form>
      <p className="a-journal-count" data-testid="journal-count" data-total={total}>
        {total === 0 ? "Aucune entrée pour ces filtres." : `${total} entrée${total > 1 ? "s" : ""}${pages > 1 ? ` — page ${p} sur ${pages}` : ""}`}
      </p>
      <section className="a-journal-list" aria-label="Entrées du journal">
        {rows.map((e) => (
          <EntryRow key={e.id} e={e} />
        ))}
      </section>
      {pages > 1 && (
        <nav className="a-journal-pager" aria-label="Pages du journal">
          {p > 1 && (
            <Link className="a-btn" href={qs(p - 1)}>
              Plus récentes
            </Link>
          )}
          {p < pages && (
            <Link className="a-btn" href={qs(p + 1)}>
              Plus anciennes
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
