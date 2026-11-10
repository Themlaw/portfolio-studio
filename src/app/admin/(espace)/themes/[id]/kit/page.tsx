/**
 * Kit Photoshop d'un thème : envoi du PSD rempli, puis revue de l'import —
 * une carte par emplacement (✓ / ⚠ / ✗ et la raison en clair, avant / après,
 * format retenu et poids), palette suggérée, total au premier affichage,
 * « Appliquer à mon thème » (nouvelle version de Mon thème, lot 60). Thèmes livrés compris.
 */
/* eslint-disable @next/next/no-img-element -- aperçus PNG de l'import, servis par une route admin : next/image n'apporte rien. */
import Link from "next/link";
import { notFound } from "next/navigation";

import { intlLocale } from "@/i18n/admin-lang";
import { getAdminLang, getAdminT } from "@/i18n/admin-server";
import KitDownloadButton, { KitPartsDownload } from "@/components/admin/KitDownloadButton";
import KitTutorial from "@/components/admin/KitTutorial";
import { KitApplyPanel, KitImportUpload, KitImportWatch, KitTargetNote } from "@/components/admin/KitImport";
import PageHeader from "@/components/admin/PageHeader";
import { assertAdmin } from "@/lib/auth/guard";
import { arrowMirror, decorApplicable, firstViewTotal, isApplicable, kitColorFailures, kitTarget, withKitColors } from "@/lib/kit/apply";
import { kitFile, kitVersion, loadSavedTheme } from "@/lib/kit/export-job";
import { kitParts, readKitMeta } from "@/lib/kit/parts";
import type { SlotReport } from "@/lib/kit/import";
import { beforePreviews, getKitImport, isImportId, listKitImports } from "@/lib/kit/import-job";
import { ALL_SLOTS, slotSpecOf } from "@/lib/kit/spec";
import { getMineState } from "@/lib/themes/versions";
import { contrastReport } from "@/themes/contrast";
import { contrastRatio, isAuto, isNuance, resolvePalette, type NuanceKey } from "@/themes/palette";

export async function generateMetadata() {
  return { title: (await getAdminT("kitPage"))("title") };
}
export const dynamic = "force-dynamic";

type T = (key: string, values?: Record<string, string | number>) => string;

