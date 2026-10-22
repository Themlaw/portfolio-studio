"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator, Text } from "react-aria-components";

import {
  activateThemeAction,
  deleteThemeAction,
  duplicateThemeAction,
  resetSiteColorsAction,
} from "@/app/admin/(espace)/themes/actions";
import type { SitePalette } from "@/lib/look";
import { accentProblem } from "@/themes/contrast";
import type { Theme } from "@/themes/schema";
import { NUANCE_KEYS } from "@/themes/palette";
import { applySitePalette, SITE_NUANCES, SITE_ROLES } from "@/themes/site-palette";

import { useKitDownload } from "./KitDownloadButton";
import { ConfirmDialog, toast, UNDO_MS } from "./editing";
import ThemeSwatches from "./ThemeSwatches";
import ThemeThumb from "./ThemeThumb";

/** Formulaire natif : l'aperçu s'ouvre dans un nouvel onglet (l'admin reste ici). */
function PreviewButton({ id, label = "Prévisualiser", small }: { id: string; label?: string; small?: boolean }) {
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="id" value={id} />
      {/* « Quitter l'aperçu » (bandeau, Échap) ramène à cet écran. */}
      <input type="hidden" name="retour" value="/admin/themes" />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`}>
        {label} <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

type Pending = { kind: "activate" | "delete"; theme: Theme } | null;

/**
 * Actions secondaires d'une carte de thème, derrière « … » : de quoi garder la carte lisible (Prévisualiser,
 * Mettre en ligne / Modifier seulement). Les deux téléchargements ont des noms et des phrases distincts :
 * l'archive du thème (se réimporte) n'est pas le kit Photoshop (se redessine).
 */
function ThemeMenu({ theme, isActive, busy, onDuplicate, onDelete }: { theme: Theme; isActive: boolean; busy: boolean; onDuplicate: () => void; onDelete: () => void }) {
  const kit = useKitDownload(theme.id);
  const id = encodeURIComponent(theme.id);
  return (
    <>
      <MenuTrigger>
        <AriaButton className="a-btn a-btn-small a-menu-btn" aria-label={`Plus d'actions pour ${theme.name}`}>
          <span aria-hidden="true">…</span>
        </AriaButton>
        <Popover className="a-menu-popover" placement="bottom end" offset={4}>
          <Menu className="a-menu" aria-label={`Actions de ${theme.name}`}>
            {/* Un thème à toi s'ouvre par « Modifier » (même écran) : « Voir les couleurs » n'existe que pour un thème fourni. */}
            {theme.preset && (
              <MenuItem className="a-menu-item" href={`/admin/themes/${id}#couleurs`} data-testid="theme-da-link" textValue="Voir les couleurs">
                <Text slot="label">Voir les couleurs</Text>
                <Text slot="description">Les couleurs du thème, avec aperçu.</Text>
              </MenuItem>
            )}
            <MenuItem className="a-menu-item" onAction={onDuplicate} isDisabled={busy} textValue="Dupliquer">
              <Text slot="label">Dupliquer</Text>
              <Text slot="description">Une copie que tu peux modifier.</Text>
            </MenuItem>
            <Separator className="a-menu-sep" />
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
            <MenuItem className="a-menu-item" onAction={() => void kit.start()} isDisabled={kit.busy || kit.blocked} textValue="Télécharger le kit Photoshop">
              <Text slot="label">{kit.busy ? "Préparation du kit…" : "Télécharger le kit Photoshop"}</Text>
              <Text slot="description">Un fichier de calques à redessiner dans Photoshop.</Text>
            </MenuItem>
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}/kit`} textValue="Renvoyer le kit Photoshop">
              <Text slot="label">Renvoyer le kit Photoshop</Text>
              <Text slot="description">Après l&apos;avoir redessiné : vérifie puis applique.</Text>
            </MenuItem>
            {!theme.preset && !isActive && (
              <>
                <Separator className="a-menu-sep" />
                <MenuItem className="a-menu-item a-menu-danger" onAction={onDelete} textValue="Supprimer">
                  <Text slot="label">Supprimer</Text>
                </MenuItem>
              </>
            )}
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

export default function ThemeList({
  themes,
  activeId,
  accents,
  thumbs = {},
  preparingId = null,
  previewOn = false,
  previousId = null,
  customColors = {},
  editorPageId = null,
}: {
  themes: Theme[];
  activeId: string;
  /** Thème prévisualisé, pas encore en ligne (lot 55). */
  preparingId?: string | null;
  /** Un aperçu (thème ou pages non publiées) est ouvert dans ce navigateur. */
  previewOn?: boolean;
  /** Thème qui était en ligne avant le dernier changement. */
  previousId?: string | null;
  /** Couleurs personnalisées du site, publiées par-dessus le thème en ligne. */
  customColors?: SitePalette;
  /** Vignettes générées des thèmes livrés (id → chemin public). */
  thumbs?: Record<string, string | null>;
  accents: { id: number; title: string; accent: string }[];
  /** Page que « Travailler au brouillon dessus » ouvre : la dernière modifiée, sinon l'accueil (lot 63). */
  editorPageId?: number | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [keepColors, setKeepColors] = useState(true);
  const active = themes.find((t) => t.id === activeId);
  const preparing = themes.find((t) => t.id === preparingId);
  const previous = themes.find((t) => t.id === previousId);
  const customNames = [...SITE_ROLES.filter((r) => customColors[r.key]).map((r) => r.name), ...NUANCE_KEYS.filter((k) => customColors[k] && customColors[k] !== "auto").map((k) => SITE_NUANCES[k].name)];
  const hasCustom = customNames.length > 0;

  /** Mise en ligne, puis un toast « Revenir au thème précédent » pendant un temps raisonnable (et l'encart permanent). */
  const publish = (theme: Theme, resetColors: boolean) =>
    startTransition(async () => {
      setError(null);
      const before = active;
      const result = await activateThemeAction(theme.id, { resetColors });
      if (!result.ok) {
        setError(result.message ?? "L'action a échoué.");
        return;
      }
      setPending(null);
      toast(`« ${theme.name} » mis en ligne`, "success", before ? { label: `Revenir à « ${before.name} »`, run: () => void revert(before) } : undefined, UNDO_MS);
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

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) {
        setError(result.message ?? "L'action a échoué.");
        return;
      }
      setPending(null);
      toast(success);
      after?.();
      router.refresh();
    });

  const duplicate = (theme: Theme) =>
    startTransition(async () => {
      const result = await duplicateThemeAction(theme.id);
      if (!result.ok) return toast(result.message, "error");
      toast(`Copie créée : « ${theme.name} (copie) »`);
      router.push(`/admin/themes/${result.data.id}`);
    });

  return (
    <>
      {active && (
        <p className="a-theme-live" data-testid="theme-live-banner">
          Thème en ligne : <strong>{active.name}</strong>
        </p>
      )}
      {preparing && (
        <div className="a-notice a-theme-preparing" role="status" data-testid="theme-preparing-banner">
          <p>
            Tu prépares le thème <strong>{preparing.name}</strong> : il n&apos;est pas encore en ligne.
          </p>
          <p className="a-card-actions">
            <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme: preparing })}>
              Mettre en ligne
            </button>
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
      <div className="a-grid a-theme-grid">
        {themes.map((theme) => {
          const isActive = theme.id === activeId;
          const isPreparing = theme.id === preparingId;
          // Ce qui serait vraiment publié : les couleurs personnalisées par-dessus le thème (vignette dessinée et pastilles).
          const shown = hasCustom ? { ...theme, tokens: { ...theme.tokens, color: applySitePalette(theme.tokens.color, theme.tokens.palette, customColors).color } } : theme;
          return (
            <section key={theme.id} className="a-card a-theme-card" aria-labelledby={`theme-${theme.id}`} data-active={isActive} data-preparing={isPreparing || undefined}>
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
                  <span className="a-tag">{theme.preset ? "Thème fourni" : "Mon thème"}</span>
                )}
              </div>
              <ThemeThumb theme={shown} src={theme.preset ? thumbs[theme.id] : null} />
              <ThemeSwatches theme={shown} />
              {hasCustom && <p className="a-help a-theme-custom-note">Avec tes couleurs personnalisées.</p>}
              <div className="a-card-actions">
                {!isActive && (
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme })}>
                    Mettre en ligne
                  </button>
                )}
                {!isActive && (
                  <button type="button" className="a-btn a-btn-small" disabled={working !== null} onClick={() => void workOn(theme)} data-testid="theme-work">
                    Travailler au brouillon dessus
                  </button>
                )}
                <PreviewButton id={theme.id} small />
                {theme.preset ? null : (
                  <Link className="a-btn a-btn-small" href={`/admin/themes/${theme.id}`}>
                    Modifier
                  </Link>
                )}
                <ThemeMenu theme={theme} isActive={isActive} busy={busy} onDuplicate={() => duplicate(theme)} onDelete={() => setPending({ kind: "delete", theme })} />
              </div>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={pending?.kind === "activate"}
        title={`Mettre en ligne « ${pending?.theme.name ?? ""} » ?`}
        confirmLabel="Mettre en ligne"
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
          setKeepColors(true);
        }}
        onConfirm={() => pending && publish(pending.theme, hasCustom && !keepColors)}
        extra={pending && <PreviewButton id={pending.theme.id} label="Prévisualiser d'abord" />}
      >
        <p className="a-swap">
          <span>{active?.name ?? "Aucun thème"}</span>
          <span aria-hidden="true">→</span>
          <strong>{pending?.theme.name}</strong>
        </p>
        <p className="muted">Tous tes visiteurs verront ce thème dès maintenant, sur toutes les pages.</p>
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
        open={pending?.kind === "delete"}
        title={`Supprimer le thème « ${pending?.theme.name ?? ""} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending && run(() => deleteThemeAction(pending.theme.id), `« ${pending.theme.name} » supprimé`)}
      >
        <p className="muted">Ses couleurs et réglages seront perdus. Tes pages et tes œuvres ne changent pas.</p>
        {pending?.theme.id === preparingId && <p className="muted">Tu es en train de le prévisualiser : l&apos;aperçu s&apos;arrête aussi et le site te montre de nouveau le thème en ligne.</p>}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
