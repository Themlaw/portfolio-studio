"use client";

/**
 * Écran de revue d'un kit Photoshop (/admin/themes/<id>/kit), parties client :
 * envoi du PSD rempli, suivi de l'import (file lourde), palette et
 * « Appliquer au thème » (copie brouillon, puis éditeur avec aperçu en direct).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { applyKitImportAction } from "@/app/admin/(espace)/themes/actions";

import { toast } from "./editing";
import { uploadKit } from "./uploads";

export function KitImportUpload({ themeId }: { themeId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);

  const send = async (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setError("");
    setProgress(0);
    const res = await uploadKit(files, themeId, (sent, total) => setProgress(total ? sent / total : 0));
    setProgress(null);
    if (input.current) input.current.value = "";
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast("Kit reçu : import en cours");
    router.push(`/admin/themes/${encodeURIComponent(themeId)}/kit?import=${res.importId}`);
    router.refresh();
  };

  return (
    <div
      className="a-kit-drop"
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files);
      }}
    >
      <p>
        <strong>Envoie le kit rempli</strong> : l&apos;archive .zip, ou un ou plusieurs fichiers .psd choisis ensemble (enregistrés depuis Photoshop, tels quels). Tu peux n&apos;envoyer que les fichiers que tu as modifiés : le reste ne change pas.
      </p>
      <label className="a-btn">
        Choisir le .zip ou les .psd
        <input ref={input} type="file" multiple accept=".zip,.psd,application/zip,image/vnd.adobe.photoshop" className="sr-only" onChange={(e) => void send(e.target.files)} disabled={progress !== null} data-testid="kit-file" />
      </label>
      {progress !== null && (
        <p className="a-help" role="status">
          Envoi… {Math.round(progress * 100)} %
        </p>
      )}
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Import en file ou en cours : relevé toutes les 2 s, page rafraîchie à la fin. */
export function KitImportWatch({ themeId, importId }: { themeId: string; importId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("queued");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/admin/api/theme-kit/${encodeURIComponent(themeId)}/import/${importId}`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { status?: string } | null;
      if (stop) return;
      if (body?.status === "done" || body?.status === "failed") {
        router.refresh();
        return;
      }
      if (body?.status) setStatus(body.status);
      setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [themeId, importId, router]);
  return (
    <p className="a-help" role="status" aria-live="polite">
      {status === "running" ? "Import en cours : lecture des calques, conversion des éléments redessinés…" : "Import en file d'attente (une conversion vidéo est peut-être en cours)…"}
    </p>
  );
}

type Swatch = { role: string; label: string; hex: string };

/**
 * Thème sur lequel le kit sera posé : dit clairement lequel (celui dont le kit a été
 * exporté par défaut), et laisse en choisir un autre. Le choix passe dans l'adresse
 * (?base=) : la revue (contrastes, poids, avant / après) est recalculée sur ce thème.
 */
export function KitBasePicker({ themeId, importId, baseId, originId, themes }: { themeId: string; importId: string; baseId: string; originId?: string; themes: { id: string; name: string; live: boolean }[] }) {
  const router = useRouter();
  const base = themes.find((t) => t.id === baseId);
  return (
    <div className="a-kit-base" data-testid="kit-base">
      <label htmlFor="kit-base-select">
        <strong>Kit appliqué sur le thème</strong>
      </label>
      <select
        id="kit-base-select"
        className="a-select"
        value={baseId}
        data-testid="kit-base-select"
        onChange={(e) => router.replace(`/admin/themes/${encodeURIComponent(themeId)}/kit?import=${importId}&base=${encodeURIComponent(e.target.value)}`)}
      >
        {themes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.id === originId ? " — thème d'origine du kit" : ""}
            {t.live ? " — en ligne" : ""}
          </option>
        ))}
      </select>
      <p className="a-help">
        La copie brouillon reprend « {base?.name ?? baseId} » (couleurs, variantes, éléments non redessinés) et y pose ce qui a changé dans le kit.
        {originId && originId !== baseId ? " Ce n'est pas le thème dont le kit a été exporté." : ""}
        {base?.live ? " C'est le thème actuellement en ligne ; la copie, elle, ne l'est pas." : " Ce thème n'est pas celui qui est en ligne."}
      </p>
    </div>
  );
}

/** Palette suggérée (à appliquer ou ignorer) et « Appliquer au thème ». */
export function KitApplyPanel({
  themeId,
  importId,
  themeName,
  baseId,
  tape = false,
  changed,
  palette,
  paletteProblem,
  applied,
  mirror,
  colors = null,
}: {
  /** Couleurs repeintes dans « 8 · Palette » : nombre, et problème de contraste éventuel. */
  colors?: { count: number; problem: string | null } | null;
  themeId: string;
  importId: string;
  /** Une seule flèche redessinée : proposer son miroir pour l'autre. */
  mirror: { from: string; to: string; preview: string } | null;
  themeName: string;
  /** Thème sur lequel la copie est faite (défaut : le thème dont le kit a été exporté). */
  baseId: string;
  /** Le scotch est redessiné : la copie active la variante « scotch » des planches. */
  tape?: boolean;
  changed: number;
  palette: Swatch[] | null;
  paletteProblem: string | null;
  applied: string | null;
}) {
  const router = useRouter();
  const [usePalette, setUsePalette] = useState(false);
  const [useMirror, setUseMirror] = useState(true);
  const [useColors, setUseColors] = useState(Boolean(colors?.count && !colors.problem));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = async () => {
    setBusy(true);
    setError("");
    const res = await applyKitImportAction(themeId, importId, { palette: usePalette, mirror: Boolean(mirror) && useMirror, colors: Boolean(colors?.count) && useColors, base: baseId });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast("Copie brouillon créée : aperçu en direct");
    router.push(`/admin/themes/${encodeURIComponent(res.data.id)}`);
  };

  return (
    <section className="a-card a-kit-apply" aria-labelledby="kit-apply-title">
      {palette && (
        <div className="a-kit-palette">
          <h2 id="kit-palette-title">Palette suggérée</h2>
          <p className="a-help">Tirée de ton paysage. Elle remplace les couleurs du thème dans la copie, si tu l&apos;appliques.</p>
          <ul className="a-kit-swatches">
            {palette.map((s) => (
              <li key={s.role}>
                <span className="a-kit-swatch" style={{ background: s.hex }} aria-hidden />
                {s.label} <code>{s.hex}</code>
              </li>
            ))}
          </ul>
          {paletteProblem ? (
            <p className="a-help">⚠ {paletteProblem}</p>
          ) : (
            <div className="a-kit-choice" role="group" aria-label="Palette suggérée">
              <button type="button" className={`a-btn a-btn-small${usePalette ? "" : " a-btn-quiet"}`} aria-pressed={usePalette} onClick={() => setUsePalette(true)}>
                Appliquer cette palette
              </button>
              <button type="button" className={`a-btn a-btn-small${usePalette ? " a-btn-quiet" : ""}`} aria-pressed={!usePalette} onClick={() => setUsePalette(false)}>
                Ignorer
              </button>
            </div>
          )}
        </div>
      )}
      {mirror && (
        <div className="a-kit-mirror">
          <label className="a-kit-mirror-check">
            <input type="checkbox" checked={useMirror} onChange={(e) => setUseMirror(e.target.checked)} data-testid="kit-mirror" />
            Utiliser le miroir de ta {mirror.from.toLowerCase()} pour la {mirror.to.toLowerCase()}
          </label>
          {useMirror && (
            <figure className="a-kit-mirror-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu PNG de l'import (route admin) */}
              <img src={mirror.preview} alt={`${mirror.to}, miroir de ta ${mirror.from.toLowerCase()}`} />
              <figcaption>{mirror.to} (miroir, sans nouveau tracé)</figcaption>
            </figure>
          )}
        </div>
      )}
      {colors && colors.count > 0 && (
        <div className="a-kit-mirror">
          <label className="a-kit-mirror-check">
            <input type="checkbox" checked={useColors} disabled={Boolean(colors.problem)} onChange={(e) => setUseColors(e.target.checked)} data-testid="kit-colors" />
            Appliquer {colors.count > 1 ? `les ${colors.count} couleurs repeintes` : "la couleur repeinte"}
          </label>
          {colors.problem && <p className="a-help">⚠ {colors.problem}</p>}
        </div>
      )}
      <h2 id="kit-apply-title">Appliquer au thème</h2>
      <p className="a-help">
        Crée une copie brouillon de « {themeName} » avec {changed > 1 ? `les ${changed} éléments redessinés` : changed === 1 ? "l'élément redessiné" : useColors && colors?.count ? "tes couleurs" : "la palette"}
        {usePalette && changed > 0 ? " et la palette" : ""}
        {useColors && colors?.count && changed > 0 ? " et tes couleurs" : ""}, puis ouvre son aperçu en direct. Le thème en ligne ne change pas tant que tu n&apos;actives pas la copie.
      </p>
      {colors?.problem && (
        <p className="a-field-error" role="alert" data-testid="kit-colors-skipped">
          Tes couleurs repeintes ne seront pas appliquées : {colors.problem}
        </p>
      )}
      {tape && <p className="a-help">Le scotch est redessiné : la copie active la variante « scotch » des planches (à retirer dans l&apos;éditeur si tu n&apos;en veux pas).</p>}
      {applied && (
        <p className="a-help">
          Déjà appliqué : <a href={`/admin/themes/${encodeURIComponent(applied)}`}>ouvrir la copie</a>.
        </p>
      )}
      <button type="button" className="a-btn a-btn-primary" onClick={apply} disabled={busy || (changed === 0 && !usePalette && !(useColors && colors?.count))} aria-busy={busy}>
        {busy ? "Création de la copie…" : "Appliquer au thème"}
      </button>
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
