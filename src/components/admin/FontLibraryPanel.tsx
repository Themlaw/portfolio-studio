"use client";

/**
 * Réglages → Polices téléchargées : les polices Google que le site a
 * téléchargées (styles de texte, lot 2), où chacune est utilisée, leur poids,
 * et « Supprimer » pour celles qu'aucun style n'utilise. Seules les polices
 * utilisées comptent pour la place réservée : les autres sont aussi retirées
 * d'office à la publication et quand la place manque.
 */
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteFontAction } from "@/app/admin/(espace)/reglages/actions";

import { ConfirmDialog, toast } from "./editing";

type Row = { family: string; styles: number; bytes: number; uses: string[] };

export default function FontLibraryPanel({ rows, total, limits }: { rows: Row[]; total: number; limits: { families: number; totalBytes: number } }) {
  const router = useRouter();
  const t = useTranslations("fonts");
  const format = useFormatter();
  const mo = (n: number) => t("megabytes", { value: format.number(n / 1_000_000, { maximumFractionDigits: 1 }) });
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="a-card a-fonts" aria-labelledby="polices-titre" data-testid="font-library">
      <h2 id="polices-titre">
        {t("title")}
      </h2>
      <p className="a-help">
        {t("summary", { count: rows.length, max: limits.families, used: mo(total), limit: mo(limits.totalBytes) })}
      </p>
      {rows.length === 0 ? (
        <p className="a-help">{t("none")}</p>
      ) : (
        <ul className="a-fonts-list">
          {rows.map((r) => (
            <li key={r.family} data-font={r.family}>
              <span className="a-fonts-name">{r.family}</span>
              <span className="a-fonts-meta">
                {t("styles", { count: r.styles })} · {mo(r.bytes)}
              </span>
              <span className="a-fonts-uses">{r.uses.length ? t("usedIn", { list: `${r.uses.slice(0, 4).join(", ")}${r.uses.length > 4 ? "…" : ""}` }) : t("unused")}</span>
              {r.uses.length === 0 && (
                <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={() => setPending(r.family)}>
                  {t("delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={t("deleteTitle", { name: pending ?? "" })}
        confirmLabel={t("delete")}
        danger
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          const res = await deleteFontAction(pending).catch(() => ({ ok: false as const, message: t("connectionLost") }));
          setBusy(false);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          toast(t("deleted", { name: pending }));
          setPending(null);
          router.refresh();
        }}
      >
        <p>{t("deleteBody")}</p>
        {error && <p className="a-danger-text">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
