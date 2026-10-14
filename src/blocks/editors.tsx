"use client";

/**
 * Éditeurs des blocs (admin). Chacun est déclaré par son type dans
 * src/blocks/registry.ts. Ils lisent le bloc édité par useBlockEditor()
 * (contexte fourni par l'éditeur de page) : le serveur peut ainsi leur
 * passer l'élément sans props. Le serveur valide avec le schéma du bloc et
 * renvoie les erreurs par champ.
 */
import {
  CollectionPicker,
  errorAt,
  Field,
  ListField,
  MediaPicker,
  PagePicker,
  ProjectPicker,
  Select,
  TextareaI18n,
  TextField,
  TextI18n,
  Toggle,
} from "@/app/admin/_fields";

import Link from "next/link";

import GridLayoutIcon, { LAYOUT_LABELS } from "@/components/edit/GridLayoutIcon";
import ProjectCombobox from "@/components/edit/ProjectCombobox";
import { FIELD_LABELS, FIELD_TYPES, makeField, MAX_FIELDS, type FieldType, type FormField } from "@/lib/contact-form";

import { autoEntries, COLLECTION_KEYS, editsFromItems, itemsFromEntries, sameL, TILE_SIZE_LABELS, TILE_SIZES, tilesMode, tileSize, type CollectionPage, type TextField as TileTextField, type TileEdit, type TileItem } from "./collection-pages";
import { useBlockEditor } from "./editor-context";
import type { L } from "./editor-types";
import { GRID_LAYOUTS } from "./grid-layouts";

const EMPTY: L = { fr: "", en: "" };
type P = Record<string, unknown>;
const l = (v: unknown): L => (v as L) ?? EMPTY;

function useSet<T extends P>(value: T, onChange: (v: T) => void) {
  return <K extends string>(key: K, v: unknown) => onChange({ ...value, [key]: v } as T);
}

export function HeroEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <p className="a-help">Ton nom et ton métier sont communs à tout le site (en-tête, profil…) : double-clic dessus sur la page pour les modifier.</p>
      {context.heroBackdrop !== false && (
        <MediaPicker
          label="Image de fond (facultative)"
          help="Remplace le décor du thème (ouvertures « calques » et « projecteur »). Sur la page : survole l'ouverture, « Changer le fond » ; « Cadrer » choisit la zone gardée. Vide : le fond du thème."
          value={value.backgroundMediaId as number | undefined}
          onChange={(v) => set("backgroundMediaId", v)}
          error={errorAt(errors, "backgroundMediaId")}
          context={context}
        />
      )}
      <TextI18n label="Étiquette" help="Petit texte au-dessus de ton nom." value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextareaI18n
        label="Phrase d'accroche"
        help="Utilisée par les thèmes à hero typographique. Entoure le mot à mettre en valeur de <mark>…</mark> (aucun autre balisage). Sur la page : double-clic sur la phrase, sélectionne un mot et « Surligner »."
        value={l(value.statement)}
        onChange={(v) => set("statement", v)}
        error={errorAt(errors, "statement")}
      />
      <TextI18n
        label="Indicateur de défilement"
        help="Texte sous le titre. Vide : le texte par défaut du site (« Faire défiler »). Modifiable aussi sur la page, avec sa typographie."
        value={l(value.scroll)}
        onChange={(v) => set("scroll", v)}
        error={errorAt(errors, "scroll")}
      />
      <Toggle label="Afficher l'indicateur de défilement" checked={value.showScroll !== false} onChange={(v) => set("showScroll", v)} />
      <TextI18n
        label="Bouton demoreel"
        help="Libellé du bouton (thèmes à hero projecteur). Vide : « Demoreel »."
        value={l(value.reel)}
        onChange={(v) => set("reel", v)}
        error={errorAt(errors, "reel")}
      />
      <PagePicker
        label="Page de la demoreel"
        help="Où mène le bouton « Demoreel » (thèmes à hero projecteur)."
        value={value.reelPageId as number | undefined}
        onChange={(v) => set("reelPageId", v)}
        error={errorAt(errors, "reelPageId")}
        context={context}
        optional="— aucune —"
      />
    </>
  );
}

