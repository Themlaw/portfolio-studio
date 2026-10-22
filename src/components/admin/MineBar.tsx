"use client";

/**
 * Bandeau de Mon thème au-dessus de l'éditeur (lot 60) : version en cours, état « en ligne : v3 · brouillon : v4 », [Publier cette version]
 * (fenêtre « avant → après »), lien vers l'historique. Garde de séance : à la sortie de l'éditeur, la séance d'édition est close (le
 * prochain enregistrement crée une nouvelle version). N'appartient pas au contenu de l'éditeur (lot 61).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { activateThemeAction, closeEditSessionAction } from "@/app/admin/(espace)/themes/actions";
import { SITE_ROLES } from "@/themes/site-palette";
import type { Theme } from "@/themes/schema";

import { ConfirmDialog, toast } from "./editing";

export default function MineBar({ id, name, version, publishedVersion, live, draft, published }: { id: string; name: string; version: number; publishedVersion: number | null; live: boolean; draft: Theme; published: Theme | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const differs = publishedVersion != null && publishedVersion !== version;

  useEffect(() => {
    // Sortie de l'éditeur : la séance d'édition est close.
    return () => {
      void closeEditSessionAction(id);
    };
  }, [id]);

  const publish = () =>
    start(async () => {
      setError(null);
      const result = await activateThemeAction(id);
      if (!result.ok) {
        setError(result.message ?? "L'action a échoué.");
        return;
      }
      setOpen(false);
      toast(`Version ${version} publiée : elle est en ligne pour tes visiteurs`);
      router.refresh();
    });

  const state = live ? (differs ? `En ligne : v${publishedVersion} · brouillon : v${version}` : `En ligne : v${publishedVersion}`) : publishedVersion != null ? `Pas en ligne · dernière publiée : v${publishedVersion} · brouillon : v${version}` : `Pas encore en ligne · brouillon : v${version}`;
  return (
    <div className="a-mine-bar" data-testid="mine-bar">
      <span data-testid="mine-bar-state">
        <strong>{name}</strong> · version {version} · {state}
      </span>
      <span className="a-card-actions">
        {(!live || differs) && (
          <button type="button" className="a-btn a-btn-small a-btn-primary" onClick={() => setOpen(true)} data-testid="mine-bar-publish">
            {live ? "Publier cette version" : "Mettre en ligne cette version"}
          </button>
        )}
        <Link className="a-btn a-btn-small" href={`/admin/themes/${encodeURIComponent(id)}/versions`}>
          Historique des versions
        </Link>
      </span>
      <ConfirmDialog open={open} title={`Publier la version ${version} de « ${name} » ?`} confirmLabel="Publier" busy={busy} onClose={() => setOpen(false)} onConfirm={publish}>
        <p className="a-swap">
          <span>{live ? `En ligne : v${publishedVersion}` : "Thème en ligne actuel"}</span>
          <span aria-hidden="true">→</span>
          <strong>
            {name} : v{version}
          </strong>
        </p>
        <p className="muted">Tous tes visiteurs verront cette version dès maintenant, sur toutes les pages.</p>
        {live && published && (
          <ul className="a-da-changes">
            {SITE_ROLES.filter((r) => String(draft.tokens.color[r.key]).toLowerCase() !== String(published.tokens.color[r.key]).toLowerCase()).map((r) => (
              <li key={r.key}>
                {r.name} : <span className="a-chip" style={{ background: published.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{published.tokens.color[r.key]}</span> →{" "}
                <span className="a-chip" style={{ background: draft.tokens.color[r.key] }} aria-hidden="true" /> <span className="mono">{draft.tokens.color[r.key]}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
