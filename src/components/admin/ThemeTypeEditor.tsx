"use client";

/**
 * Typographie du thème par rôle (`tokens.type`, schéma src/themes/schema.ts) :
 * police (parmi celles du thème), graisse, italique, casse, interlettrage.
 * « Thème » = aucune valeur posée (clé absente, rendu d'avant). Mêmes rôles et
 * mêmes sélecteurs que les styles du site (src/lib/look.ts) : ordre thème < site < texte.
 */
import { useTranslations } from "next-intl";
import { useId } from "react";

import { TEXT_ROLES, type Theme } from "@/themes/schema";

type TypeTokens = NonNullable<Theme["tokens"]["type"]>;
type RoleStyle = NonNullable<TypeTokens[(typeof TEXT_ROLES)[number]]>;
type Role = (typeof TEXT_ROLES)[number];

const FONT_KEYS = ["display", "body", "caption"] as const;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export default function ThemeTypeEditor({ value, onChange }: { value: Theme["tokens"]["type"]; onChange: (next: TypeTokens | undefined) => void }) {
  const t = useTranslations("themeType");
  const idBase = useId();
  const current: TypeTokens = value ?? {};
  const setRole = (role: Role, patch: Partial<Record<keyof RoleStyle, unknown>>) => {
    const merged = Object.fromEntries(Object.entries({ ...(current[role] ?? {}), ...patch }).filter(([, v]) => v !== undefined)) as RoleStyle;
    const next: TypeTokens = { ...current };
    if (Object.keys(merged).length) next[role] = merged;
    else delete next[role];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="a-type-roles" data-testid="theme-type">
      <h3 className="a-subhead">{t("title")}</h3>
      <p className="a-help">
        {t("intro")}
      </p>
      {TEXT_ROLES.map((role) => {
        const s = current[role] ?? {};
        const id = `${idBase}-${role}`;
        const touched = Object.keys(s).length > 0;
        return (
          <fieldset key={role} className="a-fieldset a-type-role" data-role={role}>
            <legend>{t(`roles.${role}.title`)}</legend>
            <p className="a-help">{t(`roles.${role}.help`)}</p>
            <div className="a-type-grid">
              <div className="a-field">
                <label htmlFor={`${id}-font`}>{t("font")}</label>
                <select id={`${id}-font`} className="a-input a-select" value={s.font ?? ""} onChange={(e) => setRole(role, { font: e.target.value || undefined })}>
                  <option value="">{t("theme")}</option>
                  {FONT_KEYS.map((f) => (
                    <option key={f} value={f}>
                      {t(`fonts.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="a-field">
                <label htmlFor={`${id}-weight`}>{t("weight")}</label>
                <select id={`${id}-weight`} className="a-input a-select" value={s.weight ?? ""} onChange={(e) => setRole(role, { weight: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">{t("theme")}</option>
                  {WEIGHTS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
              <div className="a-field">
                <label htmlFor={`${id}-italic`}>{t("italic")}</label>
                <select id={`${id}-italic`} className="a-input a-select" value={s.italic === undefined ? "" : s.italic ? "1" : "0"} onChange={(e) => setRole(role, { italic: e.target.value === "" ? undefined : e.target.value === "1" })}>
                  <option value="">{t("theme")}</option>
                  <option value="1">{t("yes")}</option>
                  <option value="0">{t("no")}</option>
                </select>
              </div>
              <div className="a-field">
                <label htmlFor={`${id}-case`}>{t("case")}</label>
                <select id={`${id}-case`} className="a-input a-select" value={s.case ?? ""} onChange={(e) => setRole(role, { case: e.target.value || undefined })}>
                  <option value="">{t("theme")}</option>
                  <option value="normal">{t("caseNormal")}</option>
                  <option value="upper">{t("caseUpper")}</option>
                </select>
              </div>
              <div className="a-field">
                <label htmlFor={`${id}-tracking`}>{t("tracking")}</label>
                <input
                  id={`${id}-tracking`}
                  className="a-input"
                  type="number"
                  min={-0.05}
                  max={0.4}
                  step={0.01}
                  placeholder={t("theme")}
                  value={s.tracking ?? ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100) / 100;
                    setRole(role, { tracking: n === undefined || Number.isNaN(n) ? undefined : Math.min(0.4, Math.max(-0.05, n)) });
                  }}
                />
              </div>
            </div>
            {touched && (
              <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => onChange(Object.fromEntries(Object.entries(current).filter(([k]) => k !== role)) as TypeTokens)}>
                {t("resetRole")}
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