export function CollectionTilesEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  type Item = { collection: string; pageId?: number; eyebrow: L; title: L; intro: L };
  const items = (value.items as Item[]) ?? [];
  const found = context.collectionPages ?? [];
  const edits = (value.edits as TileEdit[] | undefined) ?? [];
  const mode = tilesMode(value);
  const entries = autoEntries(found, edits);
  const switchMode = (next: "auto" | "manual") => {
    if (next === mode) return;
    if (next === "manual") {
      // La liste de départ est ce que montre le mode automatique (textes compris) : rien ne change à l'écran.
      const { edits: _e, ...rest } = value;
      void _e;
      onChange({ ...rest, mode: "manual", items: itemsFromEntries(entries) });
    } else {
      // Les textes de la liste qui diffèrent de l'en-tête de leur page deviennent des modifications de tuile.
      const { items: _i, ...rest } = value;
      void _i;
      const kept = editsFromItems(items.filter((i): i is TileItem => i.pageId !== undefined && (COLLECTION_KEYS as readonly string[]).includes(i.collection)), found);
      onChange({ ...rest, mode: "auto", ...(kept.length ? { edits: kept } : {}) });
    }
  };
  /** Un texte de tuile : égal à l'en-tête de la page = pas de modification ; sinon gardé, attaché à la page. */
  const setEdit = (page: CollectionPage, field: TileTextField, v: L) => {
    const current = edits.find((e) => e.pageId === page.pageId) ?? { pageId: page.pageId };
    const { [field]: _drop, ...others } = current;
    void _drop;
    const next: TileEdit = sameL(v, page[field]) ? (others as TileEdit) : { ...others, [field]: v };
    const rest = edits.filter((e) => e.pageId !== page.pageId);
    const list = Object.keys(next).length > 1 ? [...rest, next] : rest;
    onChange({ ...value, edits: list.length ? list : undefined });
  };
  return (
    <>
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre de la section" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <Select
        label="Taille des images"
        help="Une entrée ne dépasse jamais la hauteur de l'écran : un portrait est réduit, pas coupé."
        value={tileSize(value.size)}
        options={TILE_SIZES.map((s) => ({ value: s, label: TILE_SIZE_LABELS[s] }))}
        onChange={(v) => set("size", v ?? "medium")}
        error={errorAt(errors, "size")}
      />
      <Select
        label="Format des images"
        help="Imposé : les images sont cadrées (sur la page, survole une image puis « Cadrer » pour choisir la zone gardée)."
        value={(value.ratio as string) ?? "auto"}
        options={[
          { value: "auto", label: "Celui de l'image" },
          { value: "16:9", label: "Paysage 16:9" },
          { value: "3:2", label: "Paysage 3:2" },
          { value: "4:3", label: "Paysage 4:3" },
          { value: "1:1", label: "Carré" },
          { value: "4:5", label: "Portrait 4:5" },
        ]}
        onChange={(v) => set("ratio", v === "auto" ? undefined : v)}
      />
      <Select
        label="Entrées"
        help={
          mode === "auto"
            ? "Une entrée par page de collection (page avec un « En-tête de collection »), dans l'ordre du menu : ajouter, retirer ou dépublier une page change la liste toute seule."
            : "Tu choisis les entrées, leur ordre et leur page de destination."
        }
        value={mode}
        options={[
          { value: "auto", label: "Automatiques" },
          { value: "manual", label: "Choisies à la main" },
        ]}
        onChange={(v) => switchMode(v === "manual" ? "manual" : "auto")}
      />
      {mode === "auto" ? (
        <div className="a-field" data-testid="tiles-auto">
          {entries.length === 0 && <p className="a-help">Aucune page de collection publiée pour l&apos;instant.</p>}
          {entries.map((e) => (
            <fieldset key={e.pageId} className="a-card" data-tile-page={e.pageId}>
              <legend>{e.title.fr || `Page ${e.pageId}`}</legend>
              <p className="a-help">Textes de l&apos;en-tête de la page{Object.keys(e.edited).length ? ", sauf ceux que tu as modifiés ici." : "."}</p>
              <TextI18n label="Étiquette" value={e.eyebrow} onChange={(v) => setEdit(e, "eyebrow", v)} />
              <TextI18n label="Titre" value={e.title} onChange={(v) => setEdit(e, "title", v)} />
              <TextareaI18n label="Présentation" value={e.intro} onChange={(v) => setEdit(e, "intro", v)} />
              {Object.keys(e.edited).length > 0 && (
                <button type="button" className="a-btn" onClick={() => onChange({ ...value, edits: edits.filter((x) => x.pageId !== e.pageId).length ? edits.filter((x) => x.pageId !== e.pageId) : undefined })}>
                  Reprendre les textes de la page
                </button>
              )}
            </fieldset>
          ))}
        </div>
      ) : (
        <ListField<Item>
          label="Liste des entrées"
          help="Chaque entrée montre une grande image de la collection et mène à sa page. Une entrée dont la page est supprimée ou non publiée est masquée sur le site."
          items={items}
          onChange={(next) => set("items", next)}
          make={() => ({ collection: "characters", eyebrow: EMPTY, title: EMPTY, intro: EMPTY })}
          addLabel="Ajouter une entrée"
          itemLabel={(i) => `Entrée ${i + 1}`}
          error={errorAt(errors, "items")}
          render={(item, update, i) => (
            <>
              <CollectionPicker value={item.collection} onChange={(v) => update({ ...item, collection: v })} error={errorAt(errors, `items.${i}.collection`)} />
              <PagePicker label="Page de destination" value={item.pageId} onChange={(v) => update({ ...item, pageId: v })} error={errorAt(errors, `items.${i}.pageId`)} context={context} />
              <TextI18n label="Étiquette" value={item.eyebrow} onChange={(v) => update({ ...item, eyebrow: v })} error={errorAt(errors, `items.${i}.eyebrow`)} />
              <TextI18n label="Titre" value={item.title} onChange={(v) => update({ ...item, title: v })} error={errorAt(errors, `items.${i}.title`)} />
              <TextareaI18n label="Présentation" value={item.intro} onChange={(v) => update({ ...item, intro: v })} error={errorAt(errors, `items.${i}.intro`)} />
            </>
          )}
        />
      )}
    </>
  );
}

