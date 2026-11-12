"use client";

/**
 * Éditeurs des blocs (admin). Chacun est déclaré par son type dans
 * src/blocks/registry.ts. Ils lisent le bloc édité par useBlockEditor()
 * (contexte fourni par l'éditeur de page) : le serveur peut ainsi leur
 * passer l'élément sans props. Le serveur valide avec le schéma du bloc et
 * renvoie les erreurs par champ.
 */
import {
  COLLECTION_OPTIONS,
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

import { useTranslations } from "next-intl";
import { useState } from "react";

import Link from "next/link";

import GridLayoutIcon, { LAYOUT_LABELS } from "@/components/edit/GridLayoutIcon";
import ProjectCombobox from "@/components/edit/ProjectCombobox";
import { withContactForm, CONTACT_ACTIONS, CONTACT_ACTION_LABELS, contactActionOf, FIELD_LABELS, FIELD_TYPES, makeField, MAX_FIELDS, type FieldType, type FormField } from "@/lib/contact-form";

import { autoEntries, COLLECTION_KEYS, editsFromItems, itemsFromEntries, sameL, TILE_SIZES, tilesMode, tileSize, type CollectionPage, type TextField as TileTextField, type TileEdit, type TileItem } from "./collection-pages";
import { MediaPickerDialog } from "@/components/admin/MediaLibrary";
import { useBlockEditor } from "./editor-context";
import { applyFreeLook, applyFreeOp, cropOf, FREE_FORMATS, FREE_PHONE_MODES, freeItems, MAX_FREE_ITEMS, newFreeId, type FreeFormat, type FreeModelOp } from "./free-board";
import FormatSelect from "./FormatSelect";
import type { AdminT } from "@/i18n/admin-lang";

import type { L } from "./editor-types";
import { modeOf, videoModeOptions } from "./video-mode";
import { soundOf, videoSoundOptions } from "./video-sound";
import { applyGridOp, autoCols, isJustified, keepsShape, CUSTOM_COLS, customCols, GRID_LAYOUTS, type GridLayout, type GridModelOp, type GridShape } from "./grid-layouts";

const EMPTY: L = { fr: "", en: "" };
type P = Record<string, unknown>;
const l = (v: unknown): L => (v as L) ?? EMPTY;

function useSet<T extends P>(value: T, onChange: (v: T) => void) {
  return <K extends string>(key: K, v: unknown) => onChange({ ...value, [key]: v } as T);
}

export function HeroEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <p className="a-help">{t("yourNameAndYour")}</p>
      {context.heroBackdrop !== false && (
        <MediaPicker
          label={t("backgroundImageOptional")}
          help={t("replacesTheThemeS")}
          value={value.backgroundMediaId as number | undefined}
          onChange={(v) => set("backgroundMediaId", v)}
          error={errorAt(errors, "backgroundMediaId")}
          context={context}
        />
      )}
      <TextI18n label={t("label")} help={t("smallTextAboveYour")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextareaI18n
        label={t("tagline")}
        help={t("usedByThemesWith")}
        value={l(value.statement)}
        onChange={(v) => set("statement", v)}
        error={errorAt(errors, "statement")}
      />
      <TextI18n
        label={t("scrollIndicator")}
        help={t("textBelowTheTitle")}
        value={l(value.scroll)}
        onChange={(v) => set("scroll", v)}
        error={errorAt(errors, "scroll")}
      />
      <Toggle label={t("showTheScrollIndicator")} checked={value.showScroll !== false} onChange={(v) => set("showScroll", v)} />
      <TextI18n
        label={t("demoReelButton")}
        help={t("buttonTextThemesWith")}
        value={l(value.reel)}
        onChange={(v) => set("reel", v)}
        error={errorAt(errors, "reel")}
      />
      <PagePicker
        label={t("demoReelPage")}
        help={t("whereTheDemoreelButton")}
        value={value.reelPageId as number | undefined}
        onChange={(v) => set("reelPageId", v)}
        error={errorAt(errors, "reelPageId")}
        context={context}
        optional={t("none")}
      />
    </>
  );
}

