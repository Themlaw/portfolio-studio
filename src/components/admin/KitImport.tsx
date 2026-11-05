"use client";

/**
 * Écran de revue d'un kit Photoshop (/admin/themes/<id>/kit), parties client :
 * envoi du PSD rempli, suivi de l'import (file lourde), palette et
 * « Appliquer à mon thème » (nouvelle version de Mon thème, lot 60).
 */
import Link from "next/link";
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
    // L'ancienne revue ne concerne plus ce fichier : elle disparaît dès le début du nouvel envoi (et ne revient pas sous une erreur).
    router.replace(`/admin/themes/${encodeURIComponent(themeId)}/kit?neuf=1`);
    const empty = files.find((f) => f.size === 0);
    if (empty) {
      if (input.current) input.current.value = "";
      setError(`« ${empty.name} » est vide : choisis le bon fichier.`);
      return;
    }
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
        <strong>Envoie le kit rempli</strong> : l&apos;archive .zip, ou un ou plusieurs fichiers .psd choisis ensemble (enregistrés depuis Photoshop, tels quels). Tu peux n&apos;envoyer qu&apos;une partie (le fichier téléchargé « partie seulement ») ou que les fichiers que tu as modifiés : le reste du kit ne change pas.
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

/**
 * Le kit s'applique à Mon thème (lot 60) : plus de liste « Kit appliqué sur le thème » à une seule option, juste une phrase.
 */
export function KitTargetNote({ mineName, version, basedOn }: { mineName: string | null; version: number | null; basedOn: string }) {
  return (
    <p className="a-kit-base" data-testid="kit-base">
      <strong>Le kit s&apos;applique à : {mineName ? `${mineName} (version ${version})` : "Mon thème"}</strong>
      <span className="a-help">
        {mineName
          ? "Seuls les éléments que tu as redessinés changent ; le reste de Mon thème est gardé tel quel. Rien n'est mis en ligne tant que tu ne publies pas."
          : `Tu n'as pas encore de Mon thème : il est créé à partir de « ${basedOn} » (version 1), puis ton kit en fait la version 2.`}
      </span>
    </p>
  );
}

/** Palette suggérée (à appliquer ou ignorer) et « Appliquer au thème ». */
export function KitApplyPanel({
  themeId,
  importId,
  themeName,
  nextVersion,
  mineExists,
  tape = false,
  changed,
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
  /** Numéro de la version que l'application va créer. */
  nextVersion: number;
  /** Mon thème existe déjà (sinon il est créé d'abord). */
  mineExists: boolean;
  /** Le scotch est redessiné : la nouvelle version active la variante « scotch » des planches. */
  tape?: boolean;
  changed: number;
  applied: { id: string; version: number | null } | null;
}) {
  const router = useRouter();
  const [useMirror, setUseMirror] = useState(true);
  const [useColors, setUseColors] = useState(Boolean(colors?.count));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const apply = async () => {
    setBusy(true);
    setError("");
    const res = await applyKitImportAction(themeId, importId, { mirror: Boolean(mirror) && useMirror, colors: Boolean(colors?.count) && useColors });
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }
    // Le bouton reste bloqué jusqu'au retour à l'écran Thèmes : pas de second clic, pas de seconde version.
    setDone(true);
    toast(`Version ${res.data.version} de Mon thème créée : prévisualise-la, puis publie`);
    router.push(`/admin/themes?nouvelle=${res.data.version}&via=kit`);
  };

  return (
    <section className="a-card a-kit-apply" aria-labelledby="kit-apply-title">
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
            <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} data-testid="kit-colors" />
            Appliquer {colors.count > 1 ? `les ${colors.count} couleurs repeintes` : "la couleur repeinte"}
          </label>
          {colors.problem && <p className="a-help">⚠ {colors.problem}</p>}
        </div>
      )}
      <h2 id="kit-apply-title">Appliquer à mon thème</h2>
      <p className="a-help">
        Ajoute à « {themeName} » une nouvelle version (la version {nextVersion}) avec {changed > 1 ? `les ${changed} éléments redessinés` : changed === 1 ? "l'élément redessiné" : useColors && colors?.count ? "tes couleurs" : "les éléments redessinés"}
        {useColors && colors?.count && changed > 0 ? " et tes couleurs" : ""}. Le thème en ligne ne change pas tant que tu ne publies pas, et tu peux toujours revenir à la version d&apos;avant.{mineExists ? "" : " Mon thème est d'abord créé (version 1) à partir du thème dont le kit est issu."}
      </p>
      {colors?.problem && useColors && (
        <p className="a-notice" role="status" data-testid="kit-colors-skipped">
          Attention : {colors.problem}
        </p>
      )}
      {tape && <p className="a-help">Le scotch est redessiné : la nouvelle version active la variante « scotch » des planches (à retirer dans l&apos;éditeur si tu n&apos;en veux pas).</p>}
      {applied && (
        <p className="a-help">
          Déjà appliqué{applied.version ? ` (version ${applied.version})` : ""} : <Link href="/admin/themes">voir Mon thème</Link>.
        </p>
      )}
      <button type="button" className="a-btn a-btn-primary" onClick={apply} disabled={busy || (changed === 0 && !(useColors && colors?.count))} aria-busy={busy}>
        {busy ? (done ? "Version créée…" : `Création de la version ${nextVersion}…`) : `Appliquer à mon thème (crée la version ${nextVersion})`}
      </button>
      {busy && (
        <p className="a-help a-kit-progress" role="status" data-testid="kit-apply-status">
          <span className="a-spinner" aria-hidden="true" />
          {done ? "Version créée : retour à l'écran Thèmes…" : `Création de la version ${nextVersion} : quelques secondes, ne quitte pas la page.`}
        </p>
      )}
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
