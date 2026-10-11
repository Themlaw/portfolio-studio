"use client";

/**
 * « Importer un thème… » : envoie une archive exportée depuis Admin → Thèmes
 * (POST /admin/api/themes/import). Le thème importé arrive comme une copie à
 * toi, jamais mise en ligne d'office : prévisualise-le d'abord.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { toast } from "./editing";

export default function ThemeImportButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const send = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/admin/api/themes/import", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; theme?: { id: string; name: string } } | null;
      if (!res.ok || !body?.ok || !body.theme) {
        toast(body?.message ?? `L'import a échoué (erreur ${res.status}).`, "error");
        return;
      }
      toast(`« ${body.theme.name} » importé : prévisualise-le avant de le mettre en ligne`);
      router.refresh();
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
          if (file) void send(file);
        }}
      />
      <button type="button" className="a-btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Import en cours…" : "Importer un thème…"}
      </button>
    </>
  );
}
