"use client";

/**
 * Écran Thèmes (lot 60) : « Mon thème » en haut (une vignette réelle de l'accueil, « basé sur », version, état, actions), puis
 * « Repartir d'un modèle » (les thèmes fournis ne se modifient jamais), puis « Mes anciens thèmes » (repliée).
 */
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Text } from "react-aria-components";

import {
  activateThemeAction,
  adoptOldThemeAction,
  deleteThemeAction,
  resetSiteColorsAction,
  applyModelAction,
} from "@/app/admin/(espace)/themes/actions";
import type { SitePalette } from "@/lib/look";
import type { MineState, OldTheme } from "@/lib/themes/versions";
import { accentProblem } from "@/themes/contrast";
import type { Theme } from "@/themes/schema";
import { NUANCE_KEYS } from "@/themes/palette";
import { applySitePalette, SITE_NUANCES, SITE_ROLES } from "@/themes/site-palette";

import { useKitDownload } from "./KitDownloadButton";
import LiveThumb from "./LiveThumb";
import { ConfirmDialog, toast, UNDO_MS } from "./editing";
import ThemeSwatches from "./ThemeSwatches";
import ThemeThumb from "./ThemeThumb";
import { formatWhen } from "./theme-format";

/** Formulaire natif : l'aperçu s'ouvre dans un nouvel onglet (l'admin reste ici). `id` : un thème, ou `<thème>@<n>` (une version). */
export function PreviewButton({ id, label, small, testId }: { id: string; label?: string; small?: boolean; testId?: string }) {
  const t = useTranslations("themes");
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="id" value={id} />
      {/* « Quitter l'aperçu » (bandeau, Échap) ramène à cet écran. */}
      <input type="hidden" name="retour" value="/admin/themes" />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`} data-testid={testId}>
        {label ?? t("preview")} <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

type Pending =
  | { kind: "activate"; theme: Theme; mine: boolean }
  | { kind: "delete"; theme: Theme }
  | { kind: "replace"; model: Theme }
  | null;

/** Menu « Kit Photoshop ▾ » de Mon thème : une seule porte d'entrée, télécharger puis renvoyer. */
function KitMenu({ theme }: { theme: Theme }) {
  const t = useTranslations("themes");
  const kit = useKitDownload(theme.id);
  const id = encodeURIComponent(theme.id);
  return (
    <>
      <MenuTrigger>
        <AriaButton className="a-btn a-btn-small" data-testid="mine-kit-menu">
          {t("kitMenu")} <span aria-hidden="true">▾</span>
        </AriaButton>
        <Popover className="a-menu-popover" placement="bottom start" offset={4}>
          <Menu className="a-menu" aria-label={t("kitMenuLabel")}>
            <MenuItem className="a-menu-item" onAction={() => void kit.start()} isDisabled={kit.busy || kit.blocked} textValue={t("kitDownload")}>
              <Text slot="label">{kit.busy ? t("kitPreparing") : t("kitDownload")}</Text>
              <Text slot="description">{t("kitDownloadHelp")}</Text>
            </MenuItem>
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}/kit`} textValue={t("kitSend")} data-testid="mine-kit-send">
              <Text slot="label">{t("kitSendLabel")}</Text>
              <Text slot="description">{t("kitSendHelp")}</Text>
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      {kit.busy && (
        <span className="a-kit-progress" data-testid="kit-card-progress">
          <span className="a-spinner" aria-hidden="true" />
          {kit.status || t("kitPreparing")}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {kit.status}
      </span>
    </>
  );
}

