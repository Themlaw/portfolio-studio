"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { backupNowAction, backupStatusAction, saveBackupSettingsAction, unlockBackupDownloadAction } from "@/app/admin/(espace)/sauvegardes/actions";
import type { ArchiveRow, BackupStatus } from "@/lib/backup/service";

import { ConfirmDialog, SaveBar, toast } from "./editing";

const REASONS: Record<string, string> = {
  premier: "Première sauvegarde",
  calme: "Après une session de travail",
  delai: "Délai maximal atteint",
  manuel: "À ta demande",
};
const SOURCES = { reglage: "Réglé ici", env: "Valeur du serveur", defaut: "Valeur d'origine" } as const;

const fmtDate = (ms: number) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
export function fmtSize(b: number) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1).replace(".", ",")} Go`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1).replace(".", ",")} Mo`;
  return `${Math.max(1, Math.round(b / 1024))} Ko`;
}
const fmtIn = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `dans environ ${min} min`;
  const h = Math.round(min / 6) / 10;
  return `dans environ ${String(h).replace(".", ",")} h`;
};

type Form = { enabled: boolean; media: boolean; keep: string; quietMin: string; maxHours: string };
type Field = keyof Form;
const FIELD_ENV: Record<Field, string> = { enabled: "WITH_BACKUP", media: "BACKUP_MEDIA", keep: "BACKUP_KEEP", quietMin: "BACKUP_QUIET_MIN", maxHours: "BACKUP_MAX_HOURS" };

const toForm = (s: BackupStatus): Form => ({ enabled: s.settings.enabled, media: s.settings.media, keep: String(s.settings.keep), quietMin: String(s.settings.quietMin), maxHours: String(s.settings.maxHours) });