export function FeaturedProjectsEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const more = value.more as { label: L; pageId?: number } | undefined;
  return (
    <>
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <TextareaI18n label="Présentation" value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
      <ProjectPicker
        label="Projets affichés"
        help="Coche les projets dans l'ordre voulu. Si tu n'en coches aucun, tes projets « mis en avant » s'affichent."
        value={value.projects as string[] | undefined}
        onChange={(v) => set("projects", v.length ? v : undefined)}
        error={errorAt(errors, "projects")}
        context={context}
      />
      {!(value.projects as string[] | undefined)?.length && (
        <Select
          label="Nombre de projets mis en avant"
          value={(value.limit as number) ?? 2}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set("limit", v ?? 2)}
          error={errorAt(errors, "limit")}
        />
      )}
      <Toggle
        label="Lien « voir plus » sous les projets"
        checked={Boolean(more)}
        onChange={(on) => set("more", on ? { label: EMPTY } : undefined)}
      />
      {more && (
        <>
          <TextI18n label="Texte du lien" value={more.label} onChange={(v) => set("more", { ...more, label: v })} error={errorAt(errors, "more.label")} />
          <PagePicker label="Page de destination" value={more.pageId} onChange={(v) => set("more", { ...more, pageId: v })} error={errorAt(errors, "more.pageId")} context={context} />
        </>
      )}
    </>
  );
}

export function CollectionIntroEditor() {
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <CollectionPicker value={value.collection as string} onChange={(v) => set("collection", v)} error={errorAt(errors, "collection")} />
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <TextareaI18n label="Présentation" value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
      <Toggle
        label="Afficher les compteurs (œuvres · projets)"
        checked={(value.showCounts as boolean) ?? true}
        onChange={(v) => set("showCounts", v)}
      />
    </>
  );
}

export function CollectionProjectsEditor() {
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <CollectionPicker
      value={value.collection as string}
      onChange={(v) => set("collection", v)}
      error={errorAt(errors, "collection")}
      exclude={["animation"]}
      help="Affiche les planches de tous les projets qui ont des images dans cette collection."
    />
  );
}

