"use client";

/**
 * Lot 132 — envoi d'une animation image par image depuis la médiathèque : plusieurs images (PNG / WebP / JPEG, lues dans l'ordre de leurs
 * noms), OU un zip d'images, OU une feuille de sprites (une image + colonnes × rangées). Le serveur assemble UNE bande WebP
 * (/admin/api/animation) ; l'animation est ensuite un média comme les autres (cadence réglée à chaque emplacement).
 */
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; frames: number; reused: boolean } | { kind: "error"; message: string };

export default function AnimationUploader() {
  const t = useTranslations("animation");
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
        setState({ kind: "error", message: body?.message ?? t("sendFailed") });
        return;
      }
      setState({ kind: "ok", frames: body.media?.frames ?? 0, reused: Boolean(body.media?.reused) });
      setFiles([]);
      if (input.current) input.current.value = "";
      setTimeout(() => router.refresh(), 0);
    } catch {
      setState({ kind: "error", message: t("connectionFailed") });
    }
  }

  return (
    <details className="a-anim-up" data-testid="anim-uploader">
      <summary>{t("summary")}</summary>
      <p className="muted">{t("description")}</p>
      <div className="a-field">
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/webp,image/jpeg,.zip,application/zip"
          aria-label={t("imagesLabel")}
          data-testid="anim-files"
          onChange={(e) => {
            setFiles([...(e.target.files ?? [])]);
            setState({ kind: "idle" });
          }}
        />
      </div>
      {sheet && (
        <div className="a-field" role="group" aria-label={t("sheetLabel")}>
          <label>
            {t("cols")} <input type="number" min={1} max={48} value={cols} onChange={(e) => setCols(e.target.value)} data-testid="anim-cols" />
          </label>{" "}
          <label>
            {t("rows")} <input type="number" min={1} max={48} value={rows} onChange={(e) => setRows(e.target.value)} data-testid="anim-rows" />
          </label>
        </div>
      )}
      <button type="button" className="a-btn a-btn-small a-btn-primary" disabled={!files.length || state.kind === "busy" || (sheet && !(Number(cols) > 0 && Number(rows) > 0))} onClick={send} data-testid="anim-send">
        {state.kind === "busy" ? t("assembling") : t("create")}
      </button>
      <p role="status" className="muted" data-testid="anim-status">
        {state.kind === "ok" && `${state.reused ? t("reused") : t("created")} (${state.frames} ${t("images")}) : ${t("appearsInMedia")}.`}
        {state.kind === "error" && state.message}
      </p>
    </details>
  );
}
