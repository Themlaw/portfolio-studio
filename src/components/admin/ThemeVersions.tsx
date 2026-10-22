"use client";

/** Historique des versions de Mon thème (lot 60) : vignette réelle, date, résumé, [Prévisualiser] [Revenir à cette version] [Garder une copie à part]. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { keepVersionCopyAction, pinVersionAction, revertVersionAction } from "@/app/admin/(espace)/themes/actions";
import type { VersionInfo } from "@/lib/themes/versions";

import { PreviewButton } from "./ThemeList";
import LiveThumb from "./LiveThumb";
import { ConfirmDialog, toast } from "./editing";
import { formatWhen } from "./theme-format";

type Mine = { id: string; name: string; version: number; publishedVersion: number | null; live: boolean };

export default function ThemeVersions({ mine, versions }: { mine: Mine; versions: VersionInfo[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [asking, setAsking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const differs = mine.publishedVersion != null && mine.publishedVersion !== mine.version;
  const state = mine.live
    ? differs
      ? `En ligne : v${mine.publishedVersion} · brouillon : v${mine.version}`
      : `En ligne : v${mine.publishedVersion}`
    : mine.publishedVersion != null
      ? `Pas en ligne · dernière publiée : v${mine.publishedVersion} · brouillon : v${mine.version}`
      : `Pas encore en ligne · brouillon : v${mine.version}`;

  const revert = (n: number, publish: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await revertVersionAction(mine.id, n, publish);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAsking(null);
      toast(publish ? `Retour à la version ${n} : version ${result.data.version} créée et en ligne` : `Retour à la version ${n} : version ${result.data.version} créée (brouillon)`);
      router.refresh();
    });
  const keep = (n: number) =>
    startTransition(async () => {
      const result = await keepVersionCopyAction(mine.id, n);
      if (!result.ok) return toast(result.message, "error");
      toast(`Copie gardée : « ${result.data.name} » (dans « Mes anciens thèmes »)`);
      router.refresh();
    });
  const pin = (n: number, pinned: boolean) =>
    startTransition(async () => {
      const result = await pinVersionAction(mine.id, n, pinned);
      if (!result.ok) return toast(result.message, "error");
      toast(pinned ? `Version ${n} marquée : elle ne sera jamais supprimée` : `Version ${n} démarquée`);
      router.refresh();
    });

  return (
    <>
      <p className="a-mine-state" data-testid="versions-state">
        {state}
      </p>
      <ol className="a-versions" data-testid="versions-list">
        {versions.map((v) => (
          <li key={v.n} className="a-card a-version" data-version={v.n} data-current={v.current || undefined} data-published={v.published || undefined}>
            <LiveThumb themeRef={`${mine.id}@${v.n}`} stamp={v.createdAt} />
            <div className="a-version-body">
              <div className="a-card-head">
                <h3>Version {v.n}</h3>
                <span className="a-version-badges">
                  {v.published && (mine.live ? <span className="a-badge a-badge-live">● En ligne</span> : <span className="a-badge">Dernière publiée</span>)}
                  {v.current && <span className="a-badge" data-testid="version-current">Version en cours</span>}
                  {v.pinned && <span className="a-tag" title="Jamais supprimée par le nettoyage">★ Gardée</span>}
                </span>
              </div>
              <p className="a-mine-meta">{formatWhen(v.createdAt)}</p>
              <p className="a-version-summary" data-testid="version-summary">
                {v.summary}
              </p>
              <div className="a-card-actions">
                <PreviewButton id={`${mine.id}@${v.n}`} small testId="version-preview" />
                {!v.current && (
                  <button
                    type="button"
                    className="a-btn a-btn-small"
                    disabled={busy}
                    onClick={() => (mine.live ? (setError(null), setAsking(v.n)) : revert(v.n, false))}
                    data-testid="version-revert"
                  >
                    Revenir à cette version
                  </button>
                )}
                <button type="button" className="a-btn a-btn-small" disabled={busy} onClick={() => keep(v.n)} data-testid="version-copy">
                  Garder une copie à part
                </button>
                <button type="button" className="a-btn a-btn-small a-btn-quiet" disabled={busy} onClick={() => pin(v.n, !v.pinned)} data-testid="version-pin" aria-pressed={v.pinned}>
                  {v.pinned ? "Ne plus garder" : "★ Garder toujours"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={asking !== null}
        title={`Revenir à la version ${asking ?? ""} ?`}
        confirmLabel="Revenir (sans publier)"
        busy={busy}
        onClose={() => {
          setAsking(null);
          setError(null);
        }}
        onConfirm={() => asking !== null && revert(asking, false)}
        extra={
          asking !== null && (
            <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={() => revert(asking, true)} data-testid="revert-publish">
              Revenir et publier
            </button>
          )
        }
      >
        <p>
          Mon thème est en ligne (version {mine.publishedVersion}). Revenir à la version {asking} crée une nouvelle version, identique : rien n&apos;est perdu.
        </p>
        <p className="muted">« Revenir et publier » remet aussitôt cet aspect pour tous tes visiteurs ; « sans publier » le garde en brouillon.</p>
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
      {error && asking === null && <p className="a-alert">{error}</p>}
    </>
  );
}