export function VideoEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker
        label="Demoreel hébergée (facultatif)"
        help="Une vidéo de ta médiathèque ; sans elle, la demoreel YouTube de la collection Animation s'affiche. Le titre affiché est son texte alternatif."
        value={value.reelMediaId as number | undefined}
        onChange={(v) => set("reelMediaId", v)}
        error={errorAt(errors, "reelMediaId")}
        context={context}
        kind="video"
      />
      <TextI18n label="Étiquette de la demoreel" value={l(value.reelEyebrow)} onChange={(v) => set("reelEyebrow", v)} error={errorAt(errors, "reelEyebrow")} />
      <TextI18n label="Étiquette des extraits" value={l(value.cardsEyebrow)} onChange={(v) => set("cardsEyebrow", v)} error={errorAt(errors, "cardsEyebrow")} />
      <TextI18n label="Titre des extraits" value={l(value.cardsTitle)} onChange={(v) => set("cardsTitle", v)} error={errorAt(errors, "cardsTitle")} />
    </>
  );
}

function Paragraphs({ value, onChange, errors, path = "paragraphs", first }: { value: L[]; onChange: (v: L[]) => void; errors: Record<string, string>; path?: string; first?: string }) {
  return (
    <ListField<L>
      label="Paragraphes"
      help={first}
      items={value}
      onChange={onChange}
      make={() => EMPTY}
      min={1}
      addLabel="Ajouter un paragraphe"
      itemLabel={(i) => `Paragraphe ${i + 1}`}
      error={errorAt(errors, path)}
      render={(p, update, i) => <TextareaI18n label="Texte" value={p} onChange={update} error={errorAt(errors, `${path}.${i}`)} rows={4} />}
    />
  );
}

export function RichTextEditor() {
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n label="Étiquette (facultative)" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre (facultatif)" value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <Paragraphs value={(value.paragraphs as L[]) ?? [EMPTY]} onChange={(v) => set("paragraphs", v)} errors={errors} />
    </>
  );
}

export function ContactEditor() {
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <TextareaI18n label="Présentation" value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
      <TextI18n label="Texte du bouton" help="Le bouton ouvre un e-mail vers l'adresse des réglages." value={l(value.cta)} onChange={(v) => set("cta", v)} error={errorAt(errors, "cta")} />
    </>
  );
}

export function ProfileEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker label="Portrait" value={value.portraitMediaId as number | undefined} onChange={(v) => set("portraitMediaId", v)} error={errorAt(errors, "portraitMediaId")} context={context} />
      <Select
        label="Format du portrait"
        help="Imposé : le portrait est cadré (sur la page, « Cadrer »)."
        value={(value.portraitRatio as string) ?? "auto"}
        options={[
          { value: "auto", label: "Celui de l'image" },
          { value: "4:5", label: "Portrait 4:5" },
          { value: "3:4", label: "Portrait 3:4" },
          { value: "1:1", label: "Carré" },
        ]}
        onChange={(v) => set("portraitRatio", v === "auto" ? undefined : v)}
      />
      <TextI18n label="Légende du portrait" value={l(value.portraitCaption)} onChange={(v) => set("portraitCaption", v)} error={errorAt(errors, "portraitCaption")} />
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <Paragraphs
        value={(value.paragraphs as L[]) ?? [EMPTY]}
        onChange={(v) => set("paragraphs", v)}
        errors={errors}
        first="Le premier paragraphe est mis en avant."
      />
      <TextI18n label="Étiquette du contact" value={l(value.contactEyebrow)} onChange={(v) => set("contactEyebrow", v)} error={errorAt(errors, "contactEyebrow")} />
      <TextI18n label="Texte du bouton de contact" value={l(value.contactLabel)} onChange={(v) => set("contactLabel", v)} error={errorAt(errors, "contactLabel")} />
      <TextI18n label="Étiquette des réseaux" value={l(value.socialEyebrow)} onChange={(v) => set("socialEyebrow", v)} error={errorAt(errors, "socialEyebrow")} />
    </>
  );
}