export function CollectionTilesEditor() {
  const t = useTranslations("blockEditors");
  const tf = useTranslations("fields");
  const tl = useTranslations("blockRegLabels");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  type Item = { collection?: string; pageId?: number; eyebrow: L; title: L; intro: L };
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
      const kept = editsFromItems(items.filter((i): i is TileItem => i.pageId !== undefined && i.collection !== undefined && (COLLECTION_KEYS as readonly string[]).includes(i.collection)), found);
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
      <TextI18n label={t("label")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("blockTitle")} value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <Select
        label={t("imageSize")}
        help={t("anEntryNeverExceeds")}
        value={tileSize(value.size)}
        options={TILE_SIZES.map((s) => ({ value: s, label: tl(`tileSize.${s}`) }))}
        onChange={(v) => set("size", v ?? "medium")}
        error={errorAt(errors, "size")}
      />
      <FormatSelect label={t("imageFormat")} help={t("fixedImagesAreCropped")} />
      <Select
        label={t("entries")}
        help={
          mode === "auto"
            ? t("oneEntryPerCollection")
            : t("youChooseTheEntries")
        }
        value={mode}
        options={[
          { value: "auto", label: t("automatic") },
          { value: "manual", label: t("handPicked") },
        ]}
        onChange={(v) => switchMode(v === "manual" ? "manual" : "auto")}
      />
      {mode === "auto" ? (
        <div className="a-field" data-testid="tiles-auto">
          {entries.length === 0 && <p className="a-help">{t("noCollectionPagePublished")}</p>}
          {entries.map((e) => (
            <fieldset key={e.pageId} className="a-card" data-tile-page={e.pageId}>
              <legend>{e.title.fr || t("pageId", { id: e.pageId })}</legend>
              <p className="a-help">
                {t("textsFromThePage")}
                {Object.keys(e.edited).length ? t("exceptTheOnesYou") : "."}
              </p>
              <TextI18n label={t("label")} value={e.eyebrow} onChange={(v) => setEdit(e, "eyebrow", v)} />
              <TextI18n label={t("title")} value={e.title} onChange={(v) => setEdit(e, "title", v)} />
              <TextareaI18n label={t("introduction")} value={e.intro} onChange={(v) => setEdit(e, "intro", v)} />
              {Object.keys(e.edited).length > 0 && (
                <button type="button" className="a-btn" onClick={() => onChange({ ...value, edits: edits.filter((x) => x.pageId !== e.pageId).length ? edits.filter((x) => x.pageId !== e.pageId) : undefined })}>
                  {t("useThePageS")}
                </button>
              )}
            </fieldset>
          ))}
        </div>
      ) : (
        <ListField<Item>
          label={t("listOfEntries")}
          help={t("eachEntryShowsA")}
          items={items}
          onChange={(next) => set("items", next)}
          make={() => ({ collection: "characters", eyebrow: EMPTY, title: EMPTY, intro: EMPTY })}
          addLabel={t("addAnEntry")}
          itemLabel={(i) => t("entryN", { n: i + 1 })}
          error={errorAt(errors, "items")}
          render={(item, update, i) => (
            <>
              <Select
                label={t("collection")}
                help={t("aCollectionEntryShows")}
                value={item.collection as "characters" | "backgrounds" | "animation" | undefined}
                options={[
                  { value: "characters", label: tf("collection_characters") },
                  { value: "backgrounds", label: tf("collection_backgrounds") },
                  { value: "animation", label: tf("collection_animation") },
                ]}
                allowEmpty={t("noneSimplePage")}
                onChange={(v) => {
                  const { collection: _c, ...rest } = item;
                  void _c;
                  update(v ? { ...rest, collection: v } : rest);
                }}
                error={errorAt(errors, `items.${i}.collection`)}
              />
              <PagePicker label={t("destinationPage")} value={item.pageId} onChange={(v) => update({ ...item, pageId: v })} error={errorAt(errors, `items.${i}.pageId`)} context={context} />
              <TextI18n label={t("label")} value={item.eyebrow} onChange={(v) => update({ ...item, eyebrow: v })} error={errorAt(errors, `items.${i}.eyebrow`)} />
              <TextI18n label={t("title")} value={item.title} onChange={(v) => update({ ...item, title: v })} error={errorAt(errors, `items.${i}.title`)} />
              <TextareaI18n label={t("introduction")} value={item.intro} onChange={(v) => update({ ...item, intro: v })} error={errorAt(errors, `items.${i}.intro`)} />
            </>
          )}
        />
      )}
    </>
  );
}

export function FeaturedProjectsEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const more = value.more as { label: L; pageId?: number } | undefined;
  return (
    <>
      <TextI18n label={t("label")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("title")} value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <TextareaI18n label={t("introduction")} value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
      <ProjectPicker
        label={t("projectsShown")}
        help={t("tickTheProjectsIn")}
        value={value.projects as string[] | undefined}
        onChange={(v) => set("projects", v.length ? v : undefined)}
        error={errorAt(errors, "projects")}
        context={context}
      />
      {!(value.projects as string[] | undefined)?.length && (
        <Select
          label={t("numberOfFeaturedProjects")}
          value={(value.limit as number) ?? 2}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set("limit", v ?? 2)}
          error={errorAt(errors, "limit")}
        />
      )}
      <Toggle
        label={t("seeMoreLinkBelow")}
        checked={Boolean(more)}
        onChange={(on) => set("more", on ? { label: EMPTY } : undefined)}
      />
      {more && (
        <>
          <TextI18n label={t("linkText")} value={more.label} onChange={(v) => set("more", { ...more, label: v })} error={errorAt(errors, "more.label")} />
          <PagePicker label={t("destinationPage")} value={more.pageId} onChange={(v) => set("more", { ...more, pageId: v })} error={errorAt(errors, "more.pageId")} context={context} />
        </>
      )}
    </>
  );
}

export function CollectionIntroEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <CollectionPicker value={value.collection as string} onChange={(v) => set("collection", v)} error={errorAt(errors, "collection")} />
      <TextI18n label={t("label")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("title")} value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <TextareaI18n label={t("introduction")} value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
      <Toggle
        label={t("showTheCountersWorks")}
        checked={(value.showCounts as boolean) ?? true}
        onChange={(v) => set("showCounts", v)}
      />
    </>
  );
}

export function CollectionProjectsEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <CollectionPicker
      value={value.collection as string}
      onChange={(v) => set("collection", v)}
      error={errorAt(errors, "collection")}
      exclude={["animation"]}
      help={t("showsEveryProjectThat")}
    />
  );
}

export function VideoEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker
        label={t("hostedDemoReelOptional")}
        help={t("aVideoFromYour")}
        value={value.reelMediaId as number | undefined}
        onChange={(v) => set("reelMediaId", v)}
        error={errorAt(errors, "reelMediaId")}
        context={context}
        kind="video"
      />
      <TextI18n label={t("demoReelLabel")} value={l(value.reelEyebrow)} onChange={(v) => set("reelEyebrow", v)} error={errorAt(errors, "reelEyebrow")} />
      <TextI18n label={t("excerptsLabel")} value={l(value.cardsEyebrow)} onChange={(v) => set("cardsEyebrow", v)} error={errorAt(errors, "cardsEyebrow")} />
      <TextI18n label={t("excerptsTitle")} value={l(value.cardsTitle)} onChange={(v) => set("cardsTitle", v)} error={errorAt(errors, "cardsTitle")} />
    </>
  );
}

function Paragraphs({ value, onChange, errors, path = "paragraphs", first }: { value: L[]; onChange: (v: L[]) => void; errors: Record<string, string>; path?: string; first?: string }) {
  const t = useTranslations("blockEditors");
  return (
    <ListField<L>
      label={t("paragraphs")}
      help={first}
      items={value}
      onChange={onChange}
      make={() => EMPTY}
      min={1}
      addLabel={t("addAParagraph")}
      itemLabel={(i) => t("paragraphN", { n: i + 1 })}
      error={errorAt(errors, path)}
      render={(p, update, i) => <TextareaI18n label={t("text")} value={p} onChange={update} error={errorAt(errors, `${path}.${i}`)} rows={4} />}
    />
  );
}

