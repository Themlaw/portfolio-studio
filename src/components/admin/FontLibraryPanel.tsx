"use client";

/**
 * Réglages → Polices téléchargées : les polices Google que le site a
 * téléchargées (styles de texte, lot 2), où chacune est utilisée, leur poids,
 * et « Supprimer » pour celles qu'aucun style n'utilise. Seules les polices
 * utilisées comptent pour la place réservée : les autres sont aussi retirées
 * d'office à la publication et quand la place manque.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteFontAction } from "@/app/admin/(espace)/reglages/actions";

import { ConfirmDialog, toast } from "./editing";

type Row = { family: string; styles: number; bytes: number; uses: string[] };

const mo = (n: number) => `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

export default function FontLibraryPanel({ rows, total, limits }: { rows: Row[]; total: number; limits: { families: number; totalBytes: number } }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="a-card a-fonts" aria-labelledby="polices-titre" data-testid="font-library">
      <h2 id="polices-titre">
        Polices téléchargées
      </h2>
      <p className="a-help">
        {rows.length} / {limits.families} polices · {mo(total)} sur {mo(limits.totalBytes)}. Une police choisie dans l&apos;éditeur est téléchargée par le site ; celles qui ne servent plus sont retirées à la publication, ou ici.
      </p>
      {rows.length === 0 ? (
        <p className="a-help">Aucune police téléchargée : les textes utilisent les polices du thème.</p>
      ) : (
        <ul className="a-fonts-list">
          {rows.map((r) => (
            <li key={r.family} data-font={r.family}>
              <span className="a-fonts-name">{r.family}</span>
              <span className="a-fonts-meta">
                {r.styles} style{r.styles > 1 ? "s" : ""} · {mo(r.bytes)}
              </span>
              <span className="a-fonts-uses">{r.uses.length ? `Utilisée : ${r.uses.slice(0, 4).join(", ")}${r.uses.length > 4 ? "…" : ""}` : "Inutilisée"}</span>
              {r.uses.length === 0 && (
                <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={() => setPending(r.family)}>
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={`Supprimer la police « ${pending ?? ""} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          const res = await deleteFontAction(pending).catch(() => ({ ok: false as const, message: "Connexion perdue : réessaie." }));
          setBusy(false);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          toast(`« ${pending} » supprimée`);
          setPending(null);
          router.refresh();
        }}
      >
        <p>Ses fichiers sont effacés du site. Tu pourras la choisir à nouveau dans l&apos;éditeur (elle sera retéléchargée).</p>
        {error && <p className="a-danger-text">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
