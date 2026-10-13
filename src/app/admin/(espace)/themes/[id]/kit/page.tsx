/**
 * Kit Photoshop d'un thème : envoi du PSD rempli, puis revue de l'import —
 * une carte par emplacement (✓ / ⚠ / ✗ et la raison en clair, avant / après,
 * format retenu et poids), palette suggérée, total au premier affichage,
 * « Appliquer au thème » (copie brouillon). Thèmes livrés compris.
 */
/* eslint-disable @next/next/no-img-element -- aperçus PNG de l'import, servis par une route admin : next/image n'apporte rien. */
import Link from "next/link";
import { notFound } from "next/navigation";

import KitDownloadButton from "@/components/admin/KitDownloadButton";
import KitTutorial from "@/components/admin/KitTutorial";
import { KitApplyPanel, KitBasePicker, KitImportUpload, KitImportWatch } from "@/components/admin/KitImport";
import PageHeader from "@/components/admin/PageHeader";
import { getThemeOverview } from "@/lib/admin";
import { assertAdmin } from "@/lib/auth/guard";
import { arrowMirror, baseThemeIdOf, firstViewTotal, isApplicable, kitColorFailures, paletteFailures, withKitColors } from "@/lib/kit/apply";
import { loadSavedTheme } from "@/lib/kit/export-job";
import type { SlotReport } from "@/lib/kit/import";
import { beforePreviews, getKitImport, isImportId, listKitImports } from "@/lib/kit/import-job";
import { ALL_SLOTS } from "@/lib/kit/spec";
import { contrastReport } from "@/themes/contrast";
import { contrastRatio, isAuto, isNuance, resolvePalette, type NuanceKey } from "@/themes/palette";

export const metadata = { title: "Kit Photoshop" };
export const dynamic = "force-dynamic";

const FORMAT: Record<string, string> = { svg: "SVG", "svg-mask": "SVG (forme teintée par le thème)", avif: "AVIF + WebP", "avif-mask": "AVIF (forme teintée par le thème)", png: "PNG 32 et 64 px (écrans HiDPI)" };
const ROLE: Record<string, string> = { bg: "Fond", bgDeep: "Fond profond", ink: "Texte", inkSoft: "Texte doux", primary: "Accent", secondary: "Secondaire", tertiary: "Tertiaire" };

/** Phrase de la carte : « Flèche droite : redessinée », « Plan 3 : inchangé »… */
function headline(s: SlotReport): string {
  if (s.status === "error") return `${s.label} : à corriger`;
  switch (s.change) {
    case "unchanged":
      return `${s.label} : inchangé`;
    case "redrawn":
      return `${s.label} : redessiné${/^(Signature|Flèche|Lecture)/.test(s.label) ? "e" : ""}`;
    case "missing":
      return `${s.label} : calque introuvable`;
    default:
      return `${s.label} : importé${/^(Signature|Flèche|Lecture)/.test(s.label) ? "e" : ""}`;
  }
}
const formatBytes = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
const icon = (s: SlotReport) => (s.status === "error" ? "✗" : s.status === "warn" ? "⚠" : "✓");