export function RichTextEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n label={t("labelOptional")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("titleOptional")} value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <Paragraphs value={(value.paragraphs as L[]) ?? [EMPTY]} onChange={(v) => set("paragraphs", v)} errors={errors} />
    </>
  );
}

/** Texte facultatif : vide, la clé disparaît (le champ n'occupe plus de place ; « + Ajouter … » le recrée sur la page). */
const optional = (v: L): L | undefined => (v.fr || v.en ? v : undefined);

/** Au clic sur un bouton « Me contacter » (lot 125) : formulaire de contact (défaut) ou ancien e-mail. */
function ContactActionSelect({ idPrefix, prop }: { idPrefix: string; prop: "ctaAction" | "contactAction" }) {
  const t = useTranslations("blockEditors");
  const { value, onChange } = useBlockEditor();
  const set = useSet(value, onChange);
  const id = `${idPrefix}-${prop}`;
  return (
    <Field label={t("onClick")} htmlFor={id} help={t("theFormOpensIn")}>
      <select id={id} className="a-input" value={contactActionOf(value[prop])} onChange={(e) => set(prop, e.target.value === "mail" ? "mail" : undefined)}>
        {CONTACT_ACTIONS.map((a) => (
          <option key={a} value={a}>
            {CONTACT_ACTION_LABELS[a]}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ContactEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, idPrefix } = useBlockEditor();
  const set = useSet(value, onChange);
  const form = value.form === true;
  // Option formulaire : active, le bloc porte les réglages de l'ancien « Formulaire de contact » (champs, messages, envoi).
  // Désactivée, les champs saisis et l'identifiant sont gardés (réactiver les retrouve) ; sans effet tant que l'option est coupée.
  const setForm = (on: boolean) => onChange(withContactForm(value, on) as P);
  return (
    <>
      <Toggle
        label={t("withAForm")}
        help={t("aFormToWrite")}
        checked={form}
        onChange={setForm}
      />
      <TextI18n label={t("labelOptional")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", optional(v))} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("titleOptional")} value={l(value.title)} onChange={(v) => set("title", optional(v))} error={errorAt(errors, "title")} />
      <TextareaI18n label={t("introductionOptional")} value={l(value.intro)} onChange={(v) => set("intro", optional(v))} error={errorAt(errors, "intro")} />
      {form ? (
        <ContactFormEditor />
      ) : (
        <>
          <TextI18n label={t("buttonTextOptional")} help={t("emptyNoButton")} value={l(value.cta)} onChange={(v) => set("cta", optional(v))} error={errorAt(errors, "cta")} />
          <ContactActionSelect idPrefix={idPrefix} prop="ctaAction" />
        </>
      )}
    </>
  );
}

export function ProfileEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context, idPrefix } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker label={t("portrait")} value={value.portraitMediaId as number | undefined} onChange={(v) => set("portraitMediaId", v)} error={errorAt(errors, "portraitMediaId")} context={context} />
      <FormatSelect label={t("portraitFormat")} ratioProp="portraitRatio" mediaProp="portraitMediaId" help={t("fixedThePortraitIs")} />
      <TextI18n label={t("portraitCaptionOptional")} value={l(value.portraitCaption)} onChange={(v) => set("portraitCaption", optional(v))} error={errorAt(errors, "portraitCaption")} />
      <TextI18n label={t("labelOptional")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", optional(v))} error={errorAt(errors, "eyebrow")} />
      <Toggle
        label={t("showYourName")}
        help={t("theSiteNameLarge")}
        checked={value.showName !== false}
        onChange={(on) => set("showName", on ? undefined : false)}
      />
      <Paragraphs
        value={(value.paragraphs as L[]) ?? [EMPTY]}
        onChange={(v) => set("paragraphs", v)}
        errors={errors}
        first={t("theFirstParagraphIs")}
      />
      <TextI18n label={t("contactLabelOptional")} value={l(value.contactEyebrow)} onChange={(v) => set("contactEyebrow", optional(v))} error={errorAt(errors, "contactEyebrow")} />
      <TextI18n label={t("contactButtonTextOptional")} help={t("emptyNoButtonThe")} value={l(value.contactLabel)} onChange={(v) => set("contactLabel", optional(v))} error={errorAt(errors, "contactLabel")} />
      <ContactActionSelect idPrefix={idPrefix} prop="contactAction" />
      <TextI18n label={t("socialNetworksLabelOptional")} value={l(value.socialEyebrow)} onChange={(v) => set("socialEyebrow", optional(v))} error={errorAt(errors, "socialEyebrow")} />
    </>
  );
}

export function ProjectBoardEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context, idPrefix } = useBlockEditor();
  const set = useSet(value, onChange);
  const current = context.projects.find((p) => p.slug === value.project);
  const id = `${idPrefix}-projet`;
  return (
    <>
    <Field
      label={t("project")}
      htmlFor={id}
      error={errorAt(errors, "project")}
      help={
        current?.draft
          ? t("projectCreatedOnThis")
          : t("imagesArePlacedMoved")
      }
    >
      <select id={id} className="a-input" value={(value.project as string | undefined) ?? ""} onChange={(e) => set("project", e.target.value || undefined)}>
        <option value="">{t("theBlockSProject")}</option>
        {context.projects.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
            {p.draft ? t("createdOnThisPage") : p.onPage === false ? t("notOnAPage") : ""}
          </option>
        ))}
      </select>
    </Field>
    <Toggle label={t("projectNameAndIntroduction")} checked={value.header !== false} onChange={(on) => set("header", on ? undefined : false)} />
    <Toggle label={t("deeperBackgroundToAlternate")} checked={Boolean(value.deep)} onChange={(on) => set("deep", on || undefined)} />
    {typeof value.collection === "string" && <p className="a-help">{t("projectLimitedToThe")}</p>}
    </>
  );
}