/** Menu « … » d'une carte : l'archive du thème (se réimporte), et, pour un ancien thème, rien d'autre. */
function MoreMenu({ theme, colorsLink = false, onDelete }: { theme: Theme; /** Modèle : « Voir les couleurs » (essai en lecture seule, sans rien modifier). */ colorsLink?: boolean; /** Ancien thème (pas en ligne) : « Supprimer » vit ici, pas en gros bouton. */ onDelete?: () => void }) {
  const t = useTranslations("themes");
  const id = encodeURIComponent(theme.id);
  return (
    <MenuTrigger>
      <AriaButton className="a-btn a-btn-small a-menu-btn" aria-label={t("moreActionsFor", { name: theme.name })}>
        <span aria-hidden="true">…</span>
      </AriaButton>
      <Popover className="a-menu-popover" placement="bottom end" offset={4}>
        <Menu className="a-menu" aria-label={t("actionsOf", { name: theme.name })}>
          {colorsLink && (
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}#couleurs`} data-testid="theme-da-link" textValue={t("viewColors")}>
              <Text slot="label">{t("viewColors")}</Text>
              <Text slot="description">{t("viewColorsHelp")}</Text>
            </MenuItem>
          )}
          <MenuItem
            className="a-menu-item"
            href={`/admin/api/themes/${id}/export`}
            download={`theme-${theme.id}.zip`}
            textValue={t("exportTheme")}
            onAction={() => toast(t("exportToast", { id: theme.id }))}
          >
            <Text slot="label">{t("exportTheme")}</Text>
            <Text slot="description">{t("exportHelp")}</Text>
          </MenuItem>
          {onDelete && (
            <MenuItem className="a-menu-item a-menu-item-danger" onAction={onDelete} textValue={t("deleteTheme")} data-testid="old-delete">
              <Text slot="label">{t("deleteThemeItem")}</Text>
              <Text slot="description">{t("deleteThemeHelp")}</Text>
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export type NewVersionNotice = { version: number; via: string } | null;

export default function ThemeList({
  library,
  accents,
  thumbs = {},
  preparing = null,
  previousId = null,
  customColors = {},
  editorPageId = null,
  notice = null,
}: {
  library: { activeId: string; mine: MineState | null; models: Theme[]; olds: OldTheme[] };
  accents: { id: number; title: string; accent: string }[];
  /** Vignettes générées des modèles (id → chemin public). */
  thumbs?: Record<string, string | null>;
  /** Aperçu en cours d'un thème pas encore en ligne (identifiant d'aperçu : un thème, ou `<thème>@<n>`) et son nom. */
  preparing?: { id: string; name: string } | null;
  /** Thème qui était en ligne avant le dernier changement. */
  previousId?: string | null;
  /** Couleurs personnalisées du site, publiées par-dessus le thème en ligne. */
  customColors?: SitePalette;
  /** Une version vient d'être créée (kit, import…) : encart « Nouvelle version ». */
  notice?: NewVersionNotice;
  /** Page que « Travailler au brouillon dessus » ouvre : la dernière modifiée, sinon l'accueil (lot 63). */
  editorPageId?: number | null;
}) {
  const router = useRouter();
  const t = useTranslations("themes");
  const locale = useLocale();
  const { activeId, mine, models, olds } = library;
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [keepColors, setKeepColors] = useState(true);
  const all: Theme[] = [...models, ...olds.map((o) => o.theme), ...(mine ? [mine.theme] : [])];
  const liveTheme = activeId === mine?.id ? (mine?.published ?? mine?.theme) : all.find((t) => t.id === activeId);
  const previous = previousId ? all.find((t) => t.id === previousId) : undefined;
  const customNames = [...SITE_ROLES.filter((r) => customColors[r.key]).map((r) => r.name), ...NUANCE_KEYS.filter((k) => customColors[k] && customColors[k] !== "auto").map((k) => SITE_NUANCES[k].name)];
  const hasCustom = customNames.length > 0;
  // Aperçu : une version précise (`<thème>@<n>`), le brouillon de Mon thème, ou un autre thème.
  const previewVersion = preparing ? /@(\d+)$/.exec(preparing.id)?.[1] : undefined;
  const previewBase = preparing?.id.replace(/@\d+$/, "");
  const previewsMineDraft = Boolean(mine && preparing && !previewVersion && preparing.id === mine.id);
  const previewTheme = preparing && !previewVersion && !previewsMineDraft ? all.find((t) => t.id === preparing.id) : undefined;

  /** Mise en ligne, puis un toast « Revenir au thème précédent » pendant un temps raisonnable (et l'encart permanent). */
  const publish = (theme: Theme, resetColors: boolean, isMine: boolean) =>
    startTransition(async () => {
      setError(null);
      const before = liveTheme;
      const result = await activateThemeAction(theme.id, { resetColors });
      if (!result.ok) {
        setError(result.message ?? t("actionFailed"));
        return;
      }
      setPending(null);
      toast(isMine ? t("publishedMine", { name: theme.name, version: mine?.version ?? "" }) : t("published", { name: theme.name }), "success", before && before.id !== theme.id ? { label: t("revertTo", { name: before.name }), run: () => void revert(before) } : undefined, UNDO_MS);
      router.refresh();
    });
  const revert = (to: Theme) =>
    startTransition(async () => {
      const result = await activateThemeAction(to.id);
      if (!result.ok) return toast(result.message ?? t("actionFailed"), "error");
      toast(t("backOnline", { name: to.name }));
      router.refresh();
    });
  const resetColors = () =>
    startTransition(async () => {
      const result = await resetSiteColorsAction();
      if (!result.ok) return toast(result.message ?? t("actionFailed"), "error");
      toast(t("colorsBack"));
      router.refresh();
    });
  /** Lot 63 : prépare ce thème (aperçu admin) puis ouvre l'éditeur dessus, sur la dernière page modifiée. */
  const [working, setWorking] = useState<string | null>(null);
  const workOn = async (theme: Theme) => {
    if (working) return;
    setWorking(theme.id);
    const target = editorPageId ? `/admin/pages/${editorPageId}/editer` : "/admin/pages";
    try {
      const res = await fetch("/admin/apercu", { method: "POST", body: new URLSearchParams({ id: theme.id, retour: target }), credentials: "same-origin", redirect: "manual" });
      if (res.status >= 400) throw new Error(String(res.status));
      window.location.assign(target);
    } catch {
      setWorking(null);
      toast(t("openFailed"), "error");
    }
  };
  const stopPreview = async (done: () => void) => {
    try {
      await fetch("/admin/apercu/quitter", { method: "POST", body: new URLSearchParams({ retour: "/admin/themes" }), credentials: "same-origin", redirect: "manual" });
    } catch {
      /* hors ligne : l'état affiché sera rafraîchi */
    }
    done();
  };

  /** « Utiliser ce modèle » : sans Mon thème, il est créé ; avec, la fenêtre demande remplacer / second thème / annuler. */
  const chooseModel = (model: Theme) => {
    if (mine) {
      setError(null);
      setPending({ kind: "replace", model });
      return;
    }
    startTransition(async () => {
      const result = await applyModelAction(model.id);
      if (!result.ok) return toast(result.message, "error");
      toast(
        result.data.published
          ? t("mineCreatedLive", { name: model.name })
          : t("mineCreatedDraft", { name: model.name }),
      );
      router.refresh();
    });
  };
  const replaceWith = (model: Theme, mode: "replace" | "second") =>
    startTransition(async () => {
      setError(null);
      const result = await applyModelAction(model.id, mode);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPending(null);
      if (mode === "second") {
        toast(t("secondCreated", { name: model.name }));
        router.refresh();
      } else {
        toast(t("newVersionFrom", { version: result.data.version, name: model.name }));
        router.push(`/admin/themes?nouvelle=${result.data.version}&via=model`);
      }
    });
  const adopt = (old: Theme) =>
    startTransition(async () => {
      const result = await adoptOldThemeAction(old.id);
      if (!result.ok) return toast(result.message, "error");
      toast(t("adopted", { name: old.name, version: result.data.version }));
      router.push(`/admin/themes?nouvelle=${result.data.version}&via=adopt`);
    });
  const remove = (theme: Theme) =>
    startTransition(async () => {
      setError(null);
      const result = await deleteThemeAction(theme.id);
      if (!result.ok) {
        setError(result.message ?? t("actionFailed"));
        return;
      }
      setPending(null);
      toast(t("removed", { name: theme.name }));
      router.refresh();
    });

  const shown = (theme: Theme): Theme =>
    // Ce qui serait vraiment publié : les couleurs personnalisées par-dessus le thème (pastilles).
    hasCustom ? { ...theme, tokens: { ...theme.tokens, color: applySitePalette(theme.tokens.color, theme.tokens.palette, customColors).color } } : theme;

  const mineDiffers = Boolean(mine && mine.publishedVersion != null && mine.publishedVersion !== mine.version);
  const mineNeedsPublish = Boolean(mine && (!mine.live || mineDiffers));

  return (
    <>
      {liveTheme && (
        <p className="a-theme-live" data-testid="theme-live-banner">
          {t.rich("liveBanner", { name: liveTheme.name, b: (c) => <strong>{c}</strong> })}
          {mine?.live ? <span> {t("liveVersion", { version: mine.publishedVersion ?? "" })}</span> : null}
        </p>
      )}
      {notice && mine && (
        <div className="a-notice" role="status" data-testid="new-version-notice">
          <p>
            <strong>{t("newVersionTitle", { version: notice.version })}</strong>
            {t("newVersionBody", { via: notice.via, current: mine.live ? t("currentVersion", { version: mine.publishedVersion ?? "" }) : liveTheme ? t("currentTheme", { name: liveTheme.name }) : t("currentThemeFallback") })}
          </p>
          <p className="a-card-actions">
            <PreviewButton id={mine.id} small label={t("preview")} testId="notice-preview" />
            <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })} data-testid="notice-publish">
              {t("publishVersion")}
            </button>
            <Link className="a-btn a-btn-small a-btn-quiet" href="/admin/themes">
              {t("later")}
            </Link>
          </p>
        </div>
      )}
      {preparing && (
        <div className="a-notice a-theme-preparing" role="status" data-testid="theme-preparing-banner">
          {previewVersion ? (
            <p>
              {t.rich("prepVersion", { version: previewVersion ?? "", name: mine?.name ?? t("mineTitle"), b: (c) => <strong>{c}</strong> })}
            </p>
          ) : previewsMineDraft ? (
            <p>
              {t.rich("prepDraft", { version: mine?.version ?? "", name: mine?.name ?? "", b: (c) => <strong>{c}</strong> })}
            </p>
          ) : (
            <p>
              {t.rich("prepTheme", { name: preparing.name, b: (c) => <strong>{c}</strong> })}
            </p>
          )}
          <p className="a-card-actions">
            {previewsMineDraft && mine && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })}>
                {t("publishVersion")}
              </button>
            )}
            {previewTheme && !previewTheme.preset && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: previewTheme, mine: false })}>
                {t("goLive")}
              </button>
            )}
            {previewTheme?.preset && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => chooseModel(previewTheme)} disabled={busy}>
                {t("useModel")}
              </button>
            )}
            <button type="button" className="a-btn a-btn-small" onClick={() => void stopPreview(() => router.refresh())} data-testid="theme-stop-preview">
              {t("stopPreview")}
            </button>
          </p>
        </div>
      )}
      {hasCustom && (
        <div className="a-notice" role="note" data-testid="custom-colors-notice">
          <p>
            {t.rich("customColors", { names: customNames.join(", ").toLowerCase(), b: (c) => <strong>{c}</strong> })}
          </p>
          <p className="a-card-actions">
            <button type="button" className="a-btn a-btn-small" onClick={resetColors} disabled={busy} data-testid="custom-colors-reset">
              {t("resetToTheme")}
            </button>
          </p>
        </div>
      )}
      {previous && (
        <p className="a-help" data-testid="theme-previous">
          {t.rich("previousTheme", { name: previous.name, b: (c) => <strong>{c}</strong> })}{" "}
          <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => revert(previous)} disabled={busy} data-testid="theme-revert">
            {t("revertPrevious")}
          </button>
        </p>
      )}

      {/* ---- Mon thème ---- */}
      <section className="a-themes-section" aria-labelledby="themes-mine-title" data-testid="mine-section">
        <h2 id="themes-mine-title" className="a-themes-title">
          {t("mineTitle")}
        </h2>
        {mine ? (
          <section className="a-card a-theme-card a-mine-card" aria-labelledby={`theme-${mine.id}`} data-active={mine.live} data-preparing={previewsMineDraft || undefined} data-testid="mine-card">
            <LiveThumb themeRef={mine.id} stamp={`${mine.version}-${mine.updatedAt}`} theme={shown(mine.theme)} />
            <div className="a-mine-body">
              <div className="a-card-head">
                <h2 id={`theme-${mine.id}`}>{mine.name}</h2>
                {mine.live ? (
                  <span className="a-badge a-badge-live" data-testid="theme-live">
                    <span aria-hidden="true">●</span> {t("live")}
                  </span>
                ) : (
                  <span className="a-badge" data-testid="mine-draft-badge">
                    {t("draft")}
                  </span>
                )}
                {previewsMineDraft && (
                  <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                    <span aria-hidden="true">●</span> {t("working")}
                  </span>
                )}
              </div>
              <p className="a-mine-meta" data-testid="mine-based-on">
                {mine.basedOn ? t("basedOn", { name: mine.basedOn }) : t("ownTheme")}
              </p>
              <p className="a-mine-meta" data-testid="mine-version">
                {t("versionLine", { version: mine.version, when: formatWhen(mine.updatedAt, locale) })}
              </p>
              <p className="a-mine-state" data-testid="mine-state">
                {mine.live
                  ? mineDiffers
                    ? t("stateLiveDraft", { published: mine.publishedVersion ?? "", version: mine.version })
                    : t("stateLive", { published: mine.publishedVersion ?? "" })
                  : mine.publishedVersion != null
                    ? t("stateOffline", { published: mine.publishedVersion, version: mine.version })
                    : t("stateNever", { version: mine.version })}
              </p>
              <ThemeSwatches theme={shown(mine.theme)} />
              <div className="a-card-actions">
                {mineNeedsPublish && (
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })} data-testid="mine-publish">
                    {mine.live ? t("publishVersion") : t("goLiveVersion")}
                  </button>
                )}
                {mineNeedsPublish && (
                  <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(mine.theme)} data-testid="theme-work">
                    {t("workOnDraft")}
                  </button>
                )}
                <Link className="a-btn a-btn-small" href={`/admin/themes/${encodeURIComponent(mine.id)}`} data-testid="mine-edit">
                  {t("edit")}
                </Link>
                <PreviewButton id={mine.id} small testId="mine-preview" />
                <KitMenu theme={mine.theme} />
                <Link className="a-btn a-btn-small" href={`/admin/themes/${encodeURIComponent(mine.id)}/versions`} data-testid="mine-history">
                  {t("history", { count: mine.versions })}
                </Link>
                <MoreMenu theme={mine.theme} />
              </div>
            </div>
          </section>
        ) : (
          <div className="a-card a-mine-empty" data-testid="mine-empty">
            <h3>{t("emptyTitle")}</h3>
            <p>
              {t.rich("emptyBody", { b: (c) => <strong>{c}</strong> })}
            </p>
            {liveTheme && (
              <p className="a-help">
                {t("emptyLive", { name: liveTheme.name })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---- Repartir d'un modèle ---- */}
      <section className="a-themes-section" aria-labelledby="themes-models-title" data-testid="models-section">
        <h2 id="themes-models-title" className="a-themes-title">
          {mine ? t("modelsRestart") : t("modelsTitle")}
        </h2>
        <p className="a-help">{mine ? t("modelsHelpReplace") : t("modelsHelpCreate")}</p>
        <div className="a-grid a-theme-grid">
          {models.map((theme) => {
            const isActive = theme.id === activeId;
            const isPreparing = previewTheme?.id === theme.id;
            return (
              <section key={theme.id} className="a-card a-theme-card" aria-labelledby={`theme-${theme.id}`} data-active={isActive} data-preparing={isPreparing || undefined} data-model="">
                <div className="a-card-head">
                  <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
                  {isActive ? (
                    <span className="a-badge a-badge-live" data-testid="theme-live">
                      <span aria-hidden="true">●</span> {t("live")}
                    </span>
                  ) : isPreparing ? (
                    <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                      <span aria-hidden="true">●</span> {t("working")}
                    </span>
                  ) : (
                    <span className="a-tag">{t("modelTag")}</span>
                  )}
                </div>
                <ThemeThumb theme={shown(theme)} src={thumbs[theme.id]} />
                <ThemeSwatches theme={shown(theme)} />
                {hasCustom && <p className="a-help a-theme-custom-note">{t("customNote")}</p>}
                <div className="a-card-actions">
                  {!isActive && (
                    <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(theme)} data-testid="theme-work">
                      {t("workOnDraft")}
                    </button>
                  )}
                  <PreviewButton id={theme.id} small />
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => chooseModel(theme)} disabled={busy} data-testid="use-model">
                    {t("useModel")}
                  </button>
                  <MoreMenu theme={theme} colorsLink />
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {/* ---- Mes anciens thèmes ---- */}
      {olds.length > 0 && (
        <details className="a-themes-section a-fold a-olds" data-testid="olds-section" open={Boolean(previewTheme && olds.some((o) => o.theme.id === previewTheme.id)) || undefined}>
          <summary>
            <span className="a-themes-title">{t("oldsTitle", { count: olds.length })}</span>
          </summary>
          <p className="a-help">
            {t("oldsHelp")}
          </p>
          <div className="a-grid a-theme-grid">
            {olds.map(({ theme, updatedAt }) => {
              const isActive = theme.id === activeId;
              const isPreparing = previewTheme?.id === theme.id;
              return (
                <section key={theme.id} className="a-card a-theme-card" aria-labelledby={`theme-${theme.id}`} data-active={isActive} data-preparing={isPreparing || undefined} data-old="">
                  <div className="a-card-head">
                    <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
                    {isActive ? (
                      <span className="a-badge a-badge-live" data-testid="theme-live">
                        <span aria-hidden="true">●</span> {t("live")}
                      </span>
                    ) : isPreparing ? (
                      <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                        <span aria-hidden="true">●</span> {t("working")}
                      </span>
                    ) : (
                      <span className="a-tag">{t("oldTag")}</span>
                    )}
                  </div>
                  <LiveThumb themeRef={theme.id} stamp={updatedAt} theme={shown(theme)} />
                  <ThemeSwatches theme={shown(theme)} />
                  <p className="a-help">{t("modifiedOn", { when: formatWhen(updatedAt, locale) })}</p>
                  <div className="a-card-actions">
                    {!isActive && (
                      <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(theme)} data-testid="theme-work">
                        {t("workOnDraft")}
                      </button>
                    )}
                    <PreviewButton id={theme.id} small />
                    <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => adopt(theme)} disabled={busy} data-testid="old-adopt">
                      {t("adopt")}
                    </button>
                    <MoreMenu theme={theme} onDelete={isActive ? undefined : () => setPending({ kind: "delete", theme })} />
                  </div>
                </section>
              );
            })}
          </div>
        </details>
      )}

      <ConfirmDialog
        open={pending?.kind === "activate"}
        title={pending?.kind === "activate" && pending.mine ? t("activateMineTitle", { version: mine?.version ?? "", name: pending.theme.name }) : t("activateTitle", { name: pending?.kind === "activate" ? pending.theme.name : "" })}
        confirmLabel={pending?.kind === "activate" && pending.mine ? t("publish") : t("goLive")}
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
          setKeepColors(true);
        }}
        onConfirm={() => pending?.kind === "activate" && publish(pending.theme, hasCustom && !keepColors, pending.mine)}
        extra={pending?.kind === "activate" && <PreviewButton id={pending.theme.id} label={t("previewFirst")} />}
      >
        <p className="a-swap" data-testid="activate-swap">
          <span>{pending?.kind === "activate" && pending.mine && mine?.live ? t("stateLive", { published: mine.publishedVersion ?? "" }) : (liveTheme?.name ?? t("noTheme"))}</span>
          <span aria-hidden="true">→</span>
          <strong>{pending?.kind === "activate" && pending.mine ? t("swapMine", { name: pending.theme.name, version: mine?.version ?? "" }) : pending?.kind === "activate" ? pending.theme.name : ""}</strong>
        </p>
        <p className="muted">{t("visitorsSee")}</p>
        {pending?.kind === "activate" && pending.mine && mine?.live && mine.published && (
          <ul className="a-da-changes" data-testid="activate-changes">
            {SITE_ROLES.filter((r) => String(pending.theme.tokens.color[r.key]).toLowerCase() !== String(mine.published!.tokens.color[r.key]).toLowerCase()).map((r) => (
              <li key={r.key}>
                {t("roleChange", { name: r.name })} <span className="a-chip" style={{ background: mine.published!.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{mine.published!.tokens.color[r.key]}</span> →{" "}
                <span className="a-chip" style={{ background: pending.theme.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{pending.theme.tokens.color[r.key]}</span>
              </li>
            ))}
          </ul>
        )}
        {hasCustom && (
          <fieldset className="a-fieldset" data-testid="activate-colors">
            <legend>{t("customLegend")}</legend>
            <p className="muted">{t("customKeep", { names: customNames.slice(0, 3).join(", ").toLowerCase() })}</p>
            <label className="a-check">
              <input type="radio" name="keep-colors" checked={keepColors} onChange={() => setKeepColors(true)} /> {t("keepThem")}
            </label>
            <label className="a-check">
              <input type="radio" name="keep-colors" checked={!keepColors} onChange={() => setKeepColors(false)} /> {t("useNewColors")}
            </label>
          </fieldset>
        )}
        {pending?.kind === "activate" &&
          (() => {
            const ignored = accents.filter((a) => accentProblem(a.accent, pending.theme.tokens.color));
            return ignored.length > 0 ? (
              <div className="a-notice">
                <p>{t("accentWarn")}</p>
                <ul className="a-refs">
                  {ignored.map((a) => (
                    <li key={a.id}>
                      <Link href={`/admin/pages/${a.id}`}>{a.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })()}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "replace"}
        title={t("replaceTitle", { version: mine?.version ?? "", name: pending?.kind === "replace" ? pending.model.name : "" })}
        confirmLabel={t("replace")}
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending?.kind === "replace" && replaceWith(pending.model, "replace")}
        extra={
          pending?.kind === "replace" && (
            <button type="button" className="a-btn" onClick={() => replaceWith(pending.model, "second")} disabled={busy} data-testid="replace-second">
              {t("createSecond")}
            </button>
          )
        }
      >
        <p data-testid="replace-text">{t("replaceText", { version: mine?.version ?? "" })}</p>
        <p className="muted">
          {t("replaceHelp", { version: mine?.version ?? "" })}
        </p>
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title={t("deleteTitle", { name: pending?.kind === "delete" ? pending.theme.name : "" })}
        confirmLabel={t("delete")}
        danger
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending?.kind === "delete" && remove(pending.theme)}
      >
        <p className="muted">{t("deleteBody")}</p>
        {pending?.kind === "delete" && pending.theme.id === previewBase && <p className="muted">{t("deletePreviewing")}</p>}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
