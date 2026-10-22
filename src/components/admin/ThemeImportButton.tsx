"use client";

/**
 * « Importer un thème… » : envoie une archive exportée depuis Admin → Thèmes
 * (POST /admin/api/themes/import). Lot 60 : un choix explicite avant l'envoi, « comme nouvelle version de mon thème »
 * (par défaut) ou « comme thème à part » ; jamais mise en ligne d'office : prévisualise d'abord.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ConfirmDialog, toast } from "./editing";

type Mode = "version" | "apart";

export default function ThemeImportButton({ hasMine = true }: { hasMine?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [mode, setMode] = useState<Mode>("version");

  const send = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/admin/api/themes/import?mode=${mode}`, { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; theme?: { id: string; name: string; mode?: Mode; version?: number } } | null;
      if (!res.ok || !body?.ok || !body.theme) {
        toast(body?.message ?? `L'import a échoué (erreur ${res.status}).`, "error");
        return;
      }
      if (body.theme.mode === "version" && body.theme.version) {
        toast(`Importé : version ${body.theme.version} de Mon thème. Prévisualise-la avant de la publier`);
        router.push(`/admin/themes?nouvelle=${body.theme.version}&via=import`);
      } else {
        toast(`« ${body.theme.name} » importé comme thème à part (dans « Mes anciens thèmes »)`);
        router.refresh();
      }
    } catch {
      toast("L'import a échoué : vérifie ta connexion et réessaie.", "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="theme-import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setAsking(false);
          if (file) void send(file);
        }}
      />
      <button type="button" className="a-btn" onClick={() => setAsking(true)} disabled={busy} data-testid="theme-import-open">
        {busy ? "Import en cours…" : "Importer un thème…"}
      </button>
      <ConfirmDialog open={asking} title="Importer un thème" confirmLabel="Choisir le fichier .zip…" onClose={() => setAsking(false)} onConfirm={() => input.current?.click()}>
        <fieldset className="a-fieldset" data-testid="import-mode">
          <legend>Où l&apos;ajouter ?</legend>
          <label className="a-check">
            <input type="radio" name="import-mode" checked={mode === "version"} onChange={() => setMode("version")} data-testid="import-mode-version" />{" "}
            {hasMine ? "Comme nouvelle version de mon thème (conseillé)" : "Comme mon thème (version 1)"}
          </label>
          <label className="a-check">
            <input type="radio" name="import-mode" checked={mode === "apart"} onChange={() => setMode("apart")} data-testid="import-mode-apart" /> Comme thème à part (dans « Mes anciens thèmes »)
          </label>
        </fieldset>
        <p className="muted">Rien n&apos;est mis en ligne : tu prévisualises d&apos;abord, puis tu publies.</p>
      </ConfirmDialog>
    </>
  );
}
