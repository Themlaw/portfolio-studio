import Link from "next/link";

import PageHeader from "@/components/admin/PageHeader";
import { facets, listEntries, type Entry, type Filters } from "@/lib/journal/store";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminLang, getAdminT } from "@/i18n/admin-server";
import { intlLocale } from "@/i18n/admin-lang";

export async function generateMetadata() {
  return { title: (await getAdminT("journal"))("title") };
}
export const dynamic = "force-dynamic";

const PER_PAGE = 100;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Tr = (key: string, values?: Record<string, string | number | Date>) => string;
/** Date d'une entrée dans la langue de l'interface (heure de Paris). */
const makeWhen = (locale: string) => {
  const f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" });
  return (t: number) => f.format(new Date(t));
};
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

function ChangeLine({ c, t }: { c: Change; t: Tr }) {
  return (
    <li>
      <code>{c.p}</code>
      {c.a !== undefined && c.b !== undefined ? t("changeBoth", { a: c.a, b: c.b }) : c.b !== undefined ? t("changeTo", { b: c.b }) : c.a !== undefined ? t("changeRemoved", { a: c.a }) : null}
      {c.note ? t("changeNote", { note: c.note }) : null}
    </li>
  );
}

function EntryRow({ e, t, when, locale }: { e: Entry; t: Tr; when: (t: number) => string; locale: string }) {
  const summary = e.summary as Summary;
  const changes = summary?.changes ?? [];
  const hidden = Math.max(0, (summary?.total ?? 0) - changes.length);
  return (
    <details className="a-journal-entry" data-testid="journal-entry" data-result={e.result} data-type={e.type} data-action={e.action}>
      <summary>
        <time dateTime={new Date(e.t).toISOString()}>{when(e.t)}</time>
        <span className="a-journal-result" data-result={e.result}>
          {t(`result_${e.result}`)}
        </span>
        <span className="a-journal-label">{e.label}</span>
      </summary>
      <dl className="a-journal-details">
        <dt>{t("dType")}</dt>
        <dd>{t(`type_${e.type}`) ?? e.type}</dd>
        {e.page && (
          <>
            <dt>{t("dPage")}</dt>
            <dd>{e.page}</dd>
          </>
        )}
        {e.target && e.target !== e.page && (
          <>
            <dt>{t("dTarget")}</dt>
            <dd>{e.target}</dd>
          </>
        )}
        {(e.revFrom !== null || e.revTo !== null) && (
          <>
            <dt>{t("dPageVersion")}</dt>
            <dd>
              {e.revFrom ?? "?"} → {e.revTo ?? "?"}
            </dd>
          </>
        )}
        <dt>{t("dAccount")}</dt>
        <dd>{e.user ?? t("unknownUser")}</dd>
        {e.ms !== null && (
          <>
            <dt>{t("dDuration")}</dt>
            <dd>{new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(e.ms)} ms</dd>
          </>
        )}
        <dt>{t("dSiteVersion")}</dt>
        <dd>{e.version}</dd>
        <dt>{t("dTechName")}</dt>
        <dd>
          <code>{e.action}</code>
        </dd>
        {summary?.reason && (
          <>
            <dt>{t("dReason")}</dt>
            <dd>{summary.reason}</dd>
          </>
        )}
        {changes.length > 0 && (
          <>
            <dt>{t("dChanges")}</dt>
            <dd>
              <ul>
                {changes.map((c, i) => (
                  <ChangeLine key={i} c={c} t={t} />
                ))}
                {hidden > 0 && <li>{t("moreChanges", { hidden })}</li>}
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
  await requireAdmin();
  const t = await getAdminT("journal");
  const locale = intlLocale(await getAdminLang());
  const when = makeWhen(locale);
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
        title={t("title")}
        intro={t("intro")}
        action={
          <Link className="a-btn" href="/admin/reglages">
            {t("backToSettings")}
          </Link>
        }
      />
      <form method="get" className="a-journal-filters" data-testid="journal-filters">
        <label>
          {t("fPage")}
          <select name="page" defaultValue={pageRaw} className="a-select">
            <option value="">{t("optAllF")}</option>
            <option value="none">{t("optNoPage")}</option>
            {f.pages.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("fType")}
          <select name="type" defaultValue={type} className="a-select">
            <option value="">{t("optAllM")}</option>
            {f.types.map((t) => (
              <option key={t} value={t}>
                {t(`type_${t}`) ?? t}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("fResult")}
          <select name="resultat" defaultValue={result} className="a-select">
            <option value="">{t("optAllM")}</option>
            {(["ok","refus","conflit","erreur"]).map((k) => (
              <option key={k} value={k}>
                {t(`result_${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("fFrom")}
          <input type="date" name="du" defaultValue={du} className="a-input" />
        </label>
        <label>
          {t("fTo")}
          <input type="date" name="au" defaultValue={au} className="a-input" />
        </label>
        <button type="submit" className="a-btn a-btn-primary">
          {t("filter")}
        </button>
        <Link className="a-btn" href="/admin/journal">
          {t("showAll")}
        </Link>
      </form>
      <p className="a-journal-count" data-testid="journal-count" data-total={total}>
        {total === 0 ? t("noEntries") : pages > 1 ? t("countPages", { count: t("count", { n: total }), p, pages }) : t("count", { n: total })}
      </p>
      <section className="a-journal-list" aria-label={t("listLabel")}>
        {rows.map((e) => (
          <EntryRow key={e.id} e={e} t={t} when={when} locale={locale} />
        ))}
      </section>
      {pages > 1 && (
        <nav className="a-journal-pager" aria-label={t("pagerLabel")}>
          {p > 1 && (
            <Link className="a-btn" href={qs(p - 1)}>
              {t("newer")}
            </Link>
          )}
          {p < pages && (
            <Link className="a-btn" href={qs(p + 1)}>
              {t("older")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
