"use client";

/**
 * Écran de revue d'un kit Photoshop (/admin/themes/<id>/kit), parties client :
 * envoi du PSD rempli, suivi de l'import (file lourde), palette et
 * « Appliquer à mon thème » (nouvelle version de Mon thème, lot 60).
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { applyKitImportAction } from "@/app/admin/(espace)/themes/actions";

import { toast } from "./editing";
import { uploadKit } from "./uploads";

export function KitImportUpload({ themeId }: { themeId: string }) {
  const router = useRouter();
  const t = useTranslations("kit");
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
      setError(t("emptyFile", { name: empty.name }));
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
    toast(t("received"));
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
        {t.rich("uploadIntro", { b: (c) => <strong>{c}</strong> })}
      </p>
      <label className="a-btn">
        {t("chooseFiles")}
        <input ref={input} type="file" multiple accept=".zip,.psd,application/zip,image/vnd.adobe.photoshop" className="sr-only" onChange={(e) => void send(e.target.files)} disabled={progress !== null} data-testid="kit-file" />
      </label>
      {progress !== null && (
        <p className="a-help" role="status">
          {t("uploading", { pct: Math.round(progress * 100) })}
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
  const t = useTranslations("kit");
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
      {status === "running" ? t("importRunning") : t("importQueued")}
    </p>
  );
}

/**
 * Le kit s'applique à Mon thème (lot 60) : plus de liste « Kit appliqué sur le thème » à une seule option, juste une phrase.
 */
export function KitTargetNote({ mineName, version, basedOn }: { mineName: string | null; version: number | null; basedOn: string }) {
  const t = useTranslations("kit");
  return (
    <p className="a-kit-base" data-testid="kit-base">
      <strong>{mineName ? t("targetMine", { name: mineName, version: version ?? "" }) : t("targetNone")}</strong>
      <span className="a-help">
        {mineName
          ? t("targetHelpMine")
          : t("targetHelpNone", { basedOn })}
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
  const t = useTranslations("kit");
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
    toast(t("versionCreatedToast", { version: res.data.version }));
    router.push(`/admin/themes?nouvelle=${res.data.version}&via=kit`);
  };

  return (
    <section className="a-card a-kit-apply" aria-labelledby="kit-apply-title">
      {mirror && (
        <div className="a-kit-mirror">
          <label className="a-kit-mirror-check">
            <input type="checkbox" checked={useMirror} onChange={(e) => setUseMirror(e.target.checked)} data-testid="kit-mirror" />
            {t("useMirror", { from: mirror.from.toLowerCase(), to: mirror.to.toLowerCase() })}
          </label>
          {useMirror && (
            <figure className="a-kit-mirror-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu PNG de l'import (route admin) */}
              <img src={mirror.preview} alt={t("mirrorAlt", { to: mirror.to, from: mirror.from.toLowerCase() })} />
              <figcaption>{t("mirrorCaption", { to: mirror.to })}</figcaption>
            </figure>
          )}
        </div>
      )}
      {colors && colors.count > 0 && (
        <div className="a-kit-mirror">
          <label className="a-kit-mirror-check">
            <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} data-testid="kit-colors" />
            {t("applyColors", { count: colors.count })}
          </label>
          {colors.problem && <p className="a-help">⚠ {colors.problem}</p>}
        </div>
      )}
      <h2 id="kit-apply-title">{t("applyTitle")}</h2>
      <p className="a-help">
        {t("applyIntro", { themeName, version: nextVersion, what: changed > 1 ? "many" : changed === 1 ? "one" : useColors && colors?.count ? "colors" : "other", changed, andColors: useColors && colors?.count && changed > 0 ? "yes" : "no", mineCreated: mineExists ? "yes" : "no" })}
      </p>
      {colors?.problem && useColors && (
        <p className="a-notice" role="status" data-testid="kit-colors-skipped">
          {t("warning", { problem: colors.problem })}
        </p>
      )}
      {tape && <p className="a-help">{t("tapeNote")}</p>}
      {applied && (
        <p className="a-help">
          {t.rich("alreadyApplied", { hasVersion: applied.version ? "yes" : "no", version: applied.version ?? "", link: (c) => <Link href="/admin/themes">{c}</Link> })}
        </p>
      )}
      <button type="button" className="a-btn a-btn-primary" onClick={apply} disabled={busy || (changed === 0 && !(useColors && colors?.count))} aria-busy={busy}>
        {busy ? (done ? t("versionCreated") : t("creating", { version: nextVersion })) : t("applyButton", { version: nextVersion })}
      </button>
      {busy && (
        <p className="a-help a-kit-progress" role="status" data-testid="kit-apply-status">
          <span className="a-spinner" aria-hidden="true" />
          {done ? t("backToThemes") : t("creatingWait", { version: nextVersion })}
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