export function ProjectBoardEditor() {
  const { value, onChange, errors, context, idPrefix } = useBlockEditor();
  const set = useSet(value, onChange);
  const current = context.projects.find((p) => p.slug === value.project);
  const id = `${idPrefix}-projet`;
  return (
    <>
    <Field
      label="Projet"
      htmlFor={id}
      error={errorAt(errors, "project")}
      help={
        current?.draft
          ? "Projet créé sur cette page : son nom, son contexte et son année se modifient directement sur la planche (double-clic). Il devient public avec la page."
          : "Les images se placent, se déplacent et se retirent directement sur la planche. Le nom et les textes du projet se modifient dans l'écran Projets."
      }
    >
      <select id={id} className="a-input" value={(value.project as string | undefined) ?? ""} onChange={(e) => set("project", e.target.value || undefined)}>
        <option value="">— Projet du conteneur (ou à choisir) —</option>
        {context.projects.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
            {p.draft ? " (créé sur cette page)" : p.onPage === false ? " (pas encore sur une page)" : ""}
          </option>
        ))}
      </select>
    </Field>
    <Toggle label="Nom et présentation du projet en tête de planche" checked={value.header !== false} onChange={(on) => set("header", on ? undefined : false)} />
    <Toggle label="Fond plus soutenu (pour alterner deux planches)" checked={Boolean(value.deep)} onChange={(on) => set("deep", on || undefined)} />
    {typeof value.collection === "string" && <p className="a-help">Planche limitée aux œuvres d&apos;un métier (reprise d&apos;une ancienne page de collection).</p>}
    </>
  );
}

/* ---- Conteneurs et composants (v0.13) ------------------------------------ */

export function FeaturedProjectEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const more = value.more as { label: L; pageId?: number } | undefined;
  const count = Array.isArray(value.children) ? value.children.length : 0;
  return (
    <>
      <ProjectCombobox
        prefix="ve"
        label="Projet affiché dans ce bloc"
        projects={context.projects}
        value={value.project as string | undefined}
        onPick={(slug) => set("project", slug)}
        onCreate={
          context.createProject
            ? async (name) => {
                const slug = await context.createProject!(name);
                if (slug) set("project", slug);
              }
            : undefined
        }
      />
      {errorAt(errors, "project") && <p className="a-field-error">{errorAt(errors, "project")}</p>}
      <p className="a-help">
        Le titre, la présentation et les images viennent du projet : les modifier ici (sur la page) les change aussi sur sa planche et ailleurs, après
        publication. {count} composant{count > 1 ? "s" : ""} dedans : glisse-en un de « Ajouter » DANS le cadre ; une planche ou un titre sans projet propre
        prend celui-ci.
      </p>
      <Toggle label="Lien « voir plus » sous le projet" checked={Boolean(more)} onChange={(on) => set("more", on ? { label: EMPTY } : undefined)} />
      {more && (
        <>
          <TextI18n label="Texte du lien" value={more.label} onChange={(v) => set("more", { ...more, label: v })} error={errorAt(errors, "more.label")} />
          <PagePicker label="Page de destination" value={more.pageId} onChange={(v) => set("more", { ...more, pageId: v })} error={errorAt(errors, "more.pageId")} context={context} />
        </>
      )}
    </>
  );
}

/** Choix d'agencement par pictogrammes (aussi sur la toile, barre du conteneur). */
export function LayoutPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="a-field">
      <span className="a-label" id="ve-layout-label">
        Agencement
      </span>
      <div className="ve-layouts" role="radiogroup" aria-labelledby="ve-layout-label">
        {GRID_LAYOUTS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={value === l} title={LAYOUT_LABELS[l]} aria-label={LAYOUT_LABELS[l]} className="ve-layout" onClick={() => onChange(l)}>
            <GridLayoutIcon layout={l} />
          </button>
        ))}
      </div>
      <p className="a-help">Les composants remplissent les cellules dans l&apos;ordre ; au-delà, le motif se répète. Changer d&apos;agencement ne retire rien.</p>
    </div>
  );
}