/* ---- Conteneurs et composants (v0.13) ------------------------------------ */

export function FeaturedProjectEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const more = value.more as { label: L; pageId?: number } | undefined;
  const count = Array.isArray(value.children) ? value.children.length : 0;
  return (
    <>
      <ProjectCombobox
        prefix="ve"
        label={t("projectShownInThis")}
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
      <p className="a-help">{t("theTitleIntroductionAnd", { count })}</p>
      <Toggle label={t("seeMoreLinkBelow2")} checked={Boolean(more)} onChange={(on) => set("more", on ? { label: EMPTY } : undefined)} />
      {more && (
        <>
          <TextI18n label={t("linkText")} value={more.label} onChange={(v) => set("more", { ...more, label: v })} error={errorAt(errors, "more.label")} />
          <PagePicker label={t("destinationPage")} value={more.pageId} onChange={(v) => set("more", { ...more, pageId: v })} error={errorAt(errors, "more.pageId")} context={context} />
        </>
      )}
    </>
  );
}

/** Choix d'agencement par pictogrammes, avec le nom de chacun (la barre de la grille, sur la toile, propose les mêmes). */
export function LayoutPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("blockEditors");
  return (
    <div className="a-field">
      <span className="a-label" id="ve-layout-label">
        {t("arrangement")}
      </span>
      <div className="ve-layouts ve-layouts-named" role="radiogroup" aria-labelledby="ve-layout-label">
        {GRID_LAYOUTS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={value === l} title={LAYOUT_LABELS[l]} aria-label={LAYOUT_LABELS[l]} data-layout={l} className="ve-layout" onClick={() => onChange(l)}>
            <GridLayoutIcon layout={l} />
            <span>{LAYOUT_LABELS[l]}</span>
          </button>
        ))}
      </div>
      <p className="a-help">{t("imagesFillTheCells")}</p>
    </div>
  );
}

const gapChoices = (t: AdminT): [string, string][] => [
  ["none", t("none2")],
  ["tight", t("small")],
  ["normal", t("medium")],
  ["wide", t("large")],
];

/**
 * Grille de la page et grille d'une planche : UN seul éditeur (lot 31d). L'essentiel est en haut — agencement, espace
 * entre les images, format des cases, nombre d'images — puis, sous « Réglages avancés », le reste. Les mêmes gestes existent
 * sur la toile (barre de la grille et de ses cases).
 */
