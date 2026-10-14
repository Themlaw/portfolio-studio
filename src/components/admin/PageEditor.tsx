"use client";

/**
 * Formulaire d'une page : informations (titre, adresses, publication, menu), référencement et accent. Le
 * CONTENU (blocs) se compose dans l'éditeur visuel, qui propose tout ce que ce formulaire offrait (ajouter,
 * déplacer, supprimer, régler chaque composant) : ici, un lien. Les blocs sont renvoyés tels que chargés, pour
 * que l'enregistrement ne les change pas. Enregistrer publie aussitôt si la page est publiée ; s'il existe un
 * brouillon de l'éditeur visuel, le formulaire le reprend et l'enregistrement le publie (un seul état).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { errorAt, Field, TextareaI18n, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { savePageAction } from "@/app/admin/(espace)/pages/actions";
import type { AdminPageEdit } from "@/lib/admin";
import { accentProblem, nearestAccent } from "@/themes/contrast";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";

type Colors = { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string };
type EditBlock = { uid: string; type: string; props: Record<string, unknown> };
type State = Omit<AdminPageEdit, "blocks" | "id" | "isHome"> & { blocks: EditBlock[] };

function toState(page: AdminPageEdit): State {
  const { title, slug, meta, published, inMenu, accent, blocks } = page;
  return {
    ...clone({ title, slug, meta, published, inMenu, accent }),
    blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: clone(b.props) })),
  };
}

/** Charge envoyée au serveur : les blocs tels que chargés (jamais modifiés ici). */
const payload = (s: State) => ({ ...s, blocks: s.blocks.map(({ type, props }) => ({ type, props })) });