export function GridEditor() {
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <LayoutPicker value={(value.layout as string) ?? "2"} onChange={(v) => set("layout", v)} />
      <Select
        label="Espacement"
        value={(value.gap as string) ?? "normal"}
        options={[
          { value: "tight", label: "Serré" },
          { value: "normal", label: "Normal" },
          { value: "wide", label: "Large (espacement de section du thème)" },
        ]}
        onChange={(v) => set("gap", v ?? "normal")}
      />
      <Select
        label="Alignement vertical"
        value={(value.align as string) ?? "stretch"}
        options={[
          { value: "stretch", label: "Étirer" },
          { value: "start", label: "En haut" },
          { value: "center", label: "Au centre" },
          { value: "end", label: "En bas" },
        ]}
        onChange={(v) => set("align", v ?? "stretch")}
      />
      <Select
        label="Format des images"
        help="Les vidéos gardent leur cadre 16:9."
        value={(value.ratio as string) ?? "auto"}
        options={[
          { value: "auto", label: "Libre (format d'origine)" },
          { value: "16:9", label: "16:9" },
          { value: "1:1", label: "Carré" },
          { value: "4:5", label: "Portrait 4:5" },
        ]}
        onChange={(v) => set("ratio", v ?? "auto")}
      />
      <Toggle label="Espace au-dessus (comme entre deux sections)" checked={(value.top ?? "gap") === "gap"} onChange={(on) => set("top", on ? "gap" : "none")} />
      <TextI18n label="Étiquette (facultative)" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre (facultatif)" value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
    </>
  );
}

export function ImageEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker label="Image" value={value.mediaId as number | undefined} onChange={(v) => set("mediaId", v)} error={errorAt(errors, "mediaId")} context={context} />
      <TextI18n label="Légende (facultative)" value={l(value.caption)} onChange={(v) => set("caption", v.fr || v.en ? v : undefined)} error={errorAt(errors, "caption")} />
      <Select
        label="Largeur"
        help="Dans une grille, l'image occupe sa cellule."
        value={(value.width as string) ?? "wide"}
        options={[
          { value: "text", label: "Colonne de texte" },
          { value: "wide", label: "Cadre du site" },
          { value: "full", label: "Pleine largeur" },
        ]}
        onChange={(v) => set("width", v ?? "wide")}
      />
      <Select
        label="Format"
        help="Imposé : l'image est cadrée (sur la page, survole-la puis « Cadrer » pour choisir la zone gardée)."
        value={(value.ratio as string) ?? "auto"}
        options={[
          { value: "auto", label: "Celui de l'image" },
          { value: "16:9", label: "Paysage 16:9" },
          { value: "4:3", label: "Paysage 4:3" },
          { value: "1:1", label: "Carré" },
          { value: "4:5", label: "Portrait 4:5" },
          { value: "3:4", label: "Portrait 3:4" },
        ]}
        onChange={(v) => set("ratio", v === "auto" ? undefined : v)}
      />
      <Select
        label="Dans le cadre"
        help="Sans format imposé, l'image garde le sien. Avec un format : « Image entière » la montre en entier (bandes vides si besoin), « Remplir le cadre » la rogne. Un recadrage libre (« Cadrer » sur la page) suit son propre format."
        value={(value.fit as string) ?? "auto"}
        options={[
          { value: "auto", label: "Automatique (entière en pleine largeur)" },
          { value: "contain", label: "Image entière" },
          { value: "cover", label: "Remplir le cadre" },
        ]}
        onChange={(v) => set("fit", v === "auto" ? undefined : v)}
      />
    </>
  );
}

export function CvEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker
        label="CV (PDF)"
        kind="pdf"
        help="Un PDF de 10 pages au plus (15 Mo) : ses pages s'affichent en images, et le bouton télécharge le PDF d'origine."
        value={value.mediaId as number | undefined}
        onChange={(v) => set("mediaId", v)}
        error={errorAt(errors, "mediaId")}
        context={context}
      />
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre" value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <TextareaI18n label="Présentation (facultative)" value={l(value.intro)} onChange={(v) => set("intro", v.fr || v.en ? v : undefined)} error={errorAt(errors, "intro")} />
      <TextI18n label="Texte du bouton" help="Vide : « Télécharger mon CV »." value={l(value.button)} onChange={(v) => set("button", v.fr || v.en ? v : undefined)} error={errorAt(errors, "button")} />
      <TextField
        label="Nom du fichier téléchargé"
        help="Sans extension : lettres minuscules, chiffres et tirets (ex. cv-camille-martin)."
        value={(value.fileName as string) ?? ""}
        onChange={(v) => {
          const clean = v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
          set("fileName", clean || undefined);
        }}
        error={errorAt(errors, "fileName")}
      />
    </>
  );
}