export default async function ThemeKitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ import?: string; base?: string }> }) {
  await assertAdmin();
  const { id } = await params;
  const theme = /^[a-z0-9-]{1,80}$/.test(id) ? loadSavedTheme(id) : null;
  if (!theme) notFound();
  const imports = await listKitImports(theme.id);
  const wanted = (await searchParams).import;
  const currentId = isImportId(wanted) ? wanted : imports[0]?.id;
  // Import d'un autre thème : introuvable ici (pas de revue croisée).
  const state = currentId ? await getKitImport(currentId, theme.id) : null;
  if (wanted && !state) notFound();
  const report = state?.report ?? null;
  // Thème sur lequel le kit sera posé : choisi (?base=), sinon celui dont le kit a été exporté, sinon celui de cet écran.
  const overview = getThemeOverview();
  const baseId = baseThemeIdOf(report, theme.id, /^[a-z0-9-]{1,80}$/.test((await searchParams).base ?? "") ? (await searchParams).base : undefined);
  const base = baseId === theme.id ? theme : (loadSavedTheme(baseId) ?? theme);
  const preview = (s: SlotReport, which: "avant" | "apres") => `/admin/api/theme-kit/${encodeURIComponent(theme.id)}/import/${state!.meta.id}/preview/${s.id.replace(/\//g, "--")}/${which}`;
  const totals = report ? await firstViewTotal(base, report) : null;
  const befores = await beforePreviews(report?.reference?.exportId);
  const changed = report ? report.slots.filter(isApplicable).length : 0;
  const counts = report ? { unchanged: report.slots.filter((s) => s.change === "unchanged").length, changed, warn: report.slots.filter((s) => s.status === "warn").length, error: report.slots.filter((s) => s.status === "error").length } : null;
  const palette = report?.palette ? Object.entries(report.palette.roles).map(([role, hex]) => ({ role, label: ROLE[role] ?? role, hex: hex! })) : null;
  const paletteProblem = report && palette ? paletteFailures(base, report) : [];
  // Couleurs repeintes (« 8 · Palette ») : avant / après, contraste du thème une fois appliquées.
  const colorChanges = report?.colors?.filter((c) => c.change === "changed") ?? [];
  const colorProblems = report && colorChanges.length ? kitColorFailures(base, report) : [];
  const after = report && colorChanges.length ? withKitColors(base.tokens, report) : null;
  const paletteIgnored = report?.ignoredLayers.filter((l) => /palette/i.test(l)) ?? [];
  const afterPairs = after ? contrastReport(after.color) : [];
  const afterResolved = after ? resolvePalette(after.color, after.palette) : null;
  const pair = report ? arrowMirror(report) : null;
  const mirror = pair && pair.from.preview ? { from: pair.from.label, to: ALL_SLOTS.find((x) => x.id === pair.to)!.label, preview: preview(pair.from, "apres") } : null;

  return (
    <>
      <PageHeader
        title={`Kit Photoshop · ${theme.name}`}
        intro="Télécharge le kit, peins dans Photoshop ce que tu veux changer, puis renvoie le fichier : chaque élément est vérifié et tu choisis quoi appliquer."
      />
      <div className="a-section a-kit-export" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
        <KitDownloadButton themeId={theme.id} />
        <p className="a-help">Le kit reprend l&apos;état enregistré de ce thème : un groupe par élément, avec où il apparaît sur le site et les consignes.</p>
        <KitTutorial themeId={theme.id} fromTheme quiet label="Tuto du kit : comment ça marche" />
      </div>

      <section className="a-section" aria-labelledby="kit-send">
        <h2 id="kit-send">Renvoyer le kit rempli</h2>
        <KitImportUpload themeId={theme.id} />
      </section>

      {state && (
        <section className="a-section" aria-labelledby="kit-review">
          <h2 id="kit-review">
            Revue de « {state.meta.fileName} »
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
          {report && report.slots.length > 0 && counts && totals && (
            <>
              <div className="a-kit-summary">
                {report.foreign && (
                  <strong role="alert">
                    Ce kit vient du thème « {loadSavedTheme(report.foreign.themeId)?.name ?? report.foreign.themeId} », pas de « {theme.name} » (l&apos;écran où tu l&apos;as envoyé) : il est appliqué à son thème d&apos;origine, sauf si tu en choisis un autre plus bas.
                  </strong>
                )}
                <span>
                  {report.reference
                    ? `Kit d'origine reconnu (${report.reference.how === "identifiant" ? "identifiant du fichier" : "contenu des calques"}) : ce qui n'a pas bougé est gardé tel quel.`
                    : "Kit d'origine non reconnu : chaque élément est importé."}
                </span>
                <span>
                  <strong>{counts.changed}</strong> à appliquer · <strong>{counts.unchanged}</strong> inchangé{counts.unchanged > 1 ? "s" : ""}
                  {counts.warn ? ` · ${counts.warn} avertissement${counts.warn > 1 ? "s" : ""}` : ""}
                  {counts.error ? ` · ${counts.error} à corriger` : ""}
                </span>
                <span>
                  Premier affichage : <strong>{formatBytes(totals.after)}</strong> (aujourd&apos;hui {formatBytes(totals.before)})
                </span>
              </div>
              {report.ignoredLayers.length > 0 && <p className="a-help">Calques ignorés : {report.ignoredLayers.join(" ; ")}.</p>}
              <div className="a-kit-cards">
                {report.slots.map((s) => {
                  const spec = ALL_SLOTS.find((x) => x.id === s.id);
                  return (
                    <article key={s.id} className="a-kit-card" data-status={s.status} data-change={s.change} data-slot={s.id}>
                      <h3>
                        <span aria-hidden>{icon(s)}</span>
                        <span>{headline(s)}</span>
                      </h3>
                      {s.change !== "missing" && s.status !== "error" && (
                        <div className="a-kit-pair">
                          {befores.has(s.id.replace(/\//g, "--")) && (
                            <figure>
                              <img src={preview(s, "avant")} alt={`${s.label}, avant`} />
                              <figcaption>Avant</figcaption>
                            </figure>
                          )}
                          {s.preview && (
                            <figure>
                              <img src={preview(s, "apres")} alt={`${s.label}, après`} />
                              <figcaption>Après</figcaption>
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
                          ? "Gardé tel quel (pas reconverti)."
                          : s.chosen
                            ? `${FORMAT[s.chosen]} · ${formatBytes(s.bytes ?? 0)}${s.fidelity ? ` · contour à ${s.fidelity.deviation.toFixed(2)} px` : ""}${s.hotspot ? ` · point chaud ${s.hotspot.x}, ${s.hotspot.y} px` : ""}`
                            : s.change === "missing"
                              ? `L'élément actuel du thème est gardé.${spec ? ` Calque attendu : « ${spec.layer} ».` : ""}`
                              : ""}
                      </p>
                    </article>
                  );
                })}
              </div>
              {report.colors && (
                <section className="a-kit-colors" aria-labelledby="kit-colors-title" data-testid="kit-colors-review">
                  <h3 id="kit-colors-title">Couleurs de la palette</h3>
                  <p className="a-help" data-testid="kit-colors-count">
                    {report.colors.length} pastille{report.colors.length > 1 ? "s" : ""} lue{report.colors.length > 1 ? "s" : ""} : {colorChanges.length} repeinte{colorChanges.length > 1 ? "s" : ""},{" "}
                    {report.colors.filter((c) => c.change === "unchanged").length} inchangée{report.colors.filter((c) => c.change === "unchanged").length > 1 ? "s" : ""}
                    {report.colors.some((c) => c.change === "missing") ? `, ${report.colors.filter((c) => c.change === "missing").length} illisible${report.colors.filter((c) => c.change === "missing").length > 1 ? "s" : ""}` : ""}
                    {paletteIgnored.length ? `, ${paletteIgnored.length} calque${paletteIgnored.length > 1 ? "s" : ""} ignoré${paletteIgnored.length > 1 ? "s" : ""}` : ""}.
                  </p>
                  {colorProblems.length > 0 && (
                    <p className="a-field-error" role="alert" data-testid="kit-colors-blocked">
                      Tes couleurs ne seront PAS appliquées : une fois posées, le contraste est insuffisant ({colorProblems.slice(0, 3).join(" ; ")}). Corrige-les dans Photoshop et renvoie le kit.
                    </p>
                  )}
                  {paletteIgnored.map((l) => (
                    <p key={l} className="a-help" data-testid="kit-colors-ignored">
                      ⚠ Calque ignoré : {l}
                    </p>
                  ))}
                  {colorChanges.length === 0 ? (
                    <p className="a-help">
                      Aucune pastille repeinte détectée : les couleurs du thème restent telles quelles (les nuances « auto » suivent leur base). Pour changer une couleur, peins la pastille elle-même (pinceau, pot de peinture, ou un calque ajouté dans « 8 · Palette » par-dessus), puis enregistre le .psd.
                    </p>
                  ) : (
                    <>
                      <p className="a-help">
                        {colorChanges.length} couleur{colorChanges.length > 1 ? "s repeintes" : " repeinte"} ; {report.colors.filter((c) => c.change === "unchanged").length} inchangée
                        {report.colors.filter((c) => c.change === "unchanged").length > 1 ? "s" : ""} (une nuance « auto » suit sa base).
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
                                <span className={`a-ratio ${worst < 4.5 ? "a-ratio-bad" : "a-ratio-ok"}`} title={pairs.map((p) => `${p.label} : ${p.ratio.toFixed(2)}:1`).join("\n")}>
                                  {worst < 4.5 ? "✗" : "✓"} {worst.toFixed(1)}:1
                                </span>
                              )}
                              {wasAuto && <span className="a-help">était « auto » : devient choisie</span>}
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
                        ⚠ {c.label} : {c.messages[0] ?? "pastille introuvable"} (couleur actuelle gardée).
                      </p>
                    ))}
                </section>
              )}
              <KitBasePicker
                themeId={theme.id}
                importId={state.meta.id}
                baseId={base.id}
                originId={report.reference?.themeId}
                themes={overview.themes.map((t) => ({ id: t.id, name: t.name, live: t.id === overview.activeId }))}
              />
              <KitApplyPanel
                colors={colorChanges.length ? { count: colorChanges.length, problem: colorProblems.length ? `Contraste insuffisant une fois appliquées (${colorProblems[0]}) : corrige ces couleurs dans Photoshop, ou applique sans elles.` : null } : null}
                themeId={theme.id}
                importId={state.meta.id}
                baseId={base.id}
                themeName={base.name}
                tape={report.slots.some((s) => s.id === "accessoires/scotch" && s.change === "redrawn" && isApplicable(s))}
                changed={changed}
                palette={palette}
                paletteProblem={paletteProblem.length ? `Cette palette ne passe pas le contraste (${paletteProblem[0]}) : ignore-la, ou ajuste les couleurs dans l'éditeur.` : null}
                applied={state.meta.appliedThemeId ?? null}
                mirror={mirror}
              />
            </>
          )}
        </section>
      )}

      {imports.length > 1 && (
        <section className="a-section" aria-labelledby="kit-history">
          <h2 id="kit-history">Envois précédents</h2>
          <ul className="a-help">
            {imports.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/themes/${encodeURIComponent(theme.id)}/kit?import=${m.id}`}>{m.fileName}</Link> — {new Date(m.createdAt).toLocaleString("fr-FR")}
                {m.appliedThemeId ? " (appliqué)" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="a-help" style={{ marginTop: 24 }}>
        <Link href="/admin/themes">← Tous les thèmes</Link>
      </p>
    </>
  );
}
