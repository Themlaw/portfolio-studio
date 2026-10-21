"use client";

/**
 * Formulaire d'une page : informations (titre, adresses, publication, menu, collection, couleur des boutons et liens de
 * la page) et référencement. Le CONTENU (rubriques) se compose dans l'éditeur visuel, qui propose tout ce que ce formulaire
 * offrait (ajouter, déplacer, supprimer, régler chaque composant) : ici, un lien. Les rubriques sont renvoyées telles que chargées, pour
 * que l'enregistrement ne les change pas. « Enregistrer » ne touche QU'AUX infos (lot 51) : le brouillon de contenu de
 * l'éditeur visuel n'est jamais publié ici ; la mise en ligne se fait avec « Publier » dans l'éditeur (ou « En ligne » ci-dessous).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import PageButtonsColorField from "@/app/admin/_fields/PageButtonsColorField";
import { errorAt, Field, MediaPicker, PageCollectionField, TextareaI18n, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { savePageInfoAction } from "@/app/admin/(espace)/pages/actions";
import type { EditorContext } from "@/blocks/editor-types";
import type { AdminPageEdit } from "@/lib/admin";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";

type Colors = { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string };
type EditBlock = { uid: string; type: string; props: Record<string, unknown> };
type State = Omit<AdminPageEdit, "blocks" | "id" | "isHome"> & { blocks: EditBlock[] };

function toState(page: AdminPageEdit): State {
  const { title, slug, meta, published, inMenu, accent, wallpaper, collection, blocks } = page;
  return {
    ...clone({ title, slug, meta, published, inMenu, accent, wallpaper, collection }),
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
  context: Pick<EditorContext, "pages" | "media">;
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
  /** Page en ligne dont l'adresse change : l'ancienne adresse redirige vers la nouvelle (par défaut oui, PAGES-06). */
  const [keepOld, setKeepOld] = useState(true);
  const slugMoved = !page.isHome && saved.published && (state.slug.fr !== saved.slug.fr || state.slug.en !== saved.slug.en);
  const dirty = !same(payload(state), payload(saved));
  // Erreurs de rubrique renvoyées par la validation du serveur (une rubrique publiée devenue invalide, par exemple).
  const blockProblems = Object.entries(errors).filter(([k]) => k === "blocks" || k.startsWith("blocks."));
  useUnsavedGuard(dirty);

  const set = <K extends keyof State>(k: K, v: State[K]) => setState((s) => ({ ...s, [k]: v }));

  const save = () => {
    start(async () => {
      const result = await savePageInfoAction(page.id, payload(state), rev, keepOld);
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
      const moved = saved.published && (state.slug.fr !== saved.slug.fr || state.slug.en !== saved.slug.en);
      toast(moved ? (result.data.redirected > 0 ? "Enregistré · l'ancienne adresse renvoie vers la nouvelle" : "Enregistré · les anciens liens vers cette page ne marcheront plus") : state.published ? "Informations enregistrées · page en ligne" : "Informations enregistrées · page pas encore en ligne");
      setKeepOld(true);
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
          {slugMoved && (
            <Toggle
              label="Garder l'ancienne adresse"
              help={`Les liens déjà partagés (${[saved.slug.fr !== state.slug.fr ? `/fr/${saved.slug.fr}` : "", saved.slug.en !== state.slug.en ? `/en/${saved.slug.en}` : ""].filter(Boolean).join(" et ")}) renvoient vers la nouvelle adresse. Décoché, ils afficheront « introuvable ».`}
              checked={keepOld}
              onChange={setKeepOld}
            />
          )}
          <Toggle
            label="En ligne"
            help={page.isHome ? "L'accueil reste toujours en ligne." : state.published ? "Visible par tous. Décoche pour retirer la page du site." : "Pas encore en ligne : la page répond « introuvable » à tes visiteurs."}
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
          <MediaPicker
            label="Image de partage de la page"
            help="Affichée quand on partage le lien de cette page. Vide : la première image de la page, sinon l'image de ton site (Réglages)."
            value={state.meta.image ?? undefined}
            onChange={(v) => set("meta", { ...state.meta, image: v ?? null })}
            error={errorAt(errors, "meta.image")}
            context={context as EditorContext}
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
              ? "Page en ligne. « Enregistrer » ne change que ces informations : le contenu se publie avec « Publier » dans l'éditeur."
              : "Page pas encore en ligne : visible seulement en aperçu. Elle se met en ligne avec « Publier » dans l'éditeur."
        }
      />

    </div>
  );
}