/** Phrase de la carte : « Flèche droite : redessinée », « Plan 3 : inchangé »… */
function headline(s: SlotReport, t: T): string {
  const fem = /^(Flèche|Lecture)/.test(s.label);
  if (s.status === "error") return t("headlineError", { label: s.label });
  switch (s.change) {
    case "unchanged":
      return t("headlineUnchanged", { label: s.label });
    case "redrawn":
      return t(fem ? "headlineRedrawnFem" : "headlineRedrawn", { label: s.label });
    case "missing":
      return t("headlineMissing", { label: s.label });
    default:
      return t(fem ? "headlineImportedFem" : "headlineImported", { label: s.label });
  }
}
const formatBytes = (n: number, t: T, locale: string) => (n < 1024 ? t("sizeB", { n }) : n < 1024 * 1024 ? t("sizeKb", { n: Math.round(n / 1024) }) : t("sizeMb", { n: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 1024 / 1024) }));
/** Aperçu « avant » d'un emplacement : le sien, ou (décor libre) celui du plan exporté de même rang ou dont il est la copie. */
const beforeKey = (s: SlotReport) => (s.id.startsWith("decor/") ? `hero--plan-${(s.from ?? Number(s.id.slice(6)) - 1) + 1}` : s.id.replace(/\//g, "--"));
const icon = (s: SlotReport) => (s.status === "error" ? "✗" : s.status === "warn" ? "⚠" : "✓");

export default async function ThemeKitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ import?: string; base?: string; neuf?: string }> }) {
  await assertAdmin();
  const t = await getAdminT("kitPage");
  const locale = intlLocale(await getAdminLang());
  const { id } = await params;
  const theme = /^[a-z0-9-]{1,80}$/.test(id) ? loadSavedTheme(id) : null;
  if (!theme) notFound();
  const imports = await listKitImports(theme.id);
  // Lot 122 : les parties du kit (poids connus seulement si le kit de l'état enregistré est déjà généré).
  const zip = kitFile(theme.id, kitVersion(theme));
  const [parts, kitMeta] = await Promise.all([kitParts(zip), readKitMeta(zip)]);
  const wanted = (await searchParams).import;
  // ?neuf=1 : un nouvel envoi commence (ou vient d'échouer) : l'ancienne revue disparaît, elle ne concerne plus ce fichier.
  const currentId = (await searchParams).neuf ? undefined : isImportId(wanted) ? wanted : imports[0]?.id;
  // Import d'un autre thème : introuvable ici (pas de revue croisée).
  const state = currentId ? await getKitImport(currentId, theme.id) : null;
  if (wanted && !state) notFound();
  const report = state?.report ?? null;
  // Mon thème (lot 60) : le kit s'applique à sa version en cours (sans Mon thème : au thème dont le kit a été exporté, qui devient Mon thème).
  const mine = getMineState();
  const target = kitTarget(report, theme.id);
  const base = target?.source ?? theme;
  const nextVersion = mine ? mine.version + 1 : 2;
  const preview = (s: SlotReport, which: "avant" | "apres") => `/admin/api/theme-kit/${encodeURIComponent(theme.id)}/import/${state!.meta.id}/preview/${s.id.replace(/\//g, "--")}/${which}`;
  const totals = report ? await firstViewTotal(base, report) : null;
  const befores = await beforePreviews(report?.reference?.exportId);
  // Décor libre : sa composition seule (plan retiré, ordre changé) compte comme un élément à appliquer.
  const decorOnly = Boolean(report && decorApplicable(report) && !report.slots.some((x) => x.id.startsWith("decor/") && isApplicable(x)));
  const changed = report ? report.slots.filter(isApplicable).length + (decorOnly ? 1 : 0) : 0;
  const counts = report ? { unchanged: report.slots.filter((s) => s.change === "unchanged").length, changed, warn: report.slots.filter((s) => s.status === "warn").length, error: report.slots.filter((s) => s.status === "error").length } : null;
  // Couleurs repeintes (« 8 · Palette ») : avant / après, contraste du thème une fois appliquées.
  const colorChanges = report?.colors?.filter((c) => c.change === "changed") ?? [];
  const colorProblems = report && colorChanges.length ? kitColorFailures(base, report) : [];
  const after = report && colorChanges.length ? withKitColors(base.tokens, report) : null;
  const paletteIgnored = report?.ignoredLayers.filter((l) => /palette/i.test(l)) ?? [];
  const afterPairs = after ? contrastReport(after.color) : [];
  const afterResolved = after ? resolvePalette(after.color, after.palette) : null;
  const pair = report ? arrowMirror(report) : null;
  const mirror = pair && pair.from.preview ? { from: pair.from.label, to: ALL_SLOTS.find((x) => x.id === pair.to)!.label, preview: preview(pair.from, "apres") } : null;

  const renderCard = (s: SlotReport) => {
                  const spec = slotSpecOf(s.id);
                  return (
                    <article key={s.id} className="a-kit-card" data-status={s.status} data-change={s.change} data-slot={s.id}>
                      <h3>
                        <span aria-hidden>{icon(s)}</span>
                        <span>{headline(s, t)}</span>
                      </h3>
                      {s.change !== "missing" && s.status !== "error" && (
                        <div className="a-kit-pair">
                          {befores.has(beforeKey(s)) && (
                            <figure>
                              <img src={preview(s, "avant")} alt={t("beforeAlt", { label: s.label })} />
                              <figcaption>{t("before")}</figcaption>
                            </figure>
                          )}
                          {s.preview && (
                            <figure>
                              <img src={preview(s, "apres")} alt={t("afterAlt", { label: s.label })} />
                              <figcaption>{t("after")}</figcaption>
                            </figure>
                          )}
                        </div>
                      )}
                      {s.messages.length > 0 && (
                        <ul>
                          {s.messages.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      )}
                      <p className="a-kit-meta">
                        {s.change === "unchanged"
                          ? t("unchangedDot")
                          : s.chosen
                            ? `${t(`formats.${s.chosen}`)} · ${formatBytes(s.bytes ?? 0, t, locale)}${s.fidelity ? ` · ${t("outline", { px: s.fidelity.deviation.toFixed(2) })}` : ""}${s.hotspot ? ` · ${t("hotspot", { x: s.hotspot.x, y: s.hotspot.y })}` : ""}`
                            : s.change === "missing"
                              ? `${t("currentKept")}${spec ? ` ${t("expectedLayer", { layer: spec.layer })}` : ""}`
                              : ""}
                      </p>
                    </article>
                  );
                  };

  return (
    <>
      <PageHeader
        title={t("headerTitle", { name: theme.name })}
        intro={t("intro")}
      />
      <div className="a-section a-kit-export" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
        <KitDownloadButton themeId={theme.id} />
        <KitPartsDownload themeId={theme.id} parts={parts} ms={kitMeta?.ms ?? null} />
        <p className="a-help">{t("exportHelp")}</p>
        <KitTutorial themeId={theme.id} fromTheme quiet label={t("tutorialLabel")} />
      </div>

      <section className="a-section" aria-labelledby="kit-send">
        <h2 id="kit-send">{t("send")}</h2>
        <KitImportUpload themeId={theme.id} />
      </section>

      {state && (
        <section className="a-section" aria-labelledby="kit-review">
          <h2 id="kit-review">
            {t("review", { file: state.meta.fileName })}
          </h2>
          {(state.status === "queued" || state.status === "running") && !report && <KitImportWatch themeId={theme.id} importId={state.meta.id} />}
          {state.status === "failed" && !report && (
            <p className="a-field-error" role="alert">
              {state.error}
            </p>
          )}
          {report && !report.ok && report.problem && (
            <p className="a-field-error" role="alert">
              {report.problem}
            </p>
          )}
          {report && report.ok && report.slots.length === 0 && !report.colors && (
            <div className="a-notice" role="status" data-testid="kit-empty">
              <p>{t("nothingToCheck")}</p>
              {report.ignoredLayers.length > 0 && (
                <ul>
                  {report.ignoredLayers.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {report && report.slots.length > 0 && counts && totals && (
            <>
              <div className="a-kit-summary">
                {report.foreign && (
                  <strong role="alert">
                    {t("foreign", { from: loadSavedTheme(report.foreign.themeId)?.name ?? report.foreign.themeId, name: theme.name })}
                  </strong>
                )}
                <span>
                  {report.reference
                    ? t("referenceKnown", { how: report.reference.how === "identifiant" ? "id" : "content" })
                    : t("referenceUnknown")}
                </span>
                <span>
                  <strong>{counts.changed}</strong> {t("toApply")} · <strong>{counts.unchanged}</strong> {t(counts.unchanged > 1 ? "unchangedMany" : "unchangedOne")}
                  {counts.warn ? t("warningCount", { count: counts.warn }) : ""}
                  {counts.error ? t("errorCount", { count: counts.error }) : ""}
                </span>
                <span>
                  {t("weightLabel")} <strong>{formatBytes(totals.after, t, locale)}</strong> {t("weightToday", { before: formatBytes(totals.before, t, locale) })}
                </span>
              </div>
              {report.ignoredLayers.length > 0 && (
                <div className="a-help" data-testid="kit-ignored">
                  <strong>{t("ignoredLayers")}</strong>
                  <ul>
                    {report.ignoredLayers.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.decor && (
                <p className="a-help" data-testid="kit-decor-summary">
                  {t("decor", { count: report.decor.count, ref: report.decor.reference ? (report.decor.structure === "unchanged" ? "same" : "changed") : "none", previous: report.decor.previous ?? "" })}
                  {!decorApplicable(report) && report.slots.some((x) => x.id.startsWith("decor/") && x.status === "error") ? ` ${t("decorFix")}` : ""}
                </p>
              )}
              {(report.files ?? []).length > 1 || (report.files ?? [])[0]?.id !== "mono" ? (
                (report.files ?? []).map((f) => (
                  <section key={f.id} className="a-kit-file" data-file={f.id} data-received={f.received} aria-labelledby={`kit-file-${f.id}`}>
                    <h3 id={`kit-file-${f.id}`}>
                      {f.label}
                      <small>{f.received ? ` ${t("fileReceived", { fileName: f.fileName ?? "", count: f.slots })}` : ` ${t("fileNotSent")}`}</small>
                    </h3>
                    {f.received ? <div className="a-kit-cards">{report.slots.filter((s) => s.file === f.id).map(renderCard)}</div> : <p className="a-help">{t("fileNoChange")}</p>}
                  </section>
                ))
              ) : (
                <div className="a-kit-cards">{report.slots.map(renderCard)}</div>
              )}
              {report.colors && (
                <section className="a-kit-colors" aria-labelledby="kit-colors-title" data-testid="kit-colors-review">
                  <h3 id="kit-colors-title">{t("paletteColors")}</h3>
                  <p className="a-help" data-testid="kit-colors-count">
                    {t("colorsCount", { read: report.colors.length, changed: colorChanges.length, unchanged: report.colors.filter((c) => c.change === "unchanged").length, missing: report.colors.filter((c) => c.change === "missing").length, ignored: paletteIgnored.length })}
                  </p>
                  {colorProblems.length > 0 && (
                    <p className="a-notice" role="status" data-testid="kit-colors-warning">
                      {t("colorsWarning", { list: colorProblems.slice(0, 3).join(t("listSep")) })}
                    </p>
                  )}
                  {paletteIgnored.map((l) => (
                    <p key={l} className="a-help" data-testid="kit-colors-ignored">
                      ⚠ {t("layerIgnored", { layer: l })}
                    </p>
                  ))}
                  {colorChanges.length === 0 ? (
                    <p className="a-help">
                      {t("noSwatchPainted")}
                    </p>
                  ) : (
                    <>
                      <p className="a-help">
                        {t("colorsRepainted", { changed: colorChanges.length, unchanged: report.colors.filter((c) => c.change === "unchanged").length })}
                      </p>
                      <ul className="a-kit-color-list">
                        {colorChanges.map((c) => {
                          const wasAuto = isNuance(c.key) && isAuto(base.tokens.color, base.tokens.palette, c.key as NuanceKey);
                          const pairs = afterPairs.filter((p) => p.fg === c.key || p.bg === c.key || (c.key === "secondary" && p.fg === "eyebrow"));
                          const scrim = afterResolved && (c.key === "scrim" || c.key === "onScrim") ? contrastRatio(afterResolved.onScrim, afterResolved.scrim) : null;
                          const worst = Math.min(...pairs.map((p) => p.ratio), scrim ?? Infinity);
                          return (
                            <li key={c.key} data-color={c.key}>
                              <strong>{c.label}</strong>
                              <span className="a-kit-color-pair">
                                <span className="a-chip" style={{ background: c.before }} aria-hidden="true" />
                                <code>{c.before}</code>
                                <span aria-hidden="true">→</span>
                                <span className="a-chip" style={{ background: c.after }} aria-hidden="true" />
                                <code>{c.after}</code>
                              </span>
                              {Number.isFinite(worst) && (
                                <span className={`a-ratio ${worst < 4.5 ? "a-ratio-bad" : "a-ratio-ok"}`} title={pairs.map((p) => t("pairTip", { label: p.label, ratio: p.ratio.toFixed(2) })).join("\n")}>
                                  {worst < 4.5 ? "✗" : "✓"} {worst.toFixed(1)}:1
                                </span>
                              )}
                              {wasAuto && <span className="a-help">{t("wasAuto")}</span>}
                              {c.messages.map((m) => (
                                <span key={m} className="a-help">
                                  ⚠ {m}
                                </span>
                              ))}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {report.colors
                    .filter((c) => c.change === "missing")
                    .map((c) => (
                      <p key={c.key} className="a-help">
                        ⚠ {t("swatchMissing", { label: c.label, message: c.messages[0] ?? t("swatchNotFound") })}
                      </p>
                    ))}
                </section>
              )}
              <KitTargetNote mineName={mine?.name ?? null} version={mine?.version ?? null} basedOn={base.name} />
              <KitApplyPanel
                colors={colorChanges.length ? { count: colorChanges.length, problem: colorProblems.length ? t("colorsProblem", { first: colorProblems[0] }) : null } : null}
                themeId={theme.id}
                importId={state.meta.id}
                themeName={mine?.name ?? t("mineName")}
                nextVersion={nextVersion}
                mineExists={Boolean(mine)}
                tape={report.slots.some((s) => s.id === "accessoires/scotch" && s.change === "redrawn" && isApplicable(s))}
                changed={changed}
                applied={state.meta.appliedThemeId ? { id: state.meta.appliedThemeId, version: state.meta.appliedVersion ?? null } : null}
                mirror={mirror}
              />
            </>
          )}
        </section>
      )}

      {imports.length > 1 && (
        <section className="a-section" aria-labelledby="kit-history">
          <h2 id="kit-history">{t("previous")}</h2>
          <ul className="a-help">
            {imports.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/themes/${encodeURIComponent(theme.id)}/kit?import=${m.id}`}>{m.fileName}</Link> — {new Date(m.createdAt).toLocaleString(locale)}
                {m.appliedThemeId ? ` ${t("applied")}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="a-help" style={{ marginTop: 24 }}>
        <Link href="/admin/themes">{t("allThemes")}</Link>
      </p>
    </>
  );
}
