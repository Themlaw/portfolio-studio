"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { changePasswordAction, revokeOtherSessionsAction, setAdminLangAction } from "@/app/admin/(espace)/compte/actions";
import { ADMIN_LANGS, type AdminLang } from "@/i18n/admin-lang";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import type { SessionRow } from "@/lib/auth/sessions";

import { ConfirmDialog, toast, useUnsavedGuard } from "./editing";

type Pw = { currentPassword: string; newPassword: string; confirm: string };
const EMPTY: Pw = { currentPassword: "", newPassword: "", confirm: "" };

/** Écran « Sécurité du compte » (audit de sécurité, P3) : mot de passe, sessions ouvertes, déconnexion des autres. */
export default function AccountSecurity({ email, passwordEnabled, sessions, idleDays, maxDays, lang }: { email: string; passwordEnabled: boolean; sessions: SessionRow[]; idleDays: number; maxDays: number; lang: AdminLang }) {
  const router = useRouter();
  const t = useTranslations("account");
  const format = useFormatter();
  const fmtDate = (ms: number) => format.dateTime(new Date(ms), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const [langSaving, setLangSaving] = useState(false);
  const [pw, setPw] = useState<Pw>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const dirty = pw.currentPassword !== "" || pw.newPassword !== "" || pw.confirm !== "";
  useUnsavedGuard(dirty);
  const others = sessions.filter((s) => !s.current).length;

  const set = (k: keyof Pw, v: string) => {
    setPw((p) => ({ ...p, [k]: v }));
    setErrors((e) => {
      const next = { ...e };
      delete next[k];
      return next;
    });
  };

  const changePassword = async () => {
    setSaving(true);
    const r = await changePasswordAction(pw).catch(() => null);
    setSaving(false);
    if (!r) return toast(t("passwordFailed"), "error");
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return toast(r.message, "error");
    }
    setPw(EMPTY);
    setErrors({});
    toast(t("passwordChanged"));
    router.refresh();
  };

  const revoke = async () => {
    setRevoking(true);
    const r = await revokeOtherSessionsAction().catch(() => null);
    setRevoking(false);
    setConfirmRevoke(false);
    if (!r || !r.ok) return toast(r?.message ?? t("revokeFailed"), "error");
    toast(r.data.revoked ? t("revoked", { count: r.data.revoked }) : t("revokedNone"));
    router.refresh();
  };

  const changeLang = async (next: AdminLang) => {
    setLangSaving(true);
    const r = await setAdminLangAction(next).catch(() => null);
    setLangSaving(false);
    if (!r || !r.ok) return toast(r?.message ?? t("langFailed"), "error");
    // Le cookie est posé par l'action : la page est rendue de nouveau dans la langue choisie.
    router.refresh();
  };

  return (
    <>
      <section className="a-section" aria-labelledby="cs-langue">
        <h2 id="cs-langue">{t("interfaceLang")}</h2>
        <p className="a-help">{t("interfaceLangHelp")}</p>
        <div className="a-field">
          <label htmlFor="cs-langue-select">{t("interfaceLangLabel")}</label>
          <select id="cs-langue-select" className="a-input" value={lang} disabled={langSaving} onChange={(e) => void changeLang(e.target.value as AdminLang)} data-testid="langue-interface">
            {ADMIN_LANGS.map((l) => (
              <option key={l} value={l}>
                {t(`lang_${l}`)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="a-section" aria-labelledby="cs-mdp">
        <h2 id="cs-mdp">{t("password")}</h2>
        {!passwordEnabled ? (
          <p className="muted" data-testid="mdp-desactive">
            {t("passwordDisabled")}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!saving) void changePassword();
            }}
          >
            <p className="a-help">
              {t.rich("accountIntro", { email, mono: (chunks) => <span className="mono">{chunks}</span> })}
            </p>
            <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
            <div className="a-form-grid">
              <div className="a-field">
                <label htmlFor="cs-actuel">{t("currentPassword")}</label>
                <input id="cs-actuel" className="a-input" type="password" autoComplete="current-password" maxLength={128} value={pw.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} data-testid="mdp-actuel" />
                {errors.currentPassword && <span className="a-field-error">{errors.currentPassword}</span>}
              </div>
              <div className="a-field">
                <label htmlFor="cs-nouveau">{t("newPassword")}</label>
                <input id="cs-nouveau" className="a-input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} value={pw.newPassword} onChange={(e) => set("newPassword", e.target.value)} data-testid="mdp-nouveau" />
                <span className="a-help">{t("newPasswordHelp", { min: MIN_PASSWORD_LENGTH })}</span>
                {errors.newPassword && <span className="a-field-error">{errors.newPassword}</span>}
              </div>
              <div className="a-field">
                <label htmlFor="cs-confirmation">{t("confirmPassword")}</label>
                <input id="cs-confirmation" className="a-input" type="password" autoComplete="new-password" maxLength={128} value={pw.confirm} onChange={(e) => set("confirm", e.target.value)} data-testid="mdp-confirmation" />
                {errors.confirm && <span className="a-field-error">{errors.confirm}</span>}
              </div>
            </div>
            <p>
              <button type="submit" className="a-btn a-btn-primary" disabled={saving || !pw.currentPassword || !pw.newPassword || !pw.confirm} data-testid="mdp-changer">
                {saving ? t("pleaseWait") : t("changePassword")}
              </button>
            </p>
          </form>
        )}
      </section>

      <section className="a-section" aria-labelledby="cs-sessions">
        <h2 id="cs-sessions">{t("devices")}</h2>
        <p className="a-help">
          {t("sessionsHelp", { idle: idleDays, max: maxDays })}
        </p>
        <div className="a-table-wrap">
          <table className="a-table a-table-stack" data-testid="liste-sessions">
            <thead>
              <tr>
                <th scope="col">{t("colBrowser")}</th>
                <th scope="col">{t("colIp")}</th>
                <th scope="col">{t("colLogin")}</th>
                <th scope="col">{t("colLastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} data-testid="ligne-session" data-current={s.current}>
                  <td data-label={t("colBrowser")}>
                    {s.browser}
                    {s.current && <span className="a-badge"> {t("thisSession")}</span>}
                  </td>
                  <td data-label={t("colIp")} className="mono">
                    {s.ip ?? t("unknownIp")}
                  </td>
                  <td data-label={t("colLogin")}>{fmtDate(s.createdAt)}</td>
                  <td data-label={t("colLastSeen")}>{fmtDate(s.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <button type="button" className="a-btn" onClick={() => setConfirmRevoke(true)} disabled={others === 0 || revoking} data-testid="deconnecter-autres">
            {t("revokeOthers")}{others ? ` (${others})` : ""}
          </button>
        </p>
      </section>

      <ConfirmDialog
        open={confirmRevoke}
        title={t("revokeTitle", { count: others })}
        confirmLabel={t("revokeConfirm")}
        danger
        busy={revoking}
        onConfirm={() => void revoke()}
        onClose={() => setConfirmRevoke(false)}
      >
        <p>{t("revokeBody")}</p>
      </ConfirmDialog>
    </>
  );
}