export function GridTop() {
  const t = useTranslations("blockEditors");
  const tl = useTranslations("blockRegLabels");
  const { value, onChange, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const layout = (value.layout as string) ?? "2";
  const kids = Array.isArray(value.children) ? (value.children as { type: string; props: P }[]) : [];
  const apply = (op: GridModelOp) => {
    const res = applyGridOp(value, op, ratios);
    if ("error" in res) return;
    onChange(res.props as typeof value);
  };
  const cols = layout === "custom" ? customCols(value as GridShape) : layout === "auto" ? autoCols(value as GridShape) : 3;
  const ratios = kids.map((c) => {
    const row = context.media.find((m) => m.id === c.props.mediaId);
    return row?.width && row?.height ? row.width / row.height : c.type === "video-single" ? 16 / 9 : 1.5;
  });
  return (
    <>
      <section className="ve-grid-top" aria-label={t("gridTheEssentials")} data-testid="grid-top">
        <Toggle label={t("enlargeOnClick")} checked={value.zoom !== false} onChange={(v) => set("zoom", v ? undefined : false)} />
        <LayoutPicker value={layout} onChange={(v) => apply({ op: "set", layout: v as GridLayout })} />
        <div className="a-field">
          <span className="a-label" id="ve-gap-label">
            {t("spaceBetweenImages")}
          </span>
          <div className="ve-chips" role="radiogroup" aria-labelledby="ve-gap-label" data-testid="grid-gap">
            {gapChoices(t).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={((value.gap as string) ?? "normal") === v} data-gap={v} className="ve-chip" onClick={() => set("gap", v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <FormatSelect label={t("cellFormat")} help={t("videosFollowTheSame")} explicitAuto />
        {isJustified(value as GridShape) && layout !== "auto" && !keepsShape(value as GridShape) && <p className="a-help" data-testid="grid-justify-hint">{tl("justifyHint")}</p>}
        {keepsShape(value as GridShape) && <p className="a-help" data-testid="grid-keep-hint">{tl("keepShapeHint")}</p>}
        <p className="a-help" data-testid="grid-count">
          {t("countPlural0No", { count: kids.length })}
        </p>
        {(layout === "custom" || layout === "auto") && (
          <div className="a-field" data-testid="grid-custom">
            <span className="a-label" id="ve-cols-label">
              {t("columns")}
            </span>
            <div className="ve-chips" role="radiogroup" aria-labelledby="ve-cols-label">
              {CUSTOM_COLS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={cols === c} data-cols={c} className="ve-chip" onClick={() => apply({ op: "set", cols: c })}>
                  {c}
                </button>
              ))}
            </div>
            {layout === "custom" && <Toggle label={t("swapLeftAndRight")} checked={value.mirror === true} onChange={(on) => apply({ op: "set", mirror: on })} />}
            <p className="a-help">{layout === "auto" ? (isJustified(value as GridShape) ? tl("justifyHint") : tl("autoHint")) : isJustified(value as GridShape) ? t("onThePageEach") : t("onThePageEach2")}</p>
          </div>
        )}
        <button type="button" className="a-btn" data-testid="grid-adapt" disabled={kids.length === 0} onClick={() => apply({ op: "adapt", ratios })}>
          {t("fitToTheImages")}
        </button>
        <p className="a-help">{t("givesEachCellThe")}</p>
      </section>
    </>
  );
}

export function GridAdvanced() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <details className="ve-advanced" data-testid="grid-advanced">
        <summary>{t("advancedSettings")}</summary>
        <Select
          label={t("verticalAlignment")}
          value={(value.align as string) ?? "stretch"}
          options={[
            { value: "stretch", label: t("stretch") },
            { value: "start", label: t("top") },
            { value: "center", label: t("center") },
            { value: "end", label: t("bottom") },
          ]}
          onChange={(v) => set("align", v ?? "stretch")}
        />
        <Toggle label={t("spaceAboveAsBetween")} checked={(value.top ?? "gap") === "gap"} onChange={(on) => set("top", on ? "gap" : "none")} />
        <TextI18n label={t("labelOptional")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
        <TextI18n label={t("titleOptional")} value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
        <TextI18n label={t("belowTheGridTitle")} value={l(value.captionTitle)} onChange={(v) => set("captionTitle", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionTitle")} />
        <TextareaI18n label={t("belowTheGridCaption")} value={l(value.caption)} onChange={(v) => set("caption", v.fr || v.en ? v : undefined)} error={errorAt(errors, "caption")} />
        <TextI18n label={t("belowTheGridDate")} value={l(value.captionDate)} onChange={(v) => set("captionDate", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionDate")} />
      </details>
    </>
  );
}


export function GridEditor() {
  return (
    <>
      <GridTop />
      <GridAdvanced />
    </>
  );
}

export function ImageEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <Toggle label={t("enlargeOnClick")} checked={value.zoom !== false} onChange={(v) => set("zoom", v ? undefined : false)} />
      <MediaPicker label={t("image")} value={value.mediaId as number | undefined} onChange={(v) => set("mediaId", v)} error={errorAt(errors, "mediaId")} context={context} />
      <TextI18n label={t("titleBelowTheImage")} value={l(value.captionTitle)} onChange={(v) => set("captionTitle", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionTitle")} />
      <TextareaI18n label={t("captionOptional")} value={l(value.caption)} onChange={(v) => set("caption", v.fr || v.en ? v : undefined)} error={errorAt(errors, "caption")} />
      <TextI18n label={t("dateOptional")} help={t("shortFreeTextFor")} value={l(value.captionDate)} onChange={(v) => set("captionDate", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionDate")} />
      <Select
        label={t("width")}
        help={t("inAGridThe")}
        value={(value.width as string) ?? "wide"}
        options={[
          { value: "text", label: t("textColumn") },
          { value: "wide", label: t("siteWidth") },
          { value: "full", label: t("fullWidth") },
        ]}
        onChange={(v) => set("width", v ?? "wide")}
      />
      <FormatSelect help={t("fixedTheImageIs")} mediaProp="mediaId" />
      <Select
        label={t("inTheCell")}
        help={t("withNoFixedFormat")}
        value={(value.fit as string) ?? "auto"}
        options={[
          { value: "auto", label: t("automaticWholeAtFull") },
          { value: "contain", label: t("wholeImage") },
          { value: "cover", label: t("fillTheCell") },
        ]}
        onChange={(v) => set("fit", v === "auto" ? undefined : v)}
      />
    </>
  );
}

export function CvEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <MediaPicker
        label={t("cvPdf")}
        kind="pdf"
        help={t("aPdfOfAt")}
        value={value.mediaId as number | undefined}
        onChange={(v) => set("mediaId", v)}
        error={errorAt(errors, "mediaId")}
        context={context}
      />
      <TextI18n label={t("label")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("title")} value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <TextareaI18n label={t("introductionOptional")} value={l(value.intro)} onChange={(v) => set("intro", v.fr || v.en ? v : undefined)} error={errorAt(errors, "intro")} />
      <TextI18n label={t("buttonText")} help={t("emptyDownloadMyCv")} value={l(value.button)} onChange={(v) => set("button", v.fr || v.en ? v : undefined)} error={errorAt(errors, "button")} />
      <TextField
        label={t("downloadedFileName")}
        help={t("noExtensionLowercaseLetters")}
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
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const linked = Boolean(value.linked);
  return (
    <>
      <Toggle
        label={t("reuseAProjectS")}
        help={t("theTitleAndIntroduction")}
        checked={linked}
        onChange={(on) => set("linked", on || undefined)}
      />
      {linked && (
        <>
          <ProjectCombobox
            prefix="ve"
            label={t("projectReusedByThis")}
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
      <TextI18n label={t("label")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v)} error={errorAt(errors, "eyebrow")} />
      {!linked && (
        <>
          <TextI18n label={t("title")} value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
          <TextareaI18n label={t("introduction")} value={l(value.intro)} onChange={(v) => set("intro", v)} error={errorAt(errors, "intro")} />
          <Toggle
            label={t("mainPageTitleH1")}
            help={t("thePageSBig")}
            checked={value.main === true}
            onChange={(on) => set("main", on ? true : undefined)}
          />
          <Toggle
            label={t("countersNWorksM")}
            help={t("computedFromThePage")}
            checked={value.counts === true}
            onChange={(on) => set("counts", on ? true : undefined)}
          />
        </>
      )}
    </>
  );
}

export function PageLinkEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n label={t("linkText")} value={l(value.label)} onChange={(v) => set("label", v)} error={errorAt(errors, "label")} />
      <PagePicker label={t("destinationPage")} value={value.pageId as number | undefined} onChange={(v) => set("pageId", v)} error={errorAt(errors, "pageId")} context={context} />
    </>
  );
}

/* ---- Page introuvable (lot 89) -------------------------------------------- */

export function ExitEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      <TextI18n
        label={t("labelOptional")}
        help={t("emptyInBothLanguages")}
        value={l(value.eyebrow)}
        onChange={(v) => set("eyebrow", optional(v))}
        error={errorAt(errors, "eyebrow")}
      />
      <TextI18n label={t("title")} help={t("emptyTheLanguageS")} value={l(value.title)} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
      <ListField<L>
        label={t("messages")}
        help={t("aSingleMessageIt")}
        items={(value.messages as L[]) ?? [EMPTY]}
        onChange={(v) => set("messages", v)}
        make={() => EMPTY}
        min={1}
        addLabel={t("addAMessage")}
        itemLabel={(i) => t("messageN", { n: i + 1 })}
        error={errorAt(errors, "messages")}
        render={(m, update, i) => <TextareaI18n label={t("text")} value={m} onChange={update} error={errorAt(errors, `messages.${i}`)} rows={3} />}
      />
      <TextI18n label={t("buttonText")} help={t("emptyBackToHome")} value={l(value.label)} onChange={(v) => set("label", v)} error={errorAt(errors, "label")} />
      <PagePicker label={t("buttonDestination")} optional={t("theHomePage")} value={value.pageId as number | undefined} onChange={(v) => set("pageId", v)} error={errorAt(errors, "pageId")} context={context} />
    </>
  );
}

const workSources = (t: AdminT): { value: "all" | "collection" | "manual"; label: string }[] => [
  { value: "all", label: t("theWholePortfolio") },
  { value: "collection", label: t("oneCategory") },
  { value: "manual", label: t("aSelectionOfWorks") },
];

export function RandomWorkEditor() {
  const t = useTranslations("blockEditors");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  const source = (value.source as "all" | "collection" | "manual" | undefined) ?? "all";
  const chosen = new Set((value.works as string[] | undefined) ?? []);
  const works = context.works ?? [];
  return (
    <>
      <Select
        label={t("whereTheWorkComes")}
        help={t("aPublishedWorkIs")}
        value={source}
        options={workSources(t)}
        onChange={(v) => onChange({ ...value, source: v ?? "all", ...(v === "collection" ? {} : { collection: undefined }), ...(v === "manual" ? {} : { works: undefined }) })}
        error={errorAt(errors, "source")}
      />
      {source === "collection" && <CollectionPicker label={t("category")} value={value.collection as string | undefined} onChange={(v) => set("collection", v)} error={errorAt(errors, "collection")} />}
      {source === "manual" && (
        <Field label={t("worksInTheSelection")} help={works.length ? t("chosenChosenOutOf", { chosen: chosen.size, total: works.length }) : t("noPublishedWorkYet")} error={errorAt(errors, "works")}>
          <ul className="a-checklist" data-testid="random-work-picker">
            {works.map((w) => (
              <li key={w.slug}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(w.slug)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(w.slug);
                      else next.delete(w.slug);
                      set("works", next.size ? [...next] : undefined);
                    }}
                  />{" "}
                  {w.title} <span className="muted">· {w.project}</span>
                </label>
              </li>
            ))}
          </ul>
        </Field>
      )}
      <TextI18n label={t("labelOptional")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", optional(v))} error={errorAt(errors, "eyebrow")} />
      <Select
        label={t("width")}
        value={(value.width as "text" | "wide" | undefined) ?? "text"}
        options={[
          { value: "text", label: t("textColumn") },
          { value: "wide", label: t("wide") },
        ]}
        onChange={(v) => set("width", v)}
        error={errorAt(errors, "width")}
      />
    </>
  );
}

export function VideoSingleEditor() {
  const t = useTranslations("blockEditors");
  const tl = useTranslations("blockRegLabels");
  const { value, onChange, errors, context } = useBlockEditor();
  const set = useSet(value, onChange);
  return (
    <>
      {typeof value.slot === "string" && !value.mediaId && (
        <p className="a-help">{t("youtubeShotFromThe")}</p>
      )}
      <MediaPicker label={t("video")} kind="video" value={value.mediaId as number | undefined} onChange={(v) => set("mediaId", v)} error={errorAt(errors, "mediaId")} context={context} />
      <Select
        label={t("playback")}
        help={tl(`videoMode.hint.${modeOf(value)}`)}
        value={modeOf(value)}
        options={videoModeOptions(tl)}
        onChange={(v) => set("mode", v ?? "player")}
      />
      {typeof value.mediaId === "number" && context.media.find((x) => x.id === value.mediaId)?.hasAudio !== false && (
        // Son au départ (lot 127) : seulement pour une vidéo qui a du son ; « Activé » (le défaut) retire le champ.
        <Select
          label={t("soundOnStart")}
          help={tl(`videoSound.hint.${soundOf(value)}`)}
          value={soundOf(value)}
          options={videoSoundOptions(tl)}
          onChange={(v) => onChange(v === "off" ? { ...value, sound: "off" } : (({ sound: _s, ...rest }) => (void _s, rest))(value))}
        />
      )}
      <Select
        label={t("presentation")}
        value={(value.variant as string) ?? "card"}
        options={[
          { value: "card", label: t("cardVideoTitleAnd") },
          { value: "feature", label: t("largeLabelAndTitle") },
          { value: "plain", label: t("videoOnlyCaptionOptional") },
        ]}
        onChange={(v) => set("variant", v ?? "card")}
      />
      <MediaPicker
        label={t("placeholderImageOptional")}
        help={t("shownBeforePlaybackOtherwise")}
        value={value.posterMediaId as number | undefined}
        onChange={(v) => set("posterMediaId", v)}
        error={errorAt(errors, "posterMediaId")}
        context={context}
      />
      <TextI18n label={t("labelLargePresentation")} value={l(value.eyebrow)} onChange={(v) => set("eyebrow", v.fr || v.en ? v : undefined)} error={errorAt(errors, "eyebrow")} />
      <TextI18n label={t("title")} help={t("emptyTheVideoS")} value={l(value.title)} onChange={(v) => set("title", v.fr || v.en ? v : undefined)} error={errorAt(errors, "title")} />
      <TextareaI18n label={t("caption")} value={l(value.description)} onChange={(v) => set("description", v.fr || v.en ? v : undefined)} error={errorAt(errors, "description")} />
      <TextI18n label={t("titleBelowTheVideo")} value={l(value.captionTitle)} onChange={(v) => set("captionTitle", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionTitle")} />
      <TextI18n label={t("dateOptional")} help={t("shortFreeTextFor")} value={l(value.captionDate)} onChange={(v) => set("captionDate", v.fr || v.en ? v : undefined)} error={errorAt(errors, "captionDate")} />
    </>
  );
}

/* ---- Formulaire de contact (v0.13) ---------------------------------------- */

export function ContactFormEditor() {
  const t = useTranslations("blockEditors");
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
        <strong>{t("emailSendingNotConfigured")}</strong>{" "}
        {t.rich("noMailServerOn", {
          link: (chunks) => (
            <Link href="/admin/messages" target="_blank">
              {chunks}
            </Link>
          ),
        })}
      </p>
      {context.previewForm && (
        <div className="a-field" role="group" aria-label={t("previewOnThePage")}>
          <span className="a-label">{t("seeOnThePage")}</span>
          <div className="ve-layouts">
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("form")}>
              {t("theForm")}
            </button>
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("success")}>
              {t("seeTheConfirmationMessage")}
            </button>
            <button type="button" className="a-btn a-btn-small" onClick={() => context.previewForm!("error")}>
              {t("theErrorMessage")}
            </button>
          </div>
        </div>
      )}
      <TextI18n label={t("subjectOfReceivedMessages")} value={l(value.subject)} onChange={(v) => set("subject", v)} error={errorAt(errors, "subject")} />
      <TextI18n label={t("buttonText")} value={l(value.submit)} onChange={(v) => set("submit", v)} error={errorAt(errors, "submit")} />
      <TextareaI18n label={t("confirmationMessage")} value={l(value.success)} onChange={(v) => set("success", v)} error={errorAt(errors, "success")} />
      <TextareaI18n label={t("errorMessage")} value={l(value.error)} onChange={(v) => set("error", v)} error={errorAt(errors, "error")} />
      <h3 className="ve-sub">{t("fields")}</h3>
      {errorAt(errors, "fields") && <p className="a-field-error">{errorAt(errors, "fields")}</p>}
      <ol className="ve-list">
        {fields.map((f, i) => (
          <li key={f.id} className="ve-list-row" data-field-type={f.type}>
            <span className="ve-list-main">
              <p className="a-help">
                {FIELD_LABELS[f.type]}
                {f.reply ? t("usedToReplyTo2") : ""}
              </p>
              <TextI18n label={t("labelText")} value={l(f.label)} onChange={(v) => update(i, { label: v })} error={errorAt(errors, `fields.${i}.label`)} />
              <TextI18n label={t("exampleTextOptional")} value={l(f.placeholder)} onChange={(v) => update(i, { placeholder: v.fr || v.en ? v : undefined })} />
              <TextI18n label={t("helpOptional")} value={l(f.help)} onChange={(v) => update(i, { help: v.fr || v.en ? v : undefined })} />
              <Toggle label={t("required")} checked={f.required} onChange={(on) => update(i, { required: on })} />
              {f.type === "email" && (
                <Toggle
                  label={t("usedToReplyTo")}
                  checked={Boolean(f.reply)}
                  onChange={(on) => setFields(fields.map((x, j) => ({ ...x, reply: j === i ? on || undefined : on ? undefined : x.reply })))}
                />
              )}
              {f.type === "select" && (
                <ListField<{ fr: string; en: string }>
                  label={t("choicesOffered")}
                  items={f.options ?? []}
                  onChange={(next) => update(i, { options: next })}
                  make={() => ({ fr: "", en: "" })}
                  min={1}
                  addLabel={t("addAChoice")}
                  itemLabel={(k) => t("choiceN", { n: k + 1 })}
                  error={errorAt(errors, `fields.${i}.options`)}
                  render={(o, up) => <TextI18n label={t("choice")} value={o} onChange={up} />}
                />
              )}
            </span>
            <span className="ve-list-tools">
              <button type="button" className="a-icon-btn" aria-label={t("moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="a-icon-btn" aria-label={t("moveDown")} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="a-icon-btn a-danger-text"
                aria-label={t("removeThisField")}
                disabled={fields.length <= 1 || Boolean(f.reply)}
                title={f.reply ? t("thisFieldIsUsed") : undefined}
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
          label={t("addAField")}
          value={undefined}
          allowEmpty={t("chooseAType")}
          options={FIELD_TYPES.map((ft) => ({ value: ft, label: FIELD_LABELS[ft] }))}
          onChange={(ft) => ft && setFields([...fields, makeField(ft)])}
        />
      )}
    </>
  );
}

/**
 * Planche libre (lot 42) : format de la zone, comportement sur téléphone, liste des images (ordre d'empilement, du devant au
 * fond). Les mêmes opérations que la toile (`applyFreeOp`) : le panneau est le repli au clavier et à la souris pour tout ce
 * que l'on fait en glissant. Les positions se règlent sur la page (glisser, poignées, flèches).
 */
export function FreeBoardEditor() {
  const t = useTranslations("blockEditors");
  const tl = useTranslations("blockRegLabels");
  const { value, onChange, context } = useBlockEditor();
  const [picking, setPicking] = useState<{ id?: string; poster?: boolean } | null>(null);
  const items = freeItems(value);
  const apply = (op: FreeModelOp) => {
    const res = applyFreeOp(value, op);
    if (!("error" in res)) onChange(res.props);
  };
  // Un cadre recadré (lot 113) est « libre » : sa hauteur et sa largeur viennent des poignées ; un cran de format redonne le plan entier.
  const cropped = cropOf(value) !== null;
  const format = cropped ? "free" : ((value.format as FreeFormat | undefined) ?? "3:2");
  const phone = (value.phone as "scale" | "stack" | undefined) ?? "scale";
  const ordered = items.slice().sort((a, b) => b.z - a.z);
  return (
    <>
      <Toggle label={t("enlargeOnClick")} checked={value.zoom !== false} onChange={(v) => onChange(v ? (({ zoom: _z, ...rest }) => (void _z, rest))(value) : { ...value, zoom: false })} />
      <Select
        label={t("areaFormat")}
        help={t("theAreaSHeight")}
        value={format}
        options={FREE_FORMATS.map((f) => ({ value: f, label: cropped && f === "free" ? t("freeCropped") : tl(`freeFormat.${f}`) }))}
        onChange={(v) => {
          if (cropped && v === "free") return;
          apply({ op: "set", format: (v as FreeFormat) ?? "3:2" });
        }}
      />
      <Select
        label={t("onPhonesUnder640")}
        help={t("scaledKeepsTheComposition")}
        value={phone}
        options={FREE_PHONE_MODES.map((m) => ({ value: m, label: tl(`freePhone.${m}`) }))}
        onChange={(v) => apply({ op: "set", phone: (v as "scale" | "stack") ?? "scale" })}
      />
      <section className="ve-board-kids" aria-label={t("freeBoardImages")}>
        <h3 className="a-subhead">{t("projectImages")}</h3>
        {items.length === 0 && <p className="ve-hint">{t("nothingYetAddAn")}</p>}
        <ol className="ve-board-kid-list" data-testid="free-list">
          {ordered.map((it, i) => {
            const m = context.media.find((x) => x.id === it.media);
            return (
              <li key={it.id} data-free-id={it.id} data-media-id={it.media}>
                <span className="a-media-field-thumb">
                  {m?.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumb} alt="" />
                  ) : (
                    <span className="muted">{t("noId", { id: it.media })}</span>
                  )}
                </span>
                <span className="a-media-field-name">{m?.name ?? t("mediaNoId", { id: it.media })}</span>
                <div className="ve-board-kid-tools" role="group" aria-label={t("imageN", { n: i + 1 })}>
                  <button type="button" className="a-btn a-btn-small" onClick={() => setPicking({ id: it.id })}>
                    {t("replace")}
                  </button>
                  <button type="button" className="a-icon-btn" aria-label={t("bringForward")} title={t("bringForward")} disabled={i === 0} onClick={() => apply({ op: "front", id: it.id })}>
                    ↑
                  </button>
                  <button type="button" className="a-icon-btn" aria-label={t("sendBackward")} title={t("sendBackward")} disabled={i === ordered.length - 1} onClick={() => apply({ op: "back", id: it.id })}>
                    ↓
                  </button>
                  <button type="button" className="a-icon-btn a-danger-text" aria-label={t("remove")} onClick={() => apply({ op: "remove", id: it.id })}>
                    ✕
                  </button>
                </div>
                {m?.kind === "video" && (
                  <>
                    {/* Réglages propres à la vidéo (lot 116) : les mêmes que dans un composant Vidéo ou une case de grille. */}
                    <Select
                      label={t("playback")}
                      help={tl(`videoMode.hint.${it.video ?? "loop"}`)}
                      value={it.video ?? "loop"}
                      options={videoModeOptions(tl)}
                      onChange={(v) => {
                        const res = applyFreeLook(value, it.id, { video: v === "player" ? "player" : "loop" });
                        if (!("error" in res)) onChange(res.props);
                      }}
                    />
                    <div className="ve-board-kid-tools" role="group" aria-label={t("videoPoster")}>
                      <button type="button" className="a-btn a-btn-small" data-testid={`free-poster-${i}`} onClick={() => setPicking({ id: it.id, poster: true })}>
                        {it.poster ? t("changeThePoster") : t("chooseAPoster")}
                      </button>
                      {it.poster && (
                        <button type="button" className="a-btn a-btn-small" onClick={() => apply({ op: "poster", id: it.id, media: null })}>
                          {t("noPoster")}
                        </button>
                      )}
                    </div>
                    {m.hasAudio !== false && (
                      <Select
                        label={t("soundOnStart")}
                        help={tl(`videoSound.hint.${it.sound === "off" ? "off" : "on"}`)}
                        value={it.sound === "off" ? "off" : "on"}
                        options={videoSoundOptions(tl)}
                        onChange={(v) => {
                          const res = applyFreeLook(value, it.id, { sound: v === "off" ? "off" : null });
                          if (!("error" in res)) onChange(res.props);
                        }}
                      />
                    )}
                    <p className="ve-hint" data-testid={`free-sound-${i}`}>
                      {m.hasAudio === false ? t("videoWithoutSoundNo") : t("thisVideoHasSound")}
                    </p>
                  </>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span>{t("width2")}</span>
                  <input type="number" min={4} max={150} step={1} value={Math.round(it.w)} data-testid={`free-w-${i}`} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && apply({ op: "place", id: it.id, w: e.target.valueAsNumber })} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span>{t("rotation")}</span>
                  <input type="number" min={-180} max={180} step={1} value={it.rot} data-testid={`free-rot-${i}`} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && apply({ op: "place", id: it.id, rot: e.target.valueAsNumber })} />
                </label>
              </li>
            );
          })}
        </ol>
        <div className="ve-board-kid-add">
          <button type="button" className="a-btn" disabled={items.length >= MAX_FREE_ITEMS} data-testid="free-add-image" onClick={() => setPicking({})}>
            {t("addAnImage")}
          </button>
        </div>
        <MediaPickerDialog
          open={picking !== null}
          media={context.media.filter((m) => m.kind === "image" || (m.kind === "video" && !picking?.poster))}
          title={picking?.poster ? t("videoPoster") : picking?.id ? t("replaceTheImage") : t("addAnImage2")}
          onClose={() => setPicking(null)}
          onPick={(m) => {
            const at = picking;
            setPicking(null);
            if (!at) return;
            if (at.id && at.poster) return apply({ op: "poster", id: at.id, media: m.id });
            if (at.id) return apply({ op: "replace", id: at.id, media: m.id });
            const n = items.length;
            apply({ op: "put", id: newFreeId(), media: m.id, x: 30 + ((n * 13) % 45), y: 38 + ((n * 17) % 30), ratio: m.width && m.height ? m.width / m.height : 1.5 });
          }}
        />
      </section>
    </>
  );
}
