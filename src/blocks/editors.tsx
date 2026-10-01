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
  ListField,
  MediaPicker,
  PagePicker,
  ProjectPicker,
  Select,
  TextareaI18n,
  TextI18n,
  Toggle,
} from "@/app/admin/_fields";

import { useBlockEditor } from "./editor-context";
import type { L } from "./editor-types";

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
      <TextI18n label="Étiquette" help="Petit texte au-dessus de ton nom." value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextareaI18n
        label="Phrase d'accroche"
        help="Utilisée par les thèmes à hero typographique. Entoure le mot à mettre en valeur de <mark>…</mark>."
        value={l(value.statement)}
        onChange={(v) => set("statement", v)}
        error={errorAt(errors, "statement")}
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
  return (
    <>
      <TextI18n label="Étiquette" value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label="Titre de la section" value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <ListField<Item>
        label="Tuiles"
        help="Chaque tuile montre une image de la collection et mène à sa page."
        items={items}
        onChange={(next) => set("items", next)}
        make={() => ({ collection: "characters", eyebrow: EMPTY, title: EMPTY, intro: EMPTY })}
        addLabel="Ajouter une tuile"
        itemLabel={(i) => `Tuile ${i + 1}`}
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
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
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