export default function BackupPanel({ initial }: { initial: BackupStatus }) {
  const [status, setStatus] = useState(initial);
  const [form, setForm] = useState<Form>(() => toForm(initial));
  // Téléchargement (audit P2) : connexion récente ou mot de passe retapé, vérifié par le serveur.
  const [unlockFor, setUnlockFor] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const download = async (name: string, pw?: string) => {
    setUnlocking(true);
    const r = await unlockBackupDownloadAction(pw === undefined ? {} : { password: pw }).catch(() => null);
    setUnlocking(false);
    if (!r) return toast("Le téléchargement n'a pas pu être préparé. Réessaie.", "error");
    if (r.ok) {
      setUnlockFor(null);
      setPassword("");
      setUnlockError(null);
      // Lien de téléchargement éphémère : pièce jointe, la page reste affichée.
      const link = document.createElement("a");
      link.href = `/api/admin/sauvegardes/${encodeURIComponent(name)}`;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }
    const why = r.fieldErrors?.reauth;
    if (why === "password" || why === "wrong" || why === "throttled") {
      setUnlockFor(name);
      setUnlockError(why === "password" ? null : r.message);
      return;
    }
    toast(r.message, "error");
  };
  // Champs que l'on remet à la valeur d'origine (envoyés à null).
  const [reset, setReset] = useState<Set<Field>>(new Set());
  const [touched, setTouched] = useState<Set<Field>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [launching, setLaunching] = useState(false);
  const wasRunning = useRef(initial.running);

  const refresh = async () => {
    const r = await backupStatusAction();
    if (r.ok) setStatus(r.data);
    return r.ok ? r.data : null;
  };

  // Suivi de la sauvegarde en cours : une lecture toutes les 1,5 s, tant qu'elle dure.
  useEffect(() => {
    if (!status.running && !launching) {
      if (wasRunning.current) {
        wasRunning.current = false;
        if (status.lastError) toast(`La sauvegarde a échoué : ${status.lastError.message}`, "error");
        else toast("Sauvegarde terminée");
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => void refresh().then(() => setLaunching(false)), 1500);
    return () => clearInterval(t);
  }, [status.running, launching, status.lastError]);

  const sourceOf = (f: Field) => (reset.has(f) ? "env" : touched.has(f) ? "reglage" : status.settings.sources[f]);
  const dirty = touched.size > 0 || reset.size > 0;
  const set = <K extends Field>(f: K, v: Form[K]) => {
    setForm((x) => ({ ...x, [f]: v }));
    setTouched((t) => new Set(t).add(f));
    setReset((r) => {
      const n = new Set(r);
      n.delete(f);
      return n;
    });
  };
  const back = (f: Field) => {
    setReset((r) => new Set(r).add(f));
    setTouched((t) => {
      const n = new Set(t);
      n.delete(f);
      return n;
    });
    const b = status.base;
    setForm((x) => ({ ...x, [f]: typeof x[f] === "boolean" ? b[f] : String(b[f]) }) as Form);
  };

  const save = () =>
    startSave(async () => {
      const send = (f: Field): unknown => {
        if (reset.has(f)) return null;
        if (!touched.has(f) && status.settings.sources[f] !== "reglage") return null;
        if (f === "enabled" || f === "media") return form[f];
        return touched.has(f) ? (form[f] === "" ? NaN : Number(form[f].replace(",", "."))) : status.settings[f];
      };
      const r = await saveBackupSettingsAction({ enabled: send("enabled"), media: send("media"), keep: send("keep"), quietMin: send("quietMin"), maxHours: send("maxHours") });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return toast(r.message, "error");
      }
      setErrors({});
      setStatus(r.data);
      setForm(toForm(r.data));
      setTouched(new Set());
      setReset(new Set());
      toast("Réglages enregistrés");
    });

  const now = async () => {
    setLaunching(true);
    const r = await backupNowAction();
    if (!r.ok) {
      setLaunching(false);
      return toast(r.message, "error");
    }
    // La sauvegarde est déjà démarrée (ou finie) quand l'action rend la main : l'état lu est le bon.
    await refresh();
    setLaunching(false);
  };

  const busy = status.running || launching;
  // Garde-fou du lot 85 : la dernière sauvegarde ne contient pas tout ce que la base cite.
  const latestMissing = status.archives[0]?.missing && status.archives[0].missing.count > 0 ? status.archives[0].missing : null;
  const p = status.progress;
  const nextText =
    status.next.kind === "desactivee"
      ? "Sauvegardes automatiques désactivées"
      : status.next.kind === "aucune"
        ? "Aucune modification en attente"
        : status.next.kind === "immediate"
          ? "Très bientôt"
          : `${fmtDate(status.next.at!)} (${fmtIn(status.next.at! - status.now)})`;

  const row = (label: string, value: React.ReactNode, testId?: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </>
  );

  const src = (f: Field) => {
    const s = sourceOf(f);
    return (
      <span className="a-help" data-testid={`source-${f}`} data-source={s}>
        {SOURCES[s]}
        {s === "env" && <span className="mono"> ({FIELD_ENV[f]})</span>}
        {s === "reglage" && (
          <>
            {" · "}
            <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => back(f)}>
              Revenir à la valeur d&apos;origine
            </button>
          </>
        )}
      </span>
    );
  };

  return (
    <>
      <p className="a-notice" role="note" data-testid="conseil-copie">
        Garde une copie sur ton ordinateur de temps en temps : les sauvegardes sont rangées au même endroit que ton site. Elles te protègent d&apos;une fausse manœuvre, pas de la perte du disque. Télécharge la dernière une fois de temps en temps.
      </p>

      <section className="a-section" aria-labelledby="sv-etat">
        <h2 id="sv-etat">État</h2>
        <div className="a-table-wrap">
          <dl className="a-dl">
            {row("Sauvegardes gardées", String(status.archives.length), "etat-nombre")}
            {row("Prochaine sauvegarde", nextText, "etat-prochaine")}
            {row(
              "Dernière erreur",
              status.lastError ? (
                <span className="a-danger-text">
                  {status.lastError.message} <span className="muted">({fmtDate(status.lastError.at)})</span>
                </span>
              ) : (
                <span className="muted">Aucune</span>
              ),
              "etat-erreur",
            )}
            {row("Espace libre sur le disque", status.free ? `${fmtSize(status.free.bytes)} sur ${fmtSize(status.free.total)}` : <span className="muted">inconnu</span>, "etat-espace")}
          </dl>
        </div>
        <div className="a-toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="a-btn a-btn-primary" onClick={now} disabled={busy} data-testid="sauvegarder-maintenant">
            {busy ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
          </button>
          <span className="a-help" role="status" aria-live="polite" data-testid="progression">
            {busy
              ? p?.phase === "ecriture"
                ? `Écriture de l'archive : ${p.done} fichier${p.done > 1 ? "s" : ""} sur ${p.total}`
                : "Préparation de la copie…"
              : status.lastRun
                ? `Dernière sauvegarde faite ici : ${status.lastRun.name} (${fmtSize(status.lastRun.bytes)})`
                : ""}
          </span>
        </div>
      </section>

      <section className="a-section" aria-labelledby="sv-liste">
        <h2 id="sv-liste">Sauvegardes</h2>
        {status.archives.length === 0 ? (
          <p className="muted" data-testid="sauvegardes-vide">Aucune sauvegarde pour l&apos;instant.</p>
        ) : (
          <>
          {latestMissing && (
            <p className="a-notice a-notice-danger" role="alert" data-testid="avertissement-sauvegarde">
              Attention : {latestMissing.count} fichier{latestMissing.count > 1 ? "s" : ""} utilisé{latestMissing.count > 1 ? "s" : ""} par ton site {latestMissing.count > 1 ? "ne sont" : "n'est"} pas dans la dernière sauvegarde et ne {latestMissing.count > 1 ? "peuvent" : "peut"} pas être refait{latestMissing.count > 1 ? "s" : ""} (par exemple{" "}
              <span className="mono">{latestMissing.samples.slice(0, 3).join(", ")}</span>). Renvoie ces images (ou retire-les du site) ; sinon elles seront cassées après une restauration.
            </p>
          )}
          <div className="a-table-wrap">
            <table className="a-table a-table-stack" data-testid="liste-sauvegardes">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Taille</th>
                  <th scope="col">Contenu</th>
                  <th scope="col">Version du site</th>
                  <th scope="col">Pourquoi</th>
                  <th scope="col">
                    <span className="sr-only">Télécharger</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.archives.map((a: ArchiveRow) => (
                  <tr key={a.name} data-testid="ligne-sauvegarde" data-name={a.name}>
                    <td data-label="Date">{fmtDate(a.at)}</td>
                    <td data-label="Taille">{fmtSize(a.size)}</td>
                    <td data-label="Contenu">
                      {a.withMedia === null ? "?" : a.withMedia ? "Base et médias" : "Base seule"}
                      {a.old && (
                        <span className="a-help" data-testid="sauvegarde-ancienne">
                          {" "}
                          Ancienne : sans les dessins du kit, les cadres importés ni les icônes.
                        </span>
                      )}
                    </td>
                    <td data-label="Version du site">{a.version ?? "?"}</td>
                    <td data-label="Pourquoi">{a.reason ? (REASONS[a.reason] ?? a.reason) : "?"}</td>
                    <td className="a-row-actions">
                      <button type="button" className="a-btn a-btn-small" onClick={() => void download(a.name)} disabled={unlocking} data-testid="telecharger">
                        Télécharger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={unlockFor !== null}
        title="Confirmer ton mot de passe pour télécharger"
        confirmLabel="Télécharger"
        busy={unlocking}
        confirmDisabled={!password}
        onConfirm={() => unlockFor && void download(unlockFor, password)}
        onClose={() => {
          setUnlockFor(null);
          setPassword("");
          setUnlockError(null);
        }}
      >
        <form
          className="a-field"
          onSubmit={(e) => {
            e.preventDefault();
            if (unlockFor && password) void download(unlockFor, password);
          }}
        >
          <p>Une sauvegarde contient toute la base du site. Retape ton mot de passe : le téléchargement reste ouvert 10 minutes.</p>
          <label htmlFor="sv-password">Mot de passe</label>
          <input id="sv-password" className="a-input" type="password" autoComplete="current-password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="mot-de-passe-telechargement" autoFocus />
          {unlockError && (
            <span className="a-field-error" role="alert" data-testid="erreur-mot-de-passe">
              {unlockError}
            </span>
          )}
        </form>
      </ConfirmDialog>

      <section className="a-section" aria-labelledby="sv-reglages">
        <h2 id="sv-reglages">Réglages</h2>
        <div className="a-form-grid">
          <div className="a-field">
            <label>
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="reglage-actif" /> Faire des sauvegardes automatiques
            </label>
            {src("enabled")}
          </div>
          <div className="a-field">
            <label>
              <input type="checkbox" checked={form.media} onChange={(e) => set("media", e.target.checked)} data-testid="reglage-medias" /> Inclure les images et les vidéos
            </label>
            <span className="a-help">Sans elles, la copie est bien plus légère, mais elle ne protège que les textes et la mise en page.</span>
            {src("media")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-keep">Nombre de sauvegardes gardées</label>
            <input id="sv-keep" className="a-input" type="number" min={1} max={30} step={1} value={form.keep} onChange={(e) => set("keep", e.target.value)} data-testid="reglage-garder" />
            <span className="a-help">Les plus anciennes sont supprimées à la sauvegarde suivante.</span>
            {errors.keep && <span className="a-field-error">{errors.keep}</span>}
            {src("keep")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-calme">Minutes sans modification avant de sauvegarder</label>
            <input id="sv-calme" className="a-input" type="number" min={1} max={1440} step={1} value={form.quietMin} onChange={(e) => set("quietMin", e.target.value)} data-testid="reglage-calme" />
            {errors.quietMin && <span className="a-field-error">{errors.quietMin}</span>}
            {src("quietMin")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-max">Heures au plus entre deux sauvegardes, même si tu travailles</label>
            <input id="sv-max" className="a-input" type="number" min={1} max={720} step={1} value={form.maxHours} onChange={(e) => set("maxHours", e.target.value)} data-testid="reglage-delai" />
            {errors.maxHours && <span className="a-field-error">{errors.maxHours}</span>}
            {src("maxHours")}
          </div>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} testId="enregistrer-reglages" />
      </section>
    </>
  );
}
