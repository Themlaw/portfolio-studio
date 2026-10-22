"use client";

/**
 * « Premiers pas » du tableau de bord : cinq étapes qui se cochent d'après l'état réel du site (`getOnboarding`),
 * chacune avec une phrase d'explication et un lien direct. Masquable (réglage enregistré), réaffichable.
 */
import Link from "next/link";
import { useState, useTransition } from "react";

import { setOnboardingHiddenAction } from "@/app/admin/(espace)/premiers-pas-actions";
import type { Onboarding, OnboardingStep } from "@/lib/admin";

import { toast } from "./editing";

const TEXTS: Record<OnboardingStep["key"], { title: string; text: string; href: string; cta: string }> = {
  theme: { title: "Choisir un thème", text: "Le thème donne les couleurs, les polices et l'ambiance de tout ton site.", href: "/admin/themes", cta: "Choisir un thème" },
  project: { title: "Créer un projet et y mettre des images", text: "Un projet rassemble tes images. Celles que tu envoies depuis un projet y sont ajoutées directement.", href: "/admin/projets", cta: "Ouvrir les projets" },
  page: { title: "L'afficher sur une page", text: "Un projet n'est visible que si une page l'affiche : ajoute un bloc « Projet » à une page.", href: "/admin/pages", cta: "Choisir une page" },
  publish: { title: "Publier", text: "Tant qu'une page n'est pas publiée, personne ne la voit sur ton site.", href: "/admin/pages", cta: "Publier une page" },
  about: { title: "Remplir « À propos » et le contact", text: "Ton nom, ta présentation et ton adresse e-mail, pour qu'on puisse te contacter.", href: "/admin/reglages", cta: "Remplir mes informations" },
};

export default function FirstSteps({ onboarding }: { onboarding: Onboarding }) {
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
          Afficher les premiers pas
        </button>
      </p>
    );
  }
  return (
    <section className="a-card a-firststeps" aria-labelledby="premiers-pas" data-testid="first-steps">
      <div className="a-firststeps-head">
        <h2 id="premiers-pas">Premiers pas</h2>
        <span className="muted" data-testid="first-steps-count">
          {left === 0 ? "Tout est fait" : `${onboarding.steps.length - left} sur ${onboarding.steps.length}`}
        </span>
        <button type="button" className="a-btn a-btn-small a-btn-quiet" disabled={pending} onClick={() => change(true)}>
          Masquer
        </button>
      </div>
      <ol className="a-firststeps-list">
        {onboarding.steps.map((s) => {
          const t = TEXTS[s.key];
          return (
            <li key={s.key} data-step={s.key} data-done={s.done || undefined}>
              <span className="a-firststeps-box" aria-hidden="true">
                {s.done ? "✓" : ""}
              </span>
              <div>
                <strong>
                  {t.title}
                  {s.done && <span className="sr-only"> (fait)</span>}
                </strong>
                <p className="muted">{t.text}</p>
                <Link href={t.href}>{t.cta}</Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
