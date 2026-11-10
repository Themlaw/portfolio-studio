"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { backupNowAction, backupStatusAction, saveBackupSettingsAction, unlockBackupDownloadAction } from "@/app/admin/(espace)/sauvegardes/actions";
import type { ArchiveRow, BackupStatus } from "@/lib/backup/service";

import { ConfirmDialog, SaveBar, toast } from "./editing";

const REASON_KEYS = ["premier", "calme", "delai", "manuel"];

type Tr = ReturnType<typeof useTranslations>;
type Fmt = ReturnType<typeof useFormatter>;

export function fmtSize(b: number, t: Tr, format: Fmt) {
  const one = (v: number) => format.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (b >= 1073741824) return `${one(b / 1073741824)} ${t("unitGB")}`;
  if (b >= 1048576) return `${one(b / 1048576)} ${t("unitMB")}`;
  return `${Math.max(1, Math.round(b / 1024))} ${t("unitKB")}`;
}

type Form = { enabled: boolean; media: boolean; keep: string; quietMin: string; maxHours: string };
type Field = keyof Form;
const FIELD_ENV: Record<Field, string> = { enabled: "WITH_BACKUP", media: "BACKUP_MEDIA", keep: "BACKUP_KEEP", quietMin: "BACKUP_QUIET_MIN", maxHours: "BACKUP_MAX_HOURS" };

const toForm = (s: BackupStatus): Form => ({ enabled: s.settings.enabled, media: s.settings.media, keep: String(s.settings.keep), quietMin: String(s.settings.quietMin), maxHours: String(s.settings.maxHours) });