export function SectionTitleEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const linked = Boolean(value.linked);
  return (
    <>
      <Toggle
        label="Reprendre le nom et la présentation d'un projet"
        help="Le titre et la présentation sont ceux du projet : tu les modifies sur la page ; ils changent aussi sur sa planche et sa page, après publication."
        checked={linked}
        onChange={(on) => set("linked", on || undefined)}
      />
      {linked && (
        <>
          <ProjectCombobox
            prefix="ve"
            label="Projet repris par ce titre"
            projects={context.projects}
            value={value.project as string | undefined}
            onPick={(slug) => set("project", slug)}
            onCreate={
              context.createProject
                ? async (name) => {
                    const slug = await context.createProject!(name);
                    if (slug) set("project", slug);
                  }
                : undefined
            }
          />
          {errorAt(errors, "project") && <p className="a-field-error">{errorAt(errors, "project")}</p>}
        </>
      )}
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      {!linked && (
        <>
          <TextI18n label="Titre" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
          <TextareaI18n label="Présentation" value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
          <Toggle
            label="Titre principal de la page (h1)"
            help="Le grand titre de la page, en haut : un seul par page (l'ouverture de l'accueil en est déjà un). Un Titre inséré en haut d'une page sans titre principal l'est d'emblée ; les autres sont des titres de section (h2)."
            checked={value.main === true}
            onChange={(on) => set("main", on ? true : undefined)}
          />
          <Toggle
            label="Compteurs « N œuvres · M projets »"
            help="Calculés depuis les planches de la page, sous le titre."
            checked={value.counts === true}
            onChange={(on) => set("counts", on ? true : undefined)}
          />
        </>
      )}
    </>
  );
}

export function PageLinkEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n label="Texte du lien" value={l(value.label)} onChange={(v) => set("label", v)} error={errorAt(errors, "label")} />
      <PagePicker label="Page de destination" value={value.pageId as number | undefined} onChange={(v) => set("pageId", v)} error={errorAt(errors, "pageId")} context={context} />
    </>
  );
}

export function VideoSingleEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      {typeof value.slot === "string" && !value.mediaId && (
        <p className="a-help">Plan YouTube de la collection Animation (repris de l&apos;ancienne vitrine). Choisis une vidéo de ta médiathèque pour le remplacer.</p>
      )}
      <MediaPicker label="Vidéo" kind="video" value={value.mediaId as number | undefined} onChange={(v) => set("mediaId", v)} error={errorAt(errors, "mediaId")} context={context} />
      <Select
        label="Lecture"
        value={(value.mode as string) ?? "player"}
        options={[
          { value: "player", label: "Lecteur (avec le son, bouton lecture)" },
          { value: "loop", label: "Boucle muette (sans contrôles)" },
        ]}
        onChange={(v) => set("mode", v ?? "player")}
      />
      <Select
        label="Présentation"
        value={(value.variant as string) ?? "card"}
        options={[
          { value: "card", label: "Carte : vidéo, titre et légende dessous" },
          { value: "feature", label: "Grande : étiquette et titre au-dessus" },
          { value: "plain", label: "Vidéo seule (légende facultative)" },
        ]}
        onChange={(v) => set("variant", v ?? "card")}
      />
      <MediaPicker
        label="Image d'attente (facultative)"
        help="Affichée avant la lecture ; sinon, l'image de la vidéo."
        value={value.posterMediaId as number | undefined}
        onChange={(v) => set("posterMediaId", v)}
        error={errorAt(errors, "posterMediaId")}
        context={context}
      />
      <TextI18n label="Étiquette (présentation « Grande »)" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre" help="Vide : le texte alternatif de la vidéo." value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <TextareaI18n label="Légende" value={l(value.description)} onChange={(v) => set("description", v.fr || v.en ? v : undefined)} error={errorAt(errors, "description")} />
    </>
  );
}

/* ---- Formulaire de contact (v0.13) ---------------------------------------- */