export default function PageEditor({
  page,
  colors,
  rev: initialRev,
}: {
  page: AdminPageEdit;
  /** Version du contenu lue au chargement (contrôle optimiste, src/lib/edit/drafts.ts). */
  rev: number;
  colors: Colors | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => toState(page));
  const [state, setState] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [rev, setRev] = useState(initialRev);
  const [conflict, setConflict] = useState<string | null>(null);
  const dirty = !same(payload(state), payload(saved));
  // Erreurs de bloc renvoyées par la validation du serveur (un bloc publié devenu invalide, par exemple).
  const blockProblems = Object.entries(errors).filter(([k]) => k === "blocks" || k.startsWith("blocks."));
  useUnsavedGuard(dirty);

  const set = <K extends keyof State>(k: K, v: State[K]) => setState((s) => ({ ...s, [k]: v }));
  const accentIssue = state.accent && colors ? accentProblem(state.accent, colors) : null;
  const accentFix = state.accent && colors && accentIssue ? nearestAccent(state.accent, colors) : null;
  // Accent enregistré devenu illisible après un changement de thème : ignoré au rendu.
  const savedAccentIgnored = Boolean(saved.accent && colors && accentProblem(saved.accent, colors));

  const save = () => {
    if (accentIssue) {
      setError("L'accent de la page n'est pas assez contrasté : ajuste-le ou retire-le avant d'enregistrer.");
      return;
    }
    start(async () => {
      const result = await savePageAction(page.id, payload(state), rev);
      if (!result.ok) {
        if ("code" in result) {
          // Modifiée ailleurs (ou brouillon illisible) : rien n'est écrasé.
          setConflict(result.message);
          setError(result.message);
          return;
        }
        setError(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setError(null);
      setErrors({});
      setRev(result.data.rev);
      setSaved(clone(state));
      toast(state.published ? "Enregistré · en ligne" : "Enregistré");
      // Hors de la transition : l'état « Enregistré » s'affiche sans attendre le rafraîchissement.
      setTimeout(() => router.refresh(), 0);
    });
  };

  return (
    <div className="a-page-editor">
      {conflict && (
        <div className="a-notice a-notice-danger" role="alert">
          <p>{conflict} Tes champs restent affichés ici : copie ce que tu veux garder avant de recharger.</p>
          <button type="button" className="a-btn a-btn-small" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      )}
      <section className="a-panel" aria-labelledby="pe-infos">
        <h2 id="pe-infos">Informations</h2>
        <div className="a-form-grid">
          <TextI18n label="Titre" help="Dans le menu et en haut de l'onglet." value={state.title} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
          <div />
          {page.isHome ? (
            <>
              <Field label="Adresses" help="Page d'accueil : son adresse est la racine du site et ne se change pas.">
                <p className="a-readonly mono">/fr · /en</p>
              </Field>
              <div />
            </>
          ) : (
            <>
              <TextField
                label="Adresse en français"
                help={`/fr/${state.slug.fr || "…"} — minuscules, chiffres et tirets.`}
                value={state.slug.fr}
                onChange={(v) => set("slug", { ...state.slug, fr: v })}
                error={errors["slug.fr"]}
              />
              <TextField
                label="Adresse en anglais"
                help={`/en/${state.slug.en || "…"}`}
                value={state.slug.en}
                onChange={(v) => set("slug", { ...state.slug, en: v })}
                error={errors["slug.en"]}
              />
            </>
          )}
          <Toggle
            label="Publiée"
            help={page.isHome ? "L'accueil reste toujours publié." : "Non publiée, la page répond « introuvable » à tes visiteurs."}
            checked={state.published}
            onChange={(v) => !page.isHome && set("published", v)}
            error={errors.published}
          />
          <Toggle label="Dans le menu" help="En fin de menu ; change l'ordre depuis la liste des pages." checked={state.inMenu} onChange={(v) => set("inMenu", v)} />
        </div>
      </section>

      <section className="a-panel" aria-labelledby="pe-seo">
        <h2 id="pe-seo">Référencement</h2>
        <div className="a-form-grid">
          <TextI18n label="Titre pour les moteurs de recherche" help="Vide : le titre de la page." value={state.meta.title} onChange={(v) => set("meta", { ...state.meta, title: v })} error={errorAt(errors, "meta.title")} />
          <TextareaI18n
            label="Description"
            help="Une ou deux phrases affichées sous le lien dans les résultats de recherche."
            value={state.meta.description}
            onChange={(v) => set("meta", { ...state.meta, description: v })}
            error={errorAt(errors, "meta.description")}
          />
        </div>
      </section>

      <section className="a-panel" aria-labelledby="pe-accent">
        <h2 id="pe-accent">Accent de la page</h2>
        <Toggle
          label="Couleur d'accent propre à cette page"
          help="Remplace la couleur d'action du thème (liens, boutons) sur cette page seulement."
          checked={state.accent !== null}
          onChange={(on) => set("accent", on && colors ? colors.primary : null)}
        />
        {savedAccentIgnored && (
          <p className="a-notice" role="status">
            Cette couleur n&apos;est plus lisible avec le thème en ligne : elle est ignorée.
          </p>
        )}
        {state.accent !== null && (
          <Field label="Accent" error={accentIssue ?? errors.accent} htmlFor="pe-accent-hex">
            <div className="a-color-row">
              <input type="color" aria-label="Accent : sélecteur" value={state.accent} onChange={(e) => set("accent", e.target.value)} />
              <input
                id="pe-accent-hex"
                className="a-input mono a-color-hex"
                value={state.accent}
                onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim()) && set("accent", e.target.value.trim())}
              />
              {!accentIssue && <span className="a-ratio a-ratio-ok">✓ AA</span>}
            </div>
            {accentFix && (
              <button type="button" className="a-btn a-btn-small a-fix" onClick={() => set("accent", accentFix)}>
                Ajuster à la teinte la plus proche qui passe
                <span className="a-chip" style={{ background: accentFix }} aria-hidden="true" />
                <span className="mono">{accentFix}</span>
              </button>
            )}
          </Field>
        )}
      </section>

      <section className="a-panel" aria-labelledby="pe-contenu">
        <h2 id="pe-contenu">Contenu</h2>
        <p className="a-help a-panel-intro">
          {state.blocks.length === 0 ? "Cette page est vide." : `${state.blocks.length} bloc${state.blocks.length > 1 ? "s" : ""} composent cette page.`} Le contenu se compose dans l&apos;éditeur visuel : tu y
          ajoutes, déplaces et supprimes les blocs, et tu règles chacun directement sur la page.
        </p>
        {blockProblems.length > 0 && (
          <div className="a-alert" role="alert">
            <p>Un bloc empêche l&apos;enregistrement : corrige-le dans l&apos;éditeur.</p>
            <ul className="a-refs">
              {blockProblems.map(([k, m]) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <Link className="a-btn a-btn-primary" href={`/admin/pages/${page.id}/editer`} data-testid="lien-editeur">
          Modifier le contenu dans l&apos;éditeur
        </Link>
      </section>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        error={error}
        note={
          dirty
            ? "L'aperçu montre la version enregistrée : enregistre d'abord."
            : saved.published
              ? "Page publiée : enregistrer la met à jour aussitôt sur le site (brouillon de l'éditeur visuel compris)."
              : "Page non publiée : visible seulement en aperçu."
        }
      />

    </div>
  );
}