export default function BackupPanel({ initial }: { initial: BackupStatus }) {
  const t = useTranslations("backups");
  const format = useFormatter();
  const fmtDate = (ms: number) => format.dateTime(new Date(ms), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtSz = (b: number) => fmtSize(b, t, format);
  const num = (n: number) => format.number(n, { useGrouping: false, maximumFractionDigits: 3 });
  const fmtIn = (ms: number) => {
    const min = Math.max(1, Math.round(ms / 60_000));
    if (min < 60) return t("inMinutes", { min });
    return t("inHours", { h: num(Math.round(min / 6) / 10) });
  };
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
    if (!r) return toast(t("downloadFailed"), "error");
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

  // Lot 118 : l'état se rafraîchit aussi au repos (30 s), pour que l'alerte rouge apparaisse sans recharger la page.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suivi de la sauvegarde en cours : une lecture toutes les 1,5 s, tant qu'elle dure.
  useEffect(() => {
    if (!status.running && !launching) {
      if (wasRunning.current) {
        wasRunning.current = false;
        if (status.lastError) toast(t("backupFailed", { message: status.lastError.message }), "error");
        else toast(t("backupDone"));
      }
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(() => void refresh().then(() => setLaunching(false)), 1500);
    return () => clearInterval(timer);
  }, [status.running, launching, status.lastError, t]);

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
      toast(t("settingsSaved"));
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
      ? t("nextDisabled")
      : status.next.kind === "aucune"
        ? t("nextNone")
        : status.next.kind === "immediate"
          ? t("nextSoon")
          : t("nextAt", { date: fmtDate(status.next.at!), when: fmtIn(status.next.at! - status.now) });

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
        {t(`source_${s}`)}
        {s === "env" && <span className="mono"> ({FIELD_ENV[f]})</span>}
        {s === "reglage" && (
          <>
            {" · "}
            <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => back(f)}>
              {t("backToDefault")}
            </button>
          </>
        )}
      </span>
    );
  };

  return (
    <>
      <p className="a-notice" role="note" data-testid="conseil-copie">
        {t("advice")}
      </p>

      <span hidden data-testid="activite-sauvegarde" data-last-change={status.activity?.lastChangeAt ?? ""} data-last-user={status.activity?.lastUserAt ?? ""} data-changes={status.activity?.changes ?? ""} />
      {status.alert && (
        <p className="a-notice a-notice-danger" role="alert" data-testid="alerte-sauvegarde" data-kind={status.alert.kind}>
          {t("alert", { message: status.alert.message, date: fmtDate(status.alert.since) })}
        </p>
      )}
      <section className="a-section" aria-labelledby="sv-etat">
        <h2 id="sv-etat">{t("state")}</h2>
        <div className="a-table-wrap">
          <dl className="a-dl">
            {row(t("kept"), String(status.archives.length), "etat-nombre")}
            {row(
              t("retentionRule"),
              t("retentionText", { keep: String(status.settings.keep), days: String(status.settings.keepDays) }),
              "etat-conservation",
            )}
            {row(t("delayLabel"), t("delayText", { maxHours: num(status.settings.maxHours), quietMin: num(status.settings.quietMin) }), "etat-delai")}
            {row(t("next"), nextText, "etat-prochaine")}
            {row(
              t("lastError"),
              status.lastError ? (
                <span className="a-danger-text">
                  {status.lastError.message} <span className="muted">({fmtDate(status.lastError.at)})</span>
                </span>
              ) : (
                <span className="muted">{t("none")}</span>
              ),
              "etat-erreur",
            )}
            {row(t("freeSpace"), status.free ? t("freeOf", { free: fmtSz(status.free.bytes), total: fmtSz(status.free.total) }) : <span className="muted">{t("unknown")}</span>, "etat-espace")}
          </dl>
        </div>
        <div className="a-toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="a-btn a-btn-primary" onClick={now} disabled={busy} data-testid="sauvegarder-maintenant">
            {busy ? t("backingUp") : t("backupNow")}
          </button>
          <span className="a-help" role="status" aria-live="polite" data-testid="progression">
            {busy
              ? p?.phase === "ecriture"
                ? t("writing", { done: p.done, total: p.total })
                : t("preparing")
              : status.lastRun
                ? t("lastRun", { name: status.lastRun.name, size: fmtSz(status.lastRun.bytes) })
                : ""}
          </span>
        </div>
      </section>

      <section className="a-section" aria-labelledby="sv-liste">
        <h2 id="sv-liste">{t("listTitle")}</h2>
        {status.archives.length === 0 ? (
          <p className="muted" data-testid="sauvegardes-vide">{t("empty")}</p>
        ) : (
          <>
          {latestMissing && (
            <p className="a-notice a-notice-danger" role="alert" data-testid="avertissement-sauvegarde">
              {t.rich("missing", { count: latestMissing.count, samples: latestMissing.samples.slice(0, 3).join(", "), mono: (c) => <span className="mono">{c}</span> })}
            </p>
          )}
          <div className="a-table-wrap">
            <table className="a-table a-table-stack" data-testid="liste-sauvegardes">
              <thead>
                <tr>
                  <th scope="col">{t("colDate")}</th>
                  <th scope="col">{t("colSize")}</th>
                  <th scope="col">{t("colContent")}</th>
                  <th scope="col">{t("colVersion")}</th>
                  <th scope="col">{t("colWhy")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("download")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.archives.map((a: ArchiveRow) => (
                  <tr key={a.name} data-testid="ligne-sauvegarde" data-name={a.name}>
                    <td data-label={t("colDate")}>
                      {fmtDate(a.at)}
                      {a.retention && (
                        <span className={`a-badge${a.retention.kind === "recente" ? "" : " a-badge-muted"}`} data-testid="conservation" data-kind={a.retention.kind} data-day={a.retention.day}>
                          {" "}
                          {a.retention.kind === "recente" ? t("retRecent") : t("retDay")}
                        </span>
                      )}
                    </td>
                    <td data-label={t("colSize")}>{fmtSz(a.size)}</td>
                    <td data-label={t("colContent")}>
                      {a.withMedia === null ? "?" : a.withMedia ? t("withMedia") : t("dbOnly")}
                      {a.old && (
                        <span className="a-help" data-testid="sauvegarde-ancienne">
                          {" "}
                          {t("oldBackup")}
                        </span>
                      )}
                    </td>
                    <td data-label={t("colVersion")}>{a.version ?? "?"}</td>
                    <td data-label={t("colWhy")}>{a.reason ? (REASON_KEYS.includes(a.reason) ? t(`reason_${a.reason}`) : a.reason) : "?"}</td>
                    <td className="a-row-actions">
                      <button type="button" className="a-btn a-btn-small" onClick={() => void download(a.name)} disabled={unlocking} data-testid="telecharger">
                        {t("download")}
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
        title={t("unlockTitle")}
        confirmLabel={t("download")}
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
          <p>{t("unlockBody")}</p>
          <label htmlFor="sv-password">{t("password")}</label>
          <input id="sv-password" className="a-input" type="password" autoComplete="current-password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="mot-de-passe-telechargement" autoFocus />
          {unlockError && (
            <span className="a-field-error" role="alert" data-testid="erreur-mot-de-passe">
              {unlockError}
            </span>
          )}
        </form>
      </ConfirmDialog>

      <section className="a-section" aria-labelledby="sv-reglages">
        <h2 id="sv-reglages">{t("settingsTitle")}</h2>
        <div className="a-form-grid">
          <div className="a-field">
            <label>
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="reglage-actif" /> {t("autoBackups")}
            </label>
            {src("enabled")}
          </div>
          <div className="a-field">
            <label>
              <input type="checkbox" checked={form.media} onChange={(e) => set("media", e.target.checked)} data-testid="reglage-medias" /> {t("includeMedia")}
            </label>
            <span className="a-help">{t("includeMediaHelp")}</span>
            {src("media")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-keep">{t("keepLabel")}</label>
            <input id="sv-keep" className="a-input" type="number" min={1} max={30} step={1} value={form.keep} onChange={(e) => set("keep", e.target.value)} data-testid="reglage-garder" />
            <span className="a-help">
              {t("keepHelp", { days: String(status.settings.keepDays) })}
            </span>
            {errors.keep && <span className="a-field-error">{errors.keep}</span>}
            {src("keep")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-calme">{t("quietLabel")}</label>
            <input id="sv-calme" className="a-input" type="number" min={1} max={1440} step={1} value={form.quietMin} onChange={(e) => set("quietMin", e.target.value)} data-testid="reglage-calme" />
            {errors.quietMin && <span className="a-field-error">{errors.quietMin}</span>}
            {src("quietMin")}
          </div>
          <div className="a-field">
            <label htmlFor="sv-max">{t("maxLabel")}</label>
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
