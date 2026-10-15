"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator, Text } from "react-aria-components";

import {
  activateThemeAction,
  deleteThemeAction,
  duplicateThemeAction,
} from "@/app/admin/(espace)/themes/actions";
import { accentProblem } from "@/themes/contrast";
import type { Theme } from "@/themes/schema";

import { useKitDownload } from "./KitDownloadButton";
import { ConfirmDialog, toast } from "./editing";
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
            <MenuItem className="a-menu-item" href={`/admin/themes/${id}#couleurs-da`} data-testid="theme-da-link" textValue="Couleurs de la DA">
              <Text slot="label">Couleurs de la DA</Text>
              <Text slot="description">Les six couleurs du thème, avec aperçu.</Text>
            </MenuItem>
            <MenuItem className="a-menu-item" onAction={onDuplicate} isDisabled={busy} textValue="Dupliquer">
              <Text slot="label">Dupliquer</Text>
              <Text slot="description">Une copie que tu peux modifier.</Text>
            </MenuItem>
            <Separator className="a-menu-sep" />
            <MenuItem className="a-menu-item" href={`/admin/api/themes/${id}/export`} download={`theme-${theme.id}.zip`} textValue="Exporter le thème (.zip)">
              <Text slot="label">Exporter le thème (.zip)</Text>
              <Text slot="description">Une archive à réimporter sur ce site ou un autre.</Text>
            </MenuItem>
            <MenuItem className="a-menu-item" onAction={() => void kit.start()} isDisabled={kit.busy} textValue="Télécharger le kit Photoshop">
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
}: {
  themes: Theme[];
  activeId: string;
  /** Vignettes générées des thèmes livrés (id → chemin public). */
  thumbs?: Record<string, string | null>;
  accents: { id: number; title: string; accent: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const active = themes.find((t) => t.id === activeId);

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
      toast(`« ${theme.name} » dupliqué`);
      router.push(`/admin/themes/${result.data.id}`);
    });

  return (
    <>
      {active && (
        <p className="a-theme-live" data-testid="theme-live-banner">
          Thème en ligne : <strong>{active.name}</strong>
        </p>
      )}
      <div className="a-grid a-theme-grid">
        {themes.map((theme) => {
          const isActive = theme.id === activeId;
          return (
            <section key={theme.id} className="a-card a-theme-card" aria-labelledby={`theme-${theme.id}`} data-active={isActive}>
              <div className="a-card-head">
                <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
                {isActive ? (
                  <span className="a-badge a-badge-live" data-testid="theme-live">
                    <span aria-hidden="true">●</span> En ligne
                  </span>
                ) : (
                  <span className="a-tag">{theme.preset ? "Livré · hors ligne" : "Hors ligne"}</span>
                )}
              </div>
              <ThemeThumb theme={theme} src={theme.preset ? thumbs[theme.id] : null} />
              <ThemeSwatches theme={theme} />
              <div className="a-card-actions">
                {!isActive && (
                  <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setPending({ kind: "activate", theme })}>
                    Mettre en ligne
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
        }}
        onConfirm={() => pending && run(() => activateThemeAction(pending.theme.id), `« ${pending.theme.name} » mis en ligne`)}
        extra={pending && <PreviewButton id={pending.theme.id} label="Prévisualiser d'abord" />}
      >
        <p className="a-swap">
          <span>{active?.name ?? "Aucun thème"}</span>
          <span aria-hidden="true">→</span>
          <strong>{pending?.theme.name}</strong>
        </p>
        <p className="muted">Tous tes visiteurs verront ce thème dès maintenant, sur toutes les pages.</p>
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
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
