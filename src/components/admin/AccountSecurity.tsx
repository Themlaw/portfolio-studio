"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { changePasswordAction, revokeOtherSessionsAction } from "@/app/admin/(espace)/compte/actions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import type { SessionRow } from "@/lib/auth/sessions";

import { ConfirmDialog, toast, useUnsavedGuard } from "./editing";

const fmtDate = (ms: number) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Pw = { currentPassword: string; newPassword: string; confirm: string };
const EMPTY: Pw = { currentPassword: "", newPassword: "", confirm: "" };

/** Écran « Sécurité du compte » (audit de sécurité, P3) : mot de passe, sessions ouvertes, déconnexion des autres. */
export default function AccountSecurity({ email, passwordEnabled, sessions, idleDays, maxDays }: { email: string; passwordEnabled: boolean; sessions: SessionRow[]; idleDays: number; maxDays: number }) {
  const router = useRouter();
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
    if (!r) return toast("Le mot de passe n'a pas pu être changé. Réessaie.", "error");
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return toast(r.message, "error");
    }
    setPw(EMPTY);
    setErrors({});
    toast("Mot de passe changé. Tous les autres appareils sont déconnectés.");
    router.refresh();
  };

  const revoke = async () => {
    setRevoking(true);
    const r = await revokeOtherSessionsAction().catch(() => null);
    setRevoking(false);
    setConfirmRevoke(false);
    if (!r || !r.ok) return toast(r?.message ?? "Les autres sessions n'ont pas pu être déconnectées. Réessaie.", "error");
    toast(r.data.revoked ? `${r.data.revoked} autre${r.data.revoked > 1 ? "s" : ""} session${r.data.revoked > 1 ? "s" : ""} déconnectée${r.data.revoked > 1 ? "s" : ""}.` : "Aucune autre session à déconnecter.");
    router.refresh();
  };

  return (
    <>
      <section className="a-section" aria-labelledby="cs-mdp">
        <h2 id="cs-mdp">Mot de passe</h2>
        {!passwordEnabled ? (
          <p className="muted" data-testid="mdp-desactive">
            La connexion par mot de passe est désactivée sur ce site : tu te connectes avec Authentik, où se change ton mot de passe.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!saving) void changePassword();
            }}
          >
            <p className="a-help">
              Compte : <span className="mono">{email}</span>. Changer le mot de passe déconnecte tous les autres appareils (cette session reste ouverte).
            </p>
            <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
            <div className="a-form-grid">
              <div className="a-field">
                <label htmlFor="cs-actuel">Mot de passe actuel</label>
                <input id="cs-actuel" className="a-input" type="password" autoComplete="current-password" maxLength={128} value={pw.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} data-testid="mdp-actuel" />
                {errors.currentPassword && <span className="a-field-error">{errors.currentPassword}</span>}
              </div>
              <div className="a-field">
                <label htmlFor="cs-nouveau">Nouveau mot de passe</label>
                <input id="cs-nouveau" className="a-input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} value={pw.newPassword} onChange={(e) => set("newPassword", e.target.value)} data-testid="mdp-nouveau" />
                <span className="a-help">Au moins {MIN_PASSWORD_LENGTH} caractères ; une phrase de plusieurs mots est plus sûre et plus facile à retenir.</span>
                {errors.newPassword && <span className="a-field-error">{errors.newPassword}</span>}
              </div>
              <div className="a-field">
                <label htmlFor="cs-confirmation">Nouveau mot de passe, encore une fois</label>
                <input id="cs-confirmation" className="a-input" type="password" autoComplete="new-password" maxLength={128} value={pw.confirm} onChange={(e) => set("confirm", e.target.value)} data-testid="mdp-confirmation" />
                {errors.confirm && <span className="a-field-error">{errors.confirm}</span>}
              </div>
            </div>
            <p>
              <button type="submit" className="a-btn a-btn-primary" disabled={saving || !pw.currentPassword || !pw.newPassword || !pw.confirm} data-testid="mdp-changer">
                {saving ? "Un instant…" : "Changer le mot de passe"}
              </button>
            </p>
          </form>
        )}
      </section>

      <section className="a-section" aria-labelledby="cs-sessions">
        <h2 id="cs-sessions">Appareils connectés</h2>
        <p className="a-help">
          Une connexion expire après {idleDays} jours sans utilisation, et au plus tard {maxDays} jours après qu&apos;elle a été ouverte : il faut alors se reconnecter.
        </p>
        <div className="a-table-wrap">
          <table className="a-table a-table-stack" data-testid="liste-sessions">
            <thead>
              <tr>
                <th scope="col">Navigateur</th>
                <th scope="col">Adresse IP</th>
                <th scope="col">Connexion</th>
                <th scope="col">Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} data-testid="ligne-session" data-current={s.current}>
                  <td data-label="Navigateur">
                    {s.browser}
                    {s.current && <span className="a-badge"> Cette session</span>}
                  </td>
                  <td data-label="Adresse IP" className="mono">
                    {s.ip ?? "inconnue"}
                  </td>
                  <td data-label="Connexion">{fmtDate(s.createdAt)}</td>
                  <td data-label="Dernière activité">{fmtDate(s.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <button type="button" className="a-btn" onClick={() => setConfirmRevoke(true)} disabled={others === 0 || revoking} data-testid="deconnecter-autres">
            Déconnecter les autres sessions{others ? ` (${others})` : ""}
          </button>
        </p>
      </section>

      <ConfirmDialog
        open={confirmRevoke}
        title={`Déconnecter ${others} autre${others > 1 ? "s" : ""} session${others > 1 ? "s" : ""} ?`}
        confirmLabel="Déconnecter"
        danger
        busy={revoking}
        onConfirm={() => void revoke()}
        onClose={() => setConfirmRevoke(false)}
      >
        <p>Les autres appareils devront se reconnecter. Cette session reste ouverte. Si tu ne reconnais pas une connexion, change aussi ton mot de passe.</p>
      </ConfirmDialog>
    </>
  );
}
