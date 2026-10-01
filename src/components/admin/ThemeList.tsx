"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  activateThemeAction,
  deleteThemeAction,
  duplicateThemeAction,
} from "@/app/admin/(espace)/themes/actions";
import { accentProblem } from "@/themes/contrast";
import type { Theme } from "@/themes/schema";

import { ConfirmDialog, toast } from "./editing";
import ThemeSwatches from "./ThemeSwatches";

/** Formulaire natif : l'aperçu s'ouvre dans un nouvel onglet (l'admin reste ici). */
function PreviewButton({ id, label = "Prévisualiser", small }: { id: string; label?: string; small?: boolean }) {
  return (
    <form method="post" action="/admin/apercu" target="_blank">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={`a-btn${small ? " a-btn-small" : ""}`}>
        {label} <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

type Pending = { kind: "activate" | "delete"; theme: Theme } | null;

export default function ThemeList({
  themes,
  activeId,
  accents,
}: {
  themes: Theme[];
  activeId: string;
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
      <div className="a-grid a-theme-grid">
        {themes.map((theme) => {
          const isActive = theme.id === activeId;
          return (
            <section key={theme.id} className="a-card a-theme-card" aria-labelledby={`theme-${theme.id}`} data-active={isActive}>
              <div className="a-card-head">
                <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
                {isActive ? <span className="a-badge">En ligne</span> : theme.preset && <span className="a-tag">Livré</span>}
              </div>
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
                <button type="button" className="a-btn a-btn-small" onClick={() => duplicate(theme)} disabled={busy}>
                  Dupliquer
                </button>
                {!theme.preset && !isActive && (
                  <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" onClick={() => setPending({ kind: "delete", theme })}>
                    Supprimer
                  </button>
                )}
              </div>
              {theme.preset && <p className="a-help">Thème livré : duplique-le pour le modifier.</p>}
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
                <p>Avec ce thème, l&apos;accent propre de ces pages ne serait plus lisible : il sera ignoré.</p>
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