export function ContactFormEditor() {
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const fields = (value.fields as FormField[]) ?? [];
  const setFields = (next: FormField[]) => set("fields", next);
  const update = (i: number, patch: Partial<FormField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const next = fields.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setFields(next);
  };
  return (
    <>
      <p className="ve-site-note" role="note">
        <strong>Envoi par e-mail : non configuré</strong> (aucun serveur d&apos;envoi sur ce site). Les messages arrivent dans{" "}
        <Link href="/admin/messages" target="_blank">
          Admin → Messages
        </Link>{" "}
        ; ton adresse n&apos;apparaît jamais sur la page.
      </p>
      {context.previewForm && (
        <div className="a-field" role="group" aria-label="Aperçu sur la page">
          <span className="a-label">Voir sur la page</span>
          <div className="ve-layouts">
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("form")}>
              Le formulaire
            </button>
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("success")}>
              Voir le message de confirmation
            </button>
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("error")}>
              Le message d&apos;erreur
            </button>
          </div>
        </div>
      )}
      <TextI18n label="Objet des messages reçus" value={l(value.subject)} onChange={(v) => set("subject", v)} error={errorAt(errors, "subject")} />
      <TextI18n label="Texte du bouton" value={l(value.submit)} onChange={(v) => set("submit", v)} error={errorAt(errors, "submit")} />
      <TextareaI18n label="Message de confirmation" value={l(value.success)} onChange={(v) => set("success", v)} error={errorAt(errors, "success")} />
      <TextareaI18n label="Message d'erreur" value={l(value.error)} onChange={(v) => set("error", v)} error={errorAt(errors, "error")} />
      <h3 className="ve-sub">Champs</h3>
      {errorAt(errors, "fields") && <p className="a-field-error">{errorAt(errors, "fields")}</p>}
      <ol className="ve-list">
        {fields.map((f, i) => (
          <li key={f.id} className="ve-list-row" data-field-type={f.type}>
            <span className="ve-list-main">
              <p className="a-help">
                {FIELD_LABELS[f.type]}
                {f.reply ? " · sert à te répondre" : ""}
              </p>
              <TextI18n label="Libellé" value={l(f.label)} onChange={(v) => update(i, { label: v })} error={errorAt(errors, `fields.${i}.label`)} />
              <TextI18n label="Texte d'exemple (facultatif)" value={l(f.placeholder)} onChange={(v) => update(i, { placeholder: v.fr || v.en ? v : undefined })} />
              <TextI18n label="Aide (facultative)" value={l(f.help)} onChange={(v) => update(i, { help: v.fr || v.en ? v : undefined })} />
              <Toggle label="Obligatoire" checked={f.required} onChange={(on) => update(i, { required: on })} />
              {f.type === "email" && (
                <Toggle
                  label="Sert à te répondre"
                  checked={Boolean(f.reply)}
                  onChange={(on) => setFields(fields.map((x, j) => ({ ...x, reply: j === i ? on || undefined : on ? undefined : x.reply })))}
                />
              )}
              {f.type === "select" && (
                <ListField<{ fr: string; en: string }>
                  label="Choix proposés"
                  items={f.options ?? []}
                  onChange={(next) => update(i, { options: next })}
                  make={() => ({ fr: "", en: "" })}
                  min={1}
                  addLabel="Ajouter un choix"
                  itemLabel={(k) => `Choix ${k + 1}`}
                  error={errorAt(errors, `fields.${i}.options`)}
                  render={(o, up) => <TextI18n label="Choix" value={o} onChange={up} />}
                />
              )}
            </span>
            <span className="ve-list-tools">
              <button type="button" className="a-icon-btn" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="a-icon-btn a-danger-text"
                aria-label="Retirer ce champ"
                disabled={fields.length <= 1 || Boolean(f.reply)}
                title={f.reply ? "Ce champ sert à te répondre : désactive « Sert à te répondre » d'abord." : undefined}
                onClick={() => setFields(fields.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      {fields.length < MAX_FIELDS && (
        <Select<FieldType>
          label="Ajouter un champ"
          value={undefined}
          allowEmpty="— Choisir un type —"
          options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_LABELS[t] }))}
          onChange={(t) => t && setFields([...fields, makeField(t)])}
        />
      )}
    </>
  );
}
