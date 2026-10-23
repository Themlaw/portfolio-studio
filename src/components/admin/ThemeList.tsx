"use client";

/**
 * Écran Thèmes (lot 60) : « Mon thème » en haut (une vignette réelle de l'accueil, « basé sur », version, état, actions), puis
 * « Repartir d'un modèle » (les thèmes fournis ne se modifient jamais), puis « Mes anciens thèmes » (repliée).
 */
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
export function PreviewButton({ id, label = "Prévisualiser", small, testId }: { id: string; label?: string; small?: boolean; testId?: string }) {
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="id" value={id} />
      {/* « Quitter l'aperçu » (bandeau, Échap) ramène à cet écran. */}
      <input type="hidden" name="retour" value="/admin/themes" />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`} data-testid={testId}>
        {label} <span aria-hidden="true">↗</span>
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
  const kit = useKitDownload(theme.id);
  const id = encodeURIComponent(theme.id);
  return (
    <>
      <MenuTrigger>
        <AriaButton className="a-btn a-btn-small" data-testid="mine-kit-menu">
          Kit Photoshop <span aria-hidden="true">▾</span>
        </AriaButton>
        <Popover className="a-menu-popover" placement="bottom start" offset={4}>
          <Menu className="a-menu" aria-label="Kit Photoshop de mon thème">
            <MenuItem className="a-menu-item" onAction={() => void kit.start()} isDisabled={kit.busy || kit.blocked} textValue="Télécharger le kit Photoshop">
              <Text slot="label">{kit.busy ? "Préparation du kit…" : "Télécharger le kit Photoshop"}</Text>
              <Text slot="description">Un fichier de calques à redessiner (comptez jusqu&apos;à 20 secondes de préparation).</Text>
            </MenuItem>
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}/kit`} textValue="Renvoyer le kit rempli" data-testid="mine-kit-send">
              <Text slot="label">Renvoyer le kit rempli…</Text>
              <Text slot="description">Après l&apos;avoir redessiné : vérifie, puis ajoute une version à mon thème.</Text>
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      {kit.busy && (
        <span className="a-kit-progress" data-testid="kit-card-progress">
          <span className="a-spinner" aria-hidden="true" />
          {kit.status || "Préparation du kit…"}
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
  const id = encodeURIComponent(theme.id);
  return (
    <MenuTrigger>
      <AriaButton className="a-btn a-btn-small a-menu-btn" aria-label={`Plus d'actions pour ${theme.name}`}>
        <span aria-hidden="true">…</span>
      </AriaButton>
      <Popover className="a-menu-popover" placement="bottom end" offset={4}>
        <Menu className="a-menu" aria-label={`Actions de ${theme.name}`}>
          {colorsLink && (
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}#couleurs`} data-testid="theme-da-link" textValue="Voir les couleurs">
              <Text slot="label">Voir les couleurs</Text>
              <Text slot="description">Les couleurs du modèle, avec aperçu (rien n&apos;est modifié).</Text>
            </MenuItem>
          )}
          <MenuItem
            className="a-menu-item"
            href={`/admin/api/themes/${id}/export`}
            download={`theme-${theme.id}.zip`}
            textValue="Exporter le thème (.zip)"
            onAction={() => toast(`Archive en cours de téléchargement : theme-${theme.id}.zip`)}
          >
            <Text slot="label">Exporter le thème (.zip)</Text>
            <Text slot="description">Une archive à réimporter sur ce site ou un autre.</Text>
          </MenuItem>
          {onDelete && (
            <MenuItem className="a-menu-item a-menu-item-danger" onAction={onDelete} textValue="Supprimer ce thème" data-testid="old-delete">
              <Text slot="label">Supprimer ce thème…</Text>
              <Text slot="description">Demande une confirmation. Tes pages et tes œuvres ne changent pas.</Text>
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
  const publish = (theme: Theme, resetColors: boolean, label: string) =>
    startTransition(async () => {
      setError(null);
      const before = liveTheme;
      const result = await activateThemeAction(theme.id, { resetColors });
      if (!result.ok) {
        setError(result.message ?? "L'action a échoué.");
        return;
      }
      setPending(null);
      toast(`${label} mis en ligne`, "success", before && before.id !== theme.id ? { label: `Revenir à « ${before.name} »`, run: () => void revert(before) } : undefined, UNDO_MS);
      router.refresh();
    });
  const revert = (to: Theme) =>
    startTransition(async () => {
      const result = await activateThemeAction(to.id);
      if (!result.ok) return toast(result.message ?? "L'action a échoué.", "error");
      toast(`« ${to.name} » est de nouveau en ligne`);
      router.refresh();
    });
  const resetColors = () =>
    startTransition(async () => {
      const result = await resetSiteColorsAction();
      if (!result.ok) return toast(result.message ?? "L'action a échoué.", "error");
      toast("Les couleurs du thème sont de retour");
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
      toast("Le thème n'a pas pu être ouvert dans l'éditeur. Réessaie.", "error");
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
          ? `Mon thème créé à partir de « ${model.name} » (version 1) : il est déjà en ligne`
          : `Mon thème créé à partir de « ${model.name} » (version 1) : pas encore en ligne, prévisualise-le puis publie`,
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
        toast(`Second thème créé : « ${model.name} » (dans « Mes anciens thèmes »)`);
        router.refresh();
      } else {
        toast(`Mon thème : version ${result.data.version} créée à partir de « ${model.name} »`);
        router.push(`/admin/themes?nouvelle=${result.data.version}&via=model`);
      }
    });
  const adopt = (old: Theme) =>
    startTransition(async () => {
      const result = await adoptOldThemeAction(old.id);
      if (!result.ok) return toast(result.message, "error");
      toast(`« ${old.name} » est maintenant Mon thème (version ${result.data.version})`);
      router.push(`/admin/themes?nouvelle=${result.data.version}&via=adopt`);
    });
  const remove = (theme: Theme) =>
    startTransition(async () => {
      setError(null);
      const result = await deleteThemeAction(theme.id);
      if (!result.ok) {
        setError(result.message ?? "L'action a échoué.");
        return;
      }
      setPending(null);
      toast(`« ${theme.name} » supprimé`);
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
          Thème en ligne : <strong>{liveTheme.name}</strong>
          {mine?.live ? <span> (version {mine.publishedVersion})</span> : null}
        </p>
      )}
      {notice && mine && (
        <div className="a-notice" role="status" data-testid="new-version-notice">
          <p>
            <strong>Version {notice.version} de Mon thème créée</strong>
            {notice.via === "kit" ? " avec ton kit Photoshop" : notice.via === "import" ? " depuis l'archive importée" : notice.via === "model" ? " à partir du modèle" : notice.via === "adopt" ? " à partir d'un ancien thème" : ""}. Elle n&apos;est pas encore en ligne : tes visiteurs voient toujours{" "}
            {mine.live ? `la version ${mine.publishedVersion}` : `« ${liveTheme?.name ?? "le thème en ligne"} »`}.
          </p>
          <p className="a-card-actions">
            <PreviewButton id={mine.id} small label="Prévisualiser" testId="notice-preview" />
            <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })} data-testid="notice-publish">
              Publier cette version
            </button>
            <Link className="a-btn a-btn-small a-btn-quiet" href="/admin/themes">
              Plus tard
            </Link>
          </p>
        </div>
      )}
      {preparing && (
        <div className="a-notice a-theme-preparing" role="status" data-testid="theme-preparing-banner">
          {previewVersion ? (
            <p>
              Tu regardes la <strong>version {previewVersion}</strong> de <strong>{mine?.name ?? "Mon thème"}</strong> : elle n&apos;est pas en ligne.
            </p>
          ) : previewsMineDraft ? (
            <p>
              Tu prépares la <strong>version {mine?.version}</strong> de <strong>{mine?.name}</strong> (brouillon) : elle n&apos;est pas encore en ligne.
            </p>
          ) : (
            <p>
              Tu prépares le thème <strong>{preparing.name}</strong> : il n&apos;est pas encore en ligne.
            </p>
          )}
          <p className="a-card-actions">
            {previewsMineDraft && mine && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })}>
                Publier cette version
              </button>
            )}
            {previewTheme && !previewTheme.preset && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: previewTheme, mine: false })}>
                Mettre en ligne
              </button>
            )}
            {previewTheme?.preset && (
              <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => chooseModel(previewTheme)} disabled={busy}>
                Utiliser ce modèle
              </button>
            )}
            <button type="button" className="a-btn a-btn-small" onClick={() => void stopPreview(() => router.refresh())} data-testid="theme-stop-preview">
              Arrêter l&apos;aperçu
            </button>
          </p>
        </div>
      )}
      {hasCustom && (
        <div className="a-notice" role="note" data-testid="custom-colors-notice">
          <p>
            <strong>Couleurs personnalisées du site</strong> : {customNames.join(", ").toLowerCase()}. Elles restent appliquées par-dessus le thème en ligne, quel que soit le thème.
          </p>
          <p className="a-card-actions">
            <button type="button" className="a-btn a-btn-small" onClick={resetColors} disabled={busy} data-testid="custom-colors-reset">
              Revenir aux couleurs du thème
            </button>
          </p>
        </div>
      )}
      {previous && (
        <p className="a-help" data-testid="theme-previous">
          Thème précédent : <strong>{previous.name}</strong>{" "}
          <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => revert(previous)} disabled={busy} data-testid="theme-revert">
            Revenir au thème précédent
          </button>
        </p>
      )}

      {/* ---- Mon thème ---- */}
      <section className="a-themes-section" aria-labelledby="themes-mine-title" data-testid="mine-section">
        <h2 id="themes-mine-title" className="a-themes-title">
          Mon thème
        </h2>
        {mine ? (
          <section className="a-card a-theme-card a-mine-card" aria-labelledby={`theme-${mine.id}`} data-active={mine.live} data-preparing={previewsMineDraft || undefined} data-testid="mine-card">
            <LiveThumb themeRef={mine.id} stamp={`${mine.version}-${mine.updatedAt}`} theme={shown(mine.theme)} />
            <div className="a-mine-body">
              <div className="a-card-head">
                <h2 id={`theme-${mine.id}`}>{mine.name}</h2>
                {mine.live ? (
                  <span className="a-badge a-badge-live" data-testid="theme-live">
                    <span aria-hidden="true">●</span> En ligne
                  </span>
                ) : (
                  <span className="a-badge" data-testid="mine-draft-badge">
                    Brouillon
                  </span>
                )}
                {previewsMineDraft && (
                  <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                    <span aria-hidden="true">●</span> En travail
                  </span>
                )}
              </div>
              <p className="a-mine-meta" data-testid="mine-based-on">
                {mine.basedOn ? <>basé sur « {mine.basedOn} »</> : "Mon thème à moi"}
              </p>
              <p className="a-mine-meta" data-testid="mine-version">
                Version {mine.version} · modifiée le {formatWhen(mine.updatedAt)}
              </p>
              <p className="a-mine-state" data-testid="mine-state">
                {mine.live
                  ? mineDiffers
                    ? `En ligne : v${mine.publishedVersion} · brouillon : v${mine.version}`
                    : `En ligne : v${mine.publishedVersion}`
                  : mine.publishedVersion != null
                    ? `Pas en ligne · dernière version publiée : v${mine.publishedVersion} · brouillon : v${mine.version}`
                    : `Pas encore en ligne · brouillon : v${mine.version}`}
              </p>
              <ThemeSwatches theme={shown(mine.theme)} />
              <div className="a-card-actions">
                {mineNeedsPublish && (
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: mine.theme, mine: true })} data-testid="mine-publish">
                    {mine.live ? "Publier cette version" : "Mettre en ligne cette version"}
                  </button>
                )}
                {mineNeedsPublish && (
                  <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(mine.theme)} data-testid="theme-work">
                    Travailler au brouillon dessus
                  </button>
                )}
                <Link className="a-btn a-btn-small" href={`/admin/themes/${encodeURIComponent(mine.id)}`} data-testid="mine-edit">
                  Modifier
                </Link>
                <PreviewButton id={mine.id} small testId="mine-preview" />
                <KitMenu theme={mine.theme} />
                <Link className="a-btn a-btn-small" href={`/admin/themes/${encodeURIComponent(mine.id)}/versions`} data-testid="mine-history">
                  Historique des versions ({mine.versions})
                </Link>
                <MoreMenu theme={mine.theme} />
              </div>
            </div>
          </section>
        ) : (
          <div className="a-card a-mine-empty" data-testid="mine-empty">
            <h3>Choisis un modèle pour commencer</h3>
            <p>
              Tu n&apos;as pas encore de thème à toi. Choisis un modèle ci-dessous : « Utiliser ce modèle » crée <strong>Mon thème</strong>, que tu fais ensuite évoluer
              (couleurs, kit Photoshop, import…), version après version : tu peux toujours revenir en arrière. Ton site ne change pas tant que tu ne publies pas.
            </p>
            {liveTheme && (
              <p className="a-help">
                En ce moment, ton site utilise le modèle « {liveTheme.name} ».
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---- Repartir d'un modèle ---- */}
      <section className="a-themes-section" aria-labelledby="themes-models-title" data-testid="models-section">
        <h2 id="themes-models-title" className="a-themes-title">
          {mine ? "Repartir d'un modèle" : "Modèles"}
        </h2>
        <p className="a-help">Les modèles ne changent jamais : « Utiliser ce modèle » {mine ? "remplace Mon thème par une nouvelle version" : "crée Mon thème"} (tu pourras revenir en arrière).</p>
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
                      <span aria-hidden="true">●</span> En ligne
                    </span>
                  ) : isPreparing ? (
                    <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                      <span aria-hidden="true">●</span> En travail
                    </span>
                  ) : (
                    <span className="a-tag">Modèle</span>
                  )}
                </div>
                <ThemeThumb theme={shown(theme)} src={thumbs[theme.id]} />
                <ThemeSwatches theme={shown(theme)} />
                {hasCustom && <p className="a-help a-theme-custom-note">Avec tes couleurs personnalisées.</p>}
                <div className="a-card-actions">
                  {!isActive && (
                    <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(theme)} data-testid="theme-work">
                      Travailler au brouillon dessus
                    </button>
                  )}
                  <PreviewButton id={theme.id} small />
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => chooseModel(theme)} disabled={busy} data-testid="use-model">
                    Utiliser ce modèle
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
            <span className="a-themes-title">Mes anciens thèmes ({olds.length})</span>
          </summary>
          <p className="a-help">
            Les copies, kits et imports d&apos;avant, gardés tels quels. « En faire mon thème » en fait une nouvelle version de Mon thème ; rien n&apos;est supprimé sans que tu le demandes.
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
                        <span aria-hidden="true">●</span> En ligne
                      </span>
                    ) : isPreparing ? (
                      <span className="a-badge a-badge-prep a-badge-live" data-testid="theme-preparing">
                        <span aria-hidden="true">●</span> En travail
                      </span>
                    ) : (
                      <span className="a-tag">Ancien thème</span>
                    )}
                  </div>
                  <LiveThumb themeRef={theme.id} stamp={updatedAt} theme={shown(theme)} />
                  <ThemeSwatches theme={shown(theme)} />
                  <p className="a-help">Modifié le {formatWhen(updatedAt)}</p>
                  <div className="a-card-actions">
                    {!isActive && (
                      <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(theme)} data-testid="theme-work">
                        Travailler au brouillon dessus
                      </button>
                    )}
                    <PreviewButton id={theme.id} small />
                    <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => adopt(theme)} disabled={busy} data-testid="old-adopt">
                      En faire mon thème (nouvelle version)
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
        title={pending?.kind === "activate" && pending.mine ? `Publier la version ${mine?.version ?? ""} de « ${pending.theme.name} » ?` : `Mettre en ligne « ${pending?.kind === "activate" ? pending.theme.name : ""} » ?`}
        confirmLabel={pending?.kind === "activate" && pending.mine ? "Publier" : "Mettre en ligne"}
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
          setKeepColors(true);
        }}
        onConfirm={() => pending?.kind === "activate" && publish(pending.theme, hasCustom && !keepColors, pending.mine ? `« ${pending.theme.name} », version ${mine?.version ?? ""},` : `« ${pending.theme.name} »`)}
        extra={pending?.kind === "activate" && <PreviewButton id={pending.theme.id} label="Prévisualiser d'abord" />}
      >
        <p className="a-swap" data-testid="activate-swap">
          <span>{pending?.kind === "activate" && pending.mine && mine?.live ? `En ligne : v${mine.publishedVersion}` : (liveTheme?.name ?? "Aucun thème")}</span>
          <span aria-hidden="true">→</span>
          <strong>{pending?.kind === "activate" && pending.mine ? `${pending.theme.name} : v${mine?.version}` : pending?.kind === "activate" ? pending.theme.name : ""}</strong>
        </p>
        <p className="muted">Tous tes visiteurs verront ce thème dès maintenant, sur toutes les pages.</p>
        {pending?.kind === "activate" && pending.mine && mine?.live && mine.published && (
          <ul className="a-da-changes" data-testid="activate-changes">
            {SITE_ROLES.filter((r) => String(pending.theme.tokens.color[r.key]).toLowerCase() !== String(mine.published!.tokens.color[r.key]).toLowerCase()).map((r) => (
              <li key={r.key}>
                {r.name} : <span className="a-chip" style={{ background: mine.published!.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{mine.published!.tokens.color[r.key]}</span> →{" "}
                <span className="a-chip" style={{ background: pending.theme.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{pending.theme.tokens.color[r.key]}</span>
              </li>
            ))}
          </ul>
        )}
        {hasCustom && (
          <fieldset className="a-fieldset" data-testid="activate-colors">
            <legend>Tes couleurs personnalisées</legend>
            <p className="muted">Tes couleurs personnalisées ({customNames.slice(0, 3).join(", ").toLowerCase()}…) restent appliquées par-dessus.</p>
            <label className="a-check">
              <input type="radio" name="keep-colors" checked={keepColors} onChange={() => setKeepColors(true)} /> Les garder
            </label>
            <label className="a-check">
              <input type="radio" name="keep-colors" checked={!keepColors} onChange={() => setKeepColors(false)} /> Revenir aux couleurs du nouveau thème
            </label>
          </fieldset>
        )}
        {pending?.kind === "activate" &&
          (() => {
            const ignored = accents.filter((a) => accentProblem(a.accent, pending.theme.tokens.color));
            return ignored.length > 0 ? (
              <div className="a-notice">
                <p>Avec ce thème, la couleur propre des boutons et liens de ces pages serait peu lisible (elle reste appliquée) :</p>
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
        title={`Remplacer mon thème (version ${mine?.version ?? ""}) par ${pending?.kind === "replace" ? pending.model.name : ""} ?`}
        confirmLabel="Remplacer"
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending?.kind === "replace" && replaceWith(pending.model, "replace")}
        extra={
          pending?.kind === "replace" && (
            <button type="button" className="a-btn" onClick={() => replaceWith(pending.model, "second")} disabled={busy} data-testid="replace-second">
              Créer un second thème
            </button>
          )
        }
      >
        <p data-testid="replace-text">Tu pourras revenir à la version {mine?.version}.</p>
        <p className="muted">
          « Remplacer » ajoute une nouvelle version à Mon thème (la version {mine?.version} reste dans l&apos;historique). « Créer un second thème » garde Mon thème tel quel et range le modèle dans « Mes anciens thèmes ». Ton site ne change pas tant que tu ne publies pas.
        </p>
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title={`Supprimer le thème « ${pending?.kind === "delete" ? pending.theme.name : ""} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending?.kind === "delete" && remove(pending.theme)}
      >
        <p className="muted">Ses couleurs et réglages seront perdus. Tes pages et tes œuvres ne changent pas.</p>
        {pending?.kind === "delete" && pending.theme.id === previewBase && <p className="muted">Tu es en train de le prévisualiser : l&apos;aperçu s&apos;arrête aussi et le site te montre de nouveau le thème en ligne.</p>}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
