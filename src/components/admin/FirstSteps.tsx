"use client";

/**
 * « Premiers pas » du tableau de bord : cinq étapes qui se cochent d'après l'état réel du site (`getOnboarding`),
 * chacune avec une phrase d'explication et un lien direct. Masquable (réglage enregistré), réaffichable.
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";

import { setOnboardingHiddenAction } from "@/app/admin/(espace)/premiers-pas-actions";
import type { Onboarding, OnboardingStep } from "@/lib/admin";

import { toast } from "./editing";

/** Textes (titre, phrase, lien) dans le catalogue `firstSteps` : `<étape>_title`, `<étape>_text`, `<étape>_cta`. */
const HREFS: Record<OnboardingStep["key"], string> = {
  theme: "/admin/themes",
  project: "/admin/pages#projets",
  page: "/admin/pages",
  publish: "/admin/pages",
  about: "/admin/reglages",
};

export default function FirstSteps({ onboarding }: { onboarding: Onboarding }) {
  const t = useTranslations("firstSteps");
  const [hidden, setHidden] = useState(onboarding.hidden);
  const [pending, start] = useTransition();
  const left = onboarding.steps.filter((s) => !s.done).length;
  const change = (next: boolean) => {
    setHidden(next);
    start(async () => {
      const r = await setOnboardingHiddenAction(next);
      if (!r.ok) {
        setHidden(!next);
        toast(r.message, "error");
      }
    });
  };
  if (hidden) {
    return (
      <p className="a-firststeps-show" data-testid="first-steps-show">
        <button type="button" className="a-link-btn" disabled={pending} onClick={() => change(false)}>
          {t("show")}
        </button>
      </p>
    );
  }
  return (
    <section className="a-card a-firststeps" aria-labelledby="premiers-pas" data-testid="first-steps">
      <div className="a-firststeps-head">
        <h2 id="premiers-pas">{t("title")}</h2>
        <span className="muted" data-testid="first-steps-count">
          {left === 0 ? t("allDone") : t("progress", { done: onboarding.steps.length - left, total: onboarding.steps.length })}
        </span>
        <button type="button" className="a-btn a-btn-small a-btn-quiet" disabled={pending} onClick={() => change(true)}>
          {t("hide")}
        </button>
      </div>
      <ol className="a-firststeps-list">
        {onboarding.steps.map((s) => {
          return (
            <li key={s.key} data-step={s.key} data-done={s.done || undefined}>
              <span className="a-firststeps-box" aria-hidden="true">
                {s.done ? "✓" : ""}
              </span>
              <div>
                <strong>
                  {t(`${s.key}_title`)}
                  {s.done && <span className="sr-only"> {t("doneSr")}</span>}
                </strong>
                <p className="muted">{t(`${s.key}_text`)}</p>
                <Link href={HREFS[s.key]}>{t(`${s.key}_cta`)}</Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
