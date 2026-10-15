"use client";

/**
 * Formulaire d'une page : informations (titre, adresses, publication, menu, collection, couleur des boutons et liens de
 * la page) et référencement. Le CONTENU (rubriques) se compose dans l'éditeur visuel, qui propose tout ce que ce formulaire
 * offrait (ajouter, déplacer, supprimer, régler chaque composant) : ici, un lien. Les rubriques sont renvoyées telles que chargées, pour
 * que l'enregistrement ne les change pas. Enregistrer publie aussitôt si la page est publiée ; s'il existe un
 * brouillon de l'éditeur visuel, le formulaire le reprend et l'enregistrement le publie (un seul état).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import PageButtonsColorField from "@/app/admin/_fields/PageButtonsColorField";
import { errorAt, Field, PageCollectionField, TextareaI18n, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { savePageAction } from "@/app/admin/(espace)/pages/actions";
import type { EditorContext } from "@/blocks/editor-types";
import type { AdminPageEdit } from "@/lib/admin";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";

type Colors = { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string };
type EditBlock = { uid: string; type: string; props: Record<string, unknown> };
type State = Omit<AdminPageEdit, "blocks" | "id" | "isHome"> & { blocks: EditBlock[] };

function toState(page: AdminPageEdit): State {
  const { title, slug, meta, published, inMenu, accent, collection, blocks } = page;
  return {
    ...clone({ title, slug, meta, published, inMenu, accent, collection }),
    blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: clone(b.props) })),
  };
}

/** Charge envoyée au serveur : les rubriques telles que chargées (jamais modifiés ici). */
const payload = (s: State) => ({ ...s, blocks: s.blocks.map(({ type, props }) => ({ type, props })) });

export default function PageEditor({
  page,
  context,
  colors,
  rev: initialRev,
}: {
  page: AdminPageEdit;
  /** Pages du site (choix de la collection que la page présente). */
  context: Pick<EditorContext, "pages">;
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
  // Erreurs de rubrique renvoyées par la validation du serveur (une rubrique publiée devenue invalide, par exemple).
  const blockProblems = Object.entries(errors).filter(([k]) => k === "blocks" || k.startsWith("blocks."));
  useUnsavedGuard(dirty);

  const set = <K extends keyof State>(k: K, v: State[K]) => setState((s) => ({ ...s, [k]: v }));

  const save = () => {
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
          <PageCollectionField value={state.collection} onChange={(v) => set("collection", v)} pages={context.pages} pageId={page.id} error={errors.collection} />
          <PageButtonsColorField value={state.accent} onChange={(v) => set("accent", v)} colors={colors} error={errors.accent} />
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

      <section className="a-panel" aria-labelledby="pe-contenu">
        <h2 id="pe-contenu">Contenu</h2>
        <p className="a-help a-panel-intro">
          {state.blocks.length === 0 ? "Cette page est vide." : `${state.blocks.length} rubrique${state.blocks.length > 1 ? "s" : ""} composent cette page.`} Le contenu se compose dans l&apos;éditeur visuel : tu y
          ajoutes, déplaces et supprimes les rubriques, et tu règles chacun directement sur la page.
        </p>
        {blockProblems.length > 0 && (
          <div className="a-alert" role="alert">
            <p>Une rubrique empêche l&apos;enregistrement : corrige-la dans l&apos;éditeur.</p>
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
