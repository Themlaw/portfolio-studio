"use client";

/**
 * Lot 132 — envoi d'une animation image par image depuis la médiathèque : plusieurs images (PNG / WebP / JPEG, lues dans l'ordre de leurs
 * noms), OU un zip d'images, OU une feuille de sprites (une image + colonnes × rangées). Le serveur assemble UNE bande WebP
 * (/admin/api/animation) ; l'animation est ensuite un média comme les autres (cadence réglée à chaque emplacement).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; frames: number; reused: boolean } | { kind: "error"; message: string };

export default function AnimationUploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [cols, setCols] = useState("");
  const [rows, setRows] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const isZip = files.length === 1 && /\.zip$/i.test(files[0].name);
  const sheet = files.length === 1 && !isZip;

  async function send() {
    if (!files.length) return;
    setState({ kind: "busy" });
    const form = new FormData();
    if (sheet) {
      form.set("cols", cols);
      form.set("rows", rows);
    }
    for (const f of files) form.append("file", f, f.name);
    try {
      const res = await fetch("/admin/api/animation", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; media?: { frames: number; reused: boolean } } | null;
      if (!res.ok || !body?.ok) {
        setState({ kind: "error", message: body?.message ?? "L'envoi a échoué. Réessaie." });
        return;
      }
      setState({ kind: "ok", frames: body.media?.frames ?? 0, reused: Boolean(body.media?.reused) });
      setFiles([]);
      if (input.current) input.current.value = "";
      setTimeout(() => router.refresh(), 0);
    } catch {
      setState({ kind: "error", message: "L'envoi a échoué (connexion ?). Réessaie." });
    }
  }

  return (
    <details className="a-anim-up" data-testid="anim-uploader">
      <summary>Créer une animation image par image</summary>
      <p className="muted">
        Envoie tes dessins numérotés (PNG, WebP ou JPEG, de 2 à 48 images, dans l&apos;ordre de leurs noms), un zip de ces images, ou une feuille de sprites avec son nombre de colonnes et de rangées.
        Le site assemble une seule bande ; la cadence (6, 8, 12 ou 24 images par seconde) se règle à chaque endroit où tu la poses.
      </p>
      <div className="a-field">
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/webp,image/jpeg,.zip,application/zip"
          aria-label="Images de l'animation"
          data-testid="anim-files"
          onChange={(e) => {
            setFiles([...(e.target.files ?? [])]);
            setState({ kind: "idle" });
          }}
        />
      </div>
      {sheet && (
        <div className="a-field" role="group" aria-label="Feuille de sprites">
          <label>
            Colonnes <input type="number" min={1} max={48} value={cols} onChange={(e) => setCols(e.target.value)} data-testid="anim-cols" />
          </label>{" "}
          <label>
            Rangées <input type="number" min={1} max={48} value={rows} onChange={(e) => setRows(e.target.value)} data-testid="anim-rows" />
          </label>
        </div>
      )}
      <button type="button" className="a-btn a-btn-small a-btn-primary" disabled={!files.length || state.kind === "busy" || (sheet && !(Number(cols) > 0 && Number(rows) > 0))} onClick={send} data-testid="anim-send">
        {state.kind === "busy" ? "Assemblage…" : "Créer l'animation"}
      </button>
      <p role="status" className="muted" data-testid="anim-status">
        {state.kind === "ok" && `${state.reused ? "Cette animation existait déjà" : "Animation créée"} (${state.frames} images) : elle apparaît dans les médias.`}
        {state.kind === "error" && state.message}
      </p>
    </details>
  );
}
