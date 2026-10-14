"use client";

/**
 * Éditeur de page : informations (titre, adresses, référencement, accent),
 * puis la liste des blocs (cartes repliables, réordonnables, ajout par
 * sélecteur décrivant chaque type). Chaque bloc s'édite avec le formulaire
 * déclaré par son type dans le registre. Enregistrer publie aussitôt si la
 * page est publiée ; s'il existe un brouillon de l'éditeur visuel, le
 * formulaire l'affiche et l'enregistrement le publie (un seul état).
 */
import { groupEntries } from "@/blocks/groups";
import { withFreshUids } from "@/blocks/tree";
import { own } from "@/lib/own";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { errorAt, Field, TextareaI18n, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { savePageAction } from "@/app/admin/(espace)/pages/actions";
import { BlockEditorContext } from "@/blocks/editor-context";
import type { BlockCatalogEntry, EditorContext } from "@/blocks/editor-types";
import { renderSummary } from "@/blocks/summary";
import type { AdminPageEdit } from "@/lib/admin";
import { accentProblem, nearestAccent } from "@/themes/contrast";

import { clone, ConfirmDialog, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import { DragHandle, SortableList } from "./Sortable";

type Colors = { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string };
type EditBlock = { uid: string; type: string; props: Record<string, unknown> };
type State = Omit<AdminPageEdit, "blocks" | "id" | "isHome"> & { blocks: EditBlock[] };

// Identifiants locaux des blocs (clés React, id HTML) : déterministes au
// premier rendu (même valeur côté serveur et client), puis uniques pour les
// blocs ajoutés dans le navigateur.
let addedSeq = 0;
const newUid = () => `n${++addedSeq}`;

function toState(page: AdminPageEdit): State {
  const { title, slug, meta, published, inMenu, accent, blocks } = page;
  return {
    ...clone({ title, slug, meta, published, inMenu, accent }),
    blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: clone(b.props) })),
  };
}

const payload = (s: State) => ({ ...s, blocks: s.blocks.map(({ type, props }) => ({ type, props })) });

/** Erreurs d'un bloc, relatives à ses props. */
function blockErrors(errors: Record<string, string>, index: number): Record<string, string> {
  const prefix = `blocks.${index}.props.`;
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
}

function AddBlock({ catalog, onAdd }: { catalog: BlockCatalogEntry[]; onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(groupEntries(catalog)[0]?.entries[0]?.type ?? catalog[0]?.type ?? "");
  const name = useId();
  return (
    <>
      <button type="button" className="a-btn a-add-block" onClick={() => setOpen(true)}>
        + Ajouter un bloc
      </button>
      <ConfirmDialog
        open={open}
        title="Ajouter un bloc"
        confirmLabel="Ajouter ce bloc"
        onClose={() => setOpen(false)}
        onConfirm={() => {
          onAdd(choice);
          setOpen(false);
        }}
      >
        <div className="a-block-types" role="radiogroup" aria-label="Type de bloc">
          {/* Mêmes groupes que l'éditeur visuel (src/blocks/groups.ts). */}
          {groupEntries(catalog).map((g) => (
            <div key={g.id} role="presentation">
              <p className="a-block-group">{g.label}</p>
              {g.entries.map((c) => (
                <label key={c.type} className="a-block-type">
                  <input type="radio" name={name} checked={choice === c.type} onChange={() => setChoice(c.type)} />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="muted">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="a-help">Le bloc est ajouté en fin de page ; déplace-le ensuite par sa poignée.</p>
      </ConfirmDialog>
    </>
  );
}

export default function PageEditor({
  page,
  catalog,
  editors,
  context,
  colors,
  rev: initialRev,
}: {
  page: AdminPageEdit;
  /** Version du contenu lue au chargement (contrôle optimiste, src/lib/edit/drafts.ts). */
  rev: number;
  catalog: BlockCatalogEntry[];
  /** Élément de l'éditeur de chaque type (composant client déclaré au registre). */
  editors: Record<string, React.ReactNode>;
  context: EditorContext;
  colors: Colors | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => toState(page));
  const [state, setState] = useState(saved);
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EditBlock | null>(null);
  const [saving, start] = useTransition();
  const [rev, setRev] = useState(initialRev);
  const [conflict, setConflict] = useState<string | null>(null);
  const dirty = !same(payload(state), payload(saved));
  useUnsavedGuard(dirty);

  const set = <K extends keyof State>(k: K, v: State[K]) => setState((s) => ({ ...s, [k]: v }));
  // Types seulement (ni raccourcis de la palette, ni types anciens).
  const byType = Object.fromEntries(catalog.filter((c) => !c.preset).map((c) => [c.type, c]));
  const accentIssue = state.accent && colors ? accentProblem(state.accent, colors) : null;
  const accentFix = state.accent && colors && accentIssue ? nearestAccent(state.accent, colors) : null;
  // Accent enregistré devenu illisible après un changement de thème : ignoré au rendu.
  const savedAccentIgnored = Boolean(saved.accent && colors && accentProblem(saved.accent, colors));

  const toggleOpen = (id: string) =>
    setOpenBlocks((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
        const fe = result.fieldErrors ?? {};
        setErrors(fe);
        // Ouvre les blocs fautifs.
        setOpenBlocks((s) => {
          const n = new Set(s);
          state.blocks.forEach((b, i) => Object.keys(fe).some((k) => k === `blocks.${i}` || k.startsWith(`blocks.${i}.`)) && n.add(b.uid));
          return n;
        });
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

      <section className="a-panel" aria-labelledby="pe-blocs">
        <div className="a-panel-head">
          <h2 id="pe-blocs">Blocs</h2>
          <span className="muted">{state.blocks.length} bloc{state.blocks.length > 1 ? "s" : ""}</span>
        </div>
        {state.blocks.length === 0 && <p className="muted a-section-tight">Cette page est vide : ajoute son premier bloc.</p>}
        <SortableList
          items={state.blocks}
          getId={(b) => b.uid}
          getLabel={(b) => own(byType, b.type)?.label ?? b.type}
          onReorder={(blocks) => set("blocks", blocks)}
          className="a-sortable a-blocks"
          render={(b, i) => {
            const meta = own(byType, b.type);
            const open = openBlocks.has(b.uid);
            const err = blockErrors(errors, i);
            const general = errors[`blocks.${i}`];
            const hasError = Boolean(general) || Object.keys(err).length > 0;
            const summary = meta ? renderSummary(meta.summary, b.props) : "";
            const bodyId = `bloc-${b.uid}`;
            const editor = own(editors, b.type);
            return (
              <article className="a-block" data-open={open} data-invalid={hasError || undefined} aria-label={`Bloc ${i + 1} : ${meta?.label ?? b.type}`}>
                <header className="a-block-head">
                  <DragHandle />
                  <button type="button" className="a-block-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleOpen(b.uid)}>
                    <span className="a-block-type-name">{meta?.label ?? b.type}</span>
                    {summary && <span className="a-block-summary">{summary}</span>}
                    {hasError && <span className="a-tag a-tag-danger">À corriger</span>}
                    <span className="a-chevron" aria-hidden="true" />
                  </button>
                  <button type="button" className="a-icon-btn a-danger-text" aria-label={`Supprimer le bloc ${meta?.label ?? b.type}`} onClick={() => setRemoving(b)}>
                    ✕
                  </button>
                </header>
                {open && (
                  <div className="a-block-body" id={bodyId}>
                    {general && <p className="a-field-error">{general}</p>}
                    {editor ? (
                      <BlockEditorContext.Provider
                        value={{
                          value: b.props,
                          onChange: (props) =>
                            setState((s) => ({ ...s, blocks: s.blocks.map((x) => (x.uid === b.uid ? { ...x, props } : x)) })),
                          errors: err,
                          context,
                          idPrefix: b.uid,
                        }}
                      >
                        {editor}
                      </BlockEditorContext.Provider>
                    ) : (
                      <p className="muted">Ce type de bloc n&apos;a pas de formulaire.</p>
                    )}
                  </div>
                )}
              </article>
            );
          }}
        />
        <AddBlock
          catalog={catalog.filter((c) => !c.preset && !c.hidden)}
          onAdd={(type) => {
            const def = own(byType, type);
            if (!def) return;
            // Conteneur : ses composants de départ reçoivent leurs uid.
            const block = withFreshUids({ uid: "", type, props: clone(def.defaults) }, newUid);
            setState((s) => ({ ...s, blocks: [...s.blocks, block] }));
            setOpenBlocks((s) => new Set(s).add(block.uid));
          }}
        />
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

      <ConfirmDialog
        open={removing !== null}
        title={`Supprimer le bloc « ${removing ? (own(byType, removing.type)?.label ?? removing.type) : ""} » ?`}
        confirmLabel="Supprimer le bloc"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) setState((s) => ({ ...s, blocks: s.blocks.filter((x) => x.uid !== removing.uid) }));
          setRemoving(null);
        }}
      >
        <p className="muted">Le bloc disparaît de la page quand tu enregistres. Tant que tu n&apos;as pas enregistré, recharger la page l&apos;annule.</p>
      </ConfirmDialog>
    </div>
  );
}
