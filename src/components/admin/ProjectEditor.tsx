"use client";

/**
 * Éditeur de projet : informations (enregistrées avec « Enregistrer »), puis la
 * planche, qui ressemble à la planche publique : bande d'emplacements à hauteur
 * fixe, chacun au ratio de son image. Les gestes de la planche (déposer des
 * fichiers, réordonner, retirer, supprimer) sont des actions immédiates,
 * annoncées (toast + aria-live) ; les textes d'un emplacement se modifient dans
 * le panneau et s'enregistrent avec son bouton.
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { errorAt, Field, Select, TextareaI18n, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { saveMediaAltAction } from "@/app/admin/(espace)/medias/actions";
import {
  addSlotsAction,
  deleteSlotAction,
  reorderSlotsAction,
  saveProjectAction,
  saveSlotAction,
  setSlotMediaAction,
} from "@/app/admin/(espace)/projets/actions";
import type { AdminMediaRow, AdminProjectEdit, AdminSlot } from "@/lib/admin";

import { clone, ConfirmDialog, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import LibraryStrip, { LIB_PREFIX } from "./LibraryStrip";
import { MediaPickerDialog } from "./MediaLibrary";
import { DragHandle, SortableItems } from "./Sortable";
import Uploader from "./Uploader";
import { isUploaded, useUploadQueue, type QueueItem } from "./UploadQueue";
import { ACCEPT, hasFiles, useMediaWatch, useSizeFormat } from "./uploads";
import AltMissing from "./AltMissing";
import { formatDuration, isLoop } from "@/lib/video/limits";

const STRIP_H = 180;
const COLLECTIONS = ["characters", "backgrounds", "animation"] as const;
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Ratio de la place : celui de l'image, sinon celui de la dernière image retirée, sinon 4:3. */
const ratioOf = (slot: AdminSlot) => (slot.media?.width && slot.media.height ? slot.media.width / slot.media.height : (slot.aspect ?? 4 / 3));

/** Titre proposé d'après le nom du fichier (jamais publié sans ton accord). */
export function suggestTitle(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toLocaleUpperCase("fr-FR") + base.slice(1) : "";
}
/** Nom d'une image du projet (lot 67, CONC-13) : son titre, sinon le nom du fichier d'origine ; « Emplacement N » seulement pour une place vide. */
const slotLabel = (slot: AdminSlot, index: number, t: Translate) => slot.title.fr.trim() || slot.media?.name?.trim() || t("slotEmpty", { n: index + 1 });

/* ---- Informations du projet ------------------------------------------------- */

type Meta = Pick<AdminProjectEdit, "title" | "context" | "description" | "year" | "featured">;

function ProjectMeta({ project, legacyFeatured }: { project: AdminProjectEdit; legacyFeatured: { pageId: number; pageTitle: string }[] }) {
  const router = useRouter();
  const t = useTranslations("projectEditor");
  const initial: Meta = { title: project.title, context: project.context, description: project.description, year: project.year, featured: project.featured };
  const [saved, setSaved] = useState(initial);
  const [meta, setMeta] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const dirty = !same(meta, saved);
  useUnsavedGuard(dirty);
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((m) => ({ ...m, [k]: v }));
  return (
    <section className="a-panel" aria-labelledby="pr-infos">
      <h2 id="pr-infos">{t("infos")}</h2>
      <div className="a-form-grid">
        <TextI18n label={t("title")} value={meta.title} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
        <TextI18n label={t("context")} help={t("contextHelp")} value={meta.context} onChange={(v) => set("context", v)} error={errorAt(errors, "context")} />
        <TextareaI18n label={t("description")} value={meta.description} onChange={(v) => set("description", v)} error={errorAt(errors, "description")} />
        <div>
          <TextField label={t("yearPeriod")} help={t("yearPeriodHelp")} value={meta.year} onChange={(v) => set("year", v)} error={errors.year} />
          {/* Le réglage ne sert qu'à l'ancien bloc « Projets mis en avant » (sans projets choisis) : sans lui, il n'a plus d'effet. */}
          {legacyFeatured.length > 0 && (
            <Toggle
              label={t("legacyFeatured")}
              help={t("legacyFeaturedHelp", { pages: legacyFeatured.map((p) => t("quotedName", { name: p.pageTitle })).join(", ") })}
              checked={meta.featured}
              onChange={(v) => set("featured", v)}
            />
          )}
        </div>
      </div>
      <SaveBar
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={() =>
          start(async () => {
            const r = await saveProjectAction(project.id, meta);
            if (!r.ok) {
              setError(r.message);
              setErrors(r.fieldErrors ?? {});
              return;
            }
            setError(null);
            setErrors({});
            if (r.data.textsHeld) {
              // Les textes sont tenus par une page : seul le réglage « à la une » est enregistré, les textes restent à enregistrer.
              setSaved((s) => ({ ...s, featured: meta.featured }));
              setError(t("textsNotSaved", { detail: r.data.textsHeld }));
              toast(t("textsNotSavedToast"), "error");
            } else {
              setSaved(clone(meta));
              toast(t("projectSaved"));
            }
            setTimeout(() => router.refresh(), 0);
          })
        }
      />
    </section>
  );
}

/* ---- Emplacement ------------------------------------------------------------- */

type DropHint = { index: number } | { fill: number } | null;

/** Texte comparé sans accents ni majuscules (recherche par nom, lot 67). */
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** À partir de ce nombre d'images, la bande propose une recherche par nom. */
const SEARCH_FROM = 6;

function SlotTile({
  slot,
  index,
  selected,
  preview,
  hint,
  match,
  onOpen,
  onFiles,
  onLibrary,
}: {
  slot: AdminSlot;
  index: number;
  selected: boolean;
  preview?: string;
  /** Glisser depuis la Bibliothèque : marque d'insertion avant / après, ou remplissage. */
  hint?: "before" | "after" | "fill";
  /** Recherche par nom en cours : « found » = correspond, « dim » = ne correspond pas. */
  match?: "found" | "dim";
  onOpen: () => void;
  onFiles: (files: File[]) => void;
  onLibrary: () => void;
}) {
  const t = useTranslations("projectEditor");
  const [over, setOver] = useState(false);
  const media = slot.media;
  const label = slotLabel(slot, index, t);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      onFiles([...e.dataTransfer.files].slice(0, 1));
    },
  };
  if (!media) {
    return (
      <div className="a-slot a-slot-empty" data-slot={slot.id} data-found={match === "found" || undefined} data-dim={match === "dim" || undefined} data-over={over || hint === "fill" || undefined} data-drop={hint} data-selected={selected || undefined} {...dropProps}>
        <div className="a-slot-bar">
          <DragHandle />
          <button type="button" className="a-slot-open" onClick={onOpen} aria-label={t("editEmpty", { label })}>
            {label}
          </button>
        </div>
        <p>{t("dropHere")}</p>
        <button type="button" className="a-btn a-btn-small" onClick={onLibrary}>
          {t("pickFromLibrary")}
        </button>
      </div>
    );
  }
  const src = media.thumb ?? preview;
  return (
    <div className="a-slot" data-slot={slot.id} data-found={match === "found" || undefined} data-dim={match === "dim" || undefined} data-status={media.status} data-over={over || undefined} data-drop={hint} data-selected={selected || undefined} {...dropProps}>
      <button type="button" className="a-slot-image" onClick={onOpen} aria-label={t("edit", { label })} style={media.color ? { backgroundColor: media.color } : undefined}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" />
        )}
        {media.kind === "video" && media.status === "ready" && (
          <span className="a-duration-badge">
            <span aria-hidden="true">▶ </span>
            {formatDuration(media.duration)}
            {isLoop(media) && ` · ${t("loop")}`}
          </span>
        )}
        {media.status !== "ready" && (
          <span className="a-slot-overlay">
            {media.status === "processing" ? (
              <>
                <span>{media.kind === "video" ? (media.progress ? t("converting", { progress: media.progress }) : t("conversionWaiting")) : t("processing")}</span>
                <span className="a-progress" aria-hidden="true">
                  <span data-indeterminate style={{ width: "100%" }} />
                </span>
              </>
            ) : (
              <span>{t("failedReplace")}</span>
            )}
          </span>
        )}
      </button>
      <div className="a-slot-bar">
        <DragHandle />
        <span className="a-slot-title">{label}</span>
        {!media.alt.fr.trim() && media.status === "ready" && <AltMissing className="a-slot-warn" />}
      </div>
    </div>
  );
}

function PendingTile({ item }: { item: QueueItem }) {
  const t = useTranslations("projectEditor");
  const { formatSent } = useSizeFormat();
  return (
    <li className="a-sortable-item" style={{ width: Math.round(STRIP_H * item.ratio) }}>
      <div className="a-slot" data-status={item.phase === "failed" ? "failed" : "processing"}>
        <div className="a-slot-image">
          {item.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.preview} alt="" />
          )}
          <span className="a-slot-overlay">
            {item.phase === "failed" ? (
              <span>{item.message}</span>
            ) : (
              <>
                <span>
                  {item.phase === "waiting"
                    ? t("waiting")
                    : item.phase === "uploading"
                      ? item.size > 8 * 1024 * 1024
                        ? t("sending", { amount: formatSent(item.sent, item.size) })
                        : t("sendingPercent", { percent: Math.round(item.progress * 100) })
                      : item.video
                        ? t("conversion")
                        : t("processing")}
                </span>
                <span className="a-progress" aria-hidden="true">
                  <span style={{ width: item.phase === "uploading" ? `${Math.round(item.progress * 100)}%` : "100%" }} data-indeterminate={item.phase !== "uploading" || undefined} />
                </span>
              </>
            )}
          </span>
        </div>
        <div className="a-slot-bar">
          <span className="a-slot-title">{item.name}</span>
        </div>
      </div>
    </li>
  );
}

/* ---- Panneau d'un emplacement ------------------------------------------------ */

type SlotForm = Pick<AdminSlot, "title" | "description" | "collection" | "year" | "featured"> & { alt: { fr: string; en: string } };

function SlotPanel({
  slot,
  index,
  onClose,
  onReplaceFile,
  onLibrary,
}: {
  slot: AdminSlot;
  index: number;
  onClose: () => void;
  onReplaceFile: (files: File[]) => void;
  onLibrary: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("projectEditor");
  const initial: SlotForm = {
    title: slot.title,
    description: slot.description,
    collection: slot.collection,
    year: slot.year,
    featured: slot.featured,
    alt: slot.media?.alt ?? { fr: "", en: "" },
  };
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<"remove" | "delete" | null>(null);
  const [busy, start] = useTransition();
  const dirty = !same(form, saved);
  useUnsavedGuard(dirty);
  const fileId = useId();
  const label = slotLabel(slot, index, t);
  const collections = COLLECTIONS.map((value) => ({ value, label: t(`collection_${value}`) }));
  const collectionLabel = collections.find((c) => c.value === form.collection)?.label ?? form.collection;
  const set = <K extends keyof SlotForm>(k: K, v: SlotForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () =>
    start(async () => {
      const { alt, ...fields } = form;
      const r = await saveSlotAction(slot.id, fields);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return toast(r.message, "error");
      }
      if (slot.media && !same(alt, saved.alt)) {
        const a = await saveMediaAltAction(slot.media.id, alt);
        if (!a.ok) return toast(a.message, "error");
      }
      setErrors({});
      setSaved(clone(form));
      toast(t("slotSaved"));
      setTimeout(() => router.refresh(), 0);
    });

  return (
    <aside className="a-sidepanel a-slot-panel" aria-labelledby="sp-title">
      <div className="a-sidepanel-head">
        <h2 id="sp-title">{label}</h2>
        <button type="button" className="a-icon-btn" aria-label={t("closePanel")} onClick={onClose}>
          ✕
        </button>
      </div>
      {slot.media?.status === "failed" && <p className="a-alert">{slot.media.error}</p>}
      <TextI18n
        label={t("title")}
        help={t("slotTitleHelp")}
        value={form.title}
        onChange={(v) => set("title", v)}
        error={errorAt(errors, "title")}
      />
      {!form.title.fr.trim() && slot.media && suggestTitle(slot.media.name) && (
        <p className="a-suggest">
          <button type="button" className="a-btn a-btn-small" onClick={() => set("title", { fr: suggestTitle(slot.media!.name), en: form.title.en || suggestTitle(slot.media!.name) })}>
            {t("suggestedTitle", { title: suggestTitle(slot.media.name) })}
          </button>
        </p>
      )}
      <TextareaI18n label={t("description")} value={form.description} onChange={(v) => set("description", v)} error={errorAt(errors, "description")} />
      <div className="a-form-grid">
        <Select
          label={t("collection")}
          help={t("collectionHelp")}
          value={form.collection}
          options={collections}
          onChange={(v) => v && set("collection", v)}
          error={errors.collection}
        />
        <Field label={t("year")} error={errors.year} htmlFor={`${fileId}-year`}>
          <input id={`${fileId}-year`} className="a-input" type="number" min={1900} max={2200} value={form.year} onChange={(e) => set("year", Number(e.target.value))} />
        </Field>
      </div>
      <Toggle
        label={t("coverOf", { name: collectionLabel })}
        help={t("coverHelp", { name: collectionLabel })}
        checked={form.featured}
        onChange={(v) => set("featured", v)}
      />
      {slot.media && (
        <>
          <TextI18n
            label={t("altLabel")}
            help={t("altHelp")}
            value={form.alt}
            onChange={(v) => set("alt", v)}
            error={errorAt(errors, "alt")}
          />
          {!form.alt.fr.trim() && <p className="a-notice">{t("altMissing")}</p>}
        </>
      )}
      <div className="a-panel-actions">
        <span className="a-save-state" aria-live="polite">
          {dirty ? (
            <>
              <span className="a-dot" aria-hidden="true" /> {t("unsaved")}
            </>
          ) : (
            <>
              <span aria-hidden="true">✓</span> {t("saved")}
            </>
          )}
        </span>
        <button type="button" className="a-btn a-btn-primary" disabled={!dirty || busy} onClick={save}>
          {t("save")}
        </button>
      </div>

      <h3 className="a-subhead">{t("image")}</h3>
      <div className="a-panel-buttons">
        <label htmlFor={fileId} className="a-btn a-file-btn">
          {slot.media ? t("replaceImage") : t("sendImage")}
        </label>
        <input
          id={fileId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].slice(0, 1);
            e.target.value = "";
            if (files.length) onReplaceFile(files);
          }}
        />
        <button type="button" className="a-btn" onClick={onLibrary}>
          {t("pickFromLibrary")}
        </button>
        {slot.media && (
          <button type="button" className="a-btn a-btn-quiet a-danger-text" onClick={() => setConfirm("remove")}>
            {t("removeImage")}
          </button>
        )}
      </div>
      <div className="a-panel-danger">
        <button type="button" className="a-btn a-btn-quiet a-danger-text" onClick={() => setConfirm("delete")}>
          {t("deleteSlot")}
        </button>
      </div>

      <ConfirmDialog
        open={confirm === "remove"}
        title={t("removeTitle", { label })}
        confirmLabel={t("removeImage")}
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r = await setSlotMediaAction(slot.id, null);
            if (!r.ok) return toast(r.message, "error");
            setConfirm(null);
            toast(t("imageRemoved"));
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        <p className="muted">{t("removeBody")}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title={t("deleteTitle", { label })}
        confirmLabel={t("deleteSlot")}
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteSlotAction(slot.id);
            if (!r.ok) return toast(r.message, "error");
            setConfirm(null);
            toast(t("slotDeleted"));
            onClose();
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        <p className="muted">{t("deleteBody")}</p>
      </ConfirmDialog>
    </aside>
  );
}

/* ---- Planche ----------------------------------------------------------------- */

/** Fin de la bande : cible de dépôt (Bibliothèque) et ajout de fichiers. */
function StripEnd({ fileId, onFiles, onPicker, active }: { fileId: string; onFiles: (files: File[]) => void; onPicker: () => void; active: boolean }) {
  const t = useTranslations("projectEditor");
  const { setNodeRef } = useDroppable({ id: "strip-end" });
  return (
    <li ref={setNodeRef} className="a-strip-end" data-drop={active ? "before" : undefined}>
      <label htmlFor={fileId} className="a-strip-add">
        <span aria-hidden="true">+</span>
        {t("addMedia")}
      </label>
      <input
        id={fileId}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button type="button" className="a-btn a-btn-small" onClick={onPicker}>
        {t("fromLibrary")}
      </button>
    </li>
  );
}

const isLib = (id: string | number | undefined) => String(id ?? "").startsWith(LIB_PREFIX);

/** Glisser depuis la Bibliothèque : seulement sous le pointeur ; réordonner : le plus proche. */
const collision: CollisionDetection = (args) => (isLib(args.active.id) ? pointerWithin(args) : closestCenter(args));
/** Les emplacements ne bougent qu'à l'horizontale ; une vignette de la Bibliothèque, librement. */
const axis: Modifier = (args) => (args.active && isLib(args.active.id) ? args.transform : restrictToHorizontalAxis(args));

export default function ProjectEditor({ project, library, legacyFeatured }: { project: AdminProjectEdit; library: AdminMediaRow[]; legacyFeatured: { pageId: number; pageTitle: string }[] }) {
  const router = useRouter();
  const t = useTranslations("projectEditor");
  const queue = useUploadQueue();
  const [slots, setSlots] = useState(project.slots);
  const [source, setSource] = useState(project.slots);
  if (project.slots !== source) {
    setSource(project.slots);
    setSlots(project.slots);
  }
  const [selected, setSelected] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ slotId: number | "end" } | null>(null);
  // Projet tout juste créé (lot 111) : l'ajout d'images est proposé tout de suite (une seule fois).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const key = `pf-add-images-${project.id}`;
      if (sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        timer = setTimeout(() => setPicker({ slotId: "end" }), 0);
      }
    } catch {
      // Stockage refusé : rien n'est proposé.
    }
    return () => clearTimeout(timer);
  }, [project.id]);
  const [over, setOver] = useState(false);
  const [hint, setHint] = useState<DropHint>(null);
  const [dragging, setDragging] = useState<AdminMediaRow | null>(null);
  const refresh = useCallback(() => setTimeout(() => router.refresh(), 0), [router]);
  const origin = `planche-${project.id}`;
  const libraryRef = useRef<HTMLElement>(null);

  // Un média créé (où que l'on soit allé entre-temps) : planche et bandeau à jour.
  useEffect(() => queue.onMediaCreated(() => refresh()), [queue, refresh]);
  // Aperçus locaux des fichiers déposés sur la bande, tant que la vignette serveur n'existe pas.
  const previews: Record<number, string> = {};
  for (const i of queue.items) if (i.mediaId && i.preview) previews[i.mediaId] = i.preview;

  // Traitements en cours : la planche se met à jour dès qu'une image est prête.
  const processing = slots.filter((s) => s.media?.status === "processing").map((s) => s.media!.id);
  useMediaWatch(processing, (rows) => {
    if (rows.some((r) => r.status !== "processing")) refresh();
  });
  const reorder = (next: AdminSlot[]) => {
    const before = slots;
    setSlots(next);
    void reorderSlotsAction(project.id, next.map((s) => s.id)).then((r) => {
      if (!r.ok) {
        setSlots(before);
        toast(r.message, "error");
        return;
      }
      toast(t("orderSaved"));
      refresh();
    });
  };

  const addFiles = (files: File[], slotId?: number) =>
    queue.addFiles(files, { origin, target: slotId ? { kind: "slot", projectId: project.id, slotId } : { kind: "end", projectId: project.id } });

  const place = async (media: AdminMediaRow, target: { index: number } | { fill: number }) => {
    const r = "fill" in target ? await setSlotMediaAction(target.fill, media.id) : await addSlotsAction(project.id, [media.id], target.index);
    if (!r.ok) return toast(r.message, "error");
    toast("fill" in target ? t("placedInSlot") : t("placedAt", { position: target.index + 1 }));
    refresh();
  };

  // Fichiers déposés sur la bande : en attente à la fin, jusqu'à la création du média.
  const pending = queue.items.filter((i) => i.target.kind === "end" && i.target.projectId === project.id && !isUploaded(i) && i.phase !== "failed");
  // Des images arrivent en fin de planche : la bande défile pour les montrer.
  const plancheRef = useRef<HTMLDivElement>(null);
  const arriving = pending.length;
  useEffect(() => {
    const el = plancheRef.current;
    if (arriving > 0 && el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [arriving]);
  const selectedIndex = slots.findIndex((s) => s.id === selected);
  // Recherche par nom dans les images du projet (lot 67, CONC-13) : repère les trouvées, estompe les autres, amène la première.
  const [nameQuery, setNameQuery] = useState("");
  const needle = plain(nameQuery.trim());
  const matches = (s: AdminSlot, i: number) => !needle || plain(slotLabel(s, i, t)).includes(needle) || plain(s.media?.name ?? "").includes(needle);
  const foundCount = needle ? slots.filter(matches).length : 0;
  const firstFound = needle ? slots.find(matches)?.id : undefined;
  useEffect(() => {
    if (firstFound === undefined) return;
    document.querySelector(`[data-slot="${firstFound}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [firstFound]);
  // L'emplacement choisi reste visible : défilement de la bande (et, sous la
  // feuille du bas en mobile, de la page pour garder la bande au-dessus).
  useEffect(() => {
    if (selected === null) return;
    const node = plancheRef.current?.querySelector<HTMLElement>(`[data-slot="${selected}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    if (window.matchMedia("(max-width: 1099px)").matches) {
      plancheRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selected]);
  const current = selectedIndex >= 0 ? slots[selectedIndex] : null;
  const fileId = useId();
  const dndId = useId();

  /* ---- Glisser-déposer : réordonner la bande, ou placer depuis la Bibliothèque ---- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const labelOf = (id: string | number) => {
    if (isLib(id)) return `« ${library.find((m) => `${LIB_PREFIX}${m.id}` === String(id))?.name ?? t("mediaFallback")} »`;
    const i = slots.findIndex((s) => String(s.id) === String(id));
    return i >= 0 ? `« ${slotLabel(slots[i], i, t)} »` : t("itemFallback");
  };
  const pos = (id: string | number | undefined) => (id === undefined ? 0 : slots.findIndex((s) => String(s.id) === String(id)) + 1);
  const announcements: Announcements = {
    onDragStart: ({ active }) => (isLib(active.id) ? t("dragStartLibrary", { item: labelOf(active.id) }) : t("dragStart", { item: labelOf(active.id), position: pos(active.id), total: slots.length })),
    onDragOver: ({ active, over: o }) => (o ? t("dragOver", { item: labelOf(active.id), position: o.id === "strip-end" ? slots.length + 1 : pos(o.id) }) : t("dragOutside", { item: labelOf(active.id) })),
    onDragEnd: ({ active, over: o }) => (o ? t("dragDropped", { item: labelOf(active.id) }) : t("dragReturned", { item: labelOf(active.id) })),
    onDragCancel: ({ active }) => t("dragCancel", { item: labelOf(active.id) }),
  };
  /** Position visée par une vignette de la Bibliothèque. */
  const hintFor = (e: DragMoveEvent | DragEndEvent): DropHint => {
    const { active, over: o } = e;
    if (!o || !isLib(active.id)) return null;
    if (o.id === "strip-end") return { index: slots.length };
    const i = slots.findIndex((s) => String(s.id) === String(o.id));
    if (i < 0) return null;
    if (!slots[i].media) return { fill: slots[i].id };
    const r = active.rect.current.translated;
    const center = r ? r.left + r.width / 2 : 0;
    return { index: center < o.rect.left + o.rect.width / 2 ? i : i + 1 };
  };
  const hintOf = (s: AdminSlot, i: number): "before" | "after" | "fill" | undefined => {
    if (!hint) return undefined;
    if ("fill" in hint) return hint.fill === s.id ? "fill" : undefined;
    if (hint.index === i) return "before";
    if (hint.index === i + 1 && i === slots.length - 1) return "after";
    return undefined;
  };

  return (
    <div className="a-project-editor" data-panel={current ? "open" : undefined}>
      <ProjectMeta project={project} legacyFeatured={legacyFeatured} />

      <section className="a-panel a-planche-panel" aria-labelledby="pr-planche">
        <div className="a-panel-head">
          <h2 id="pr-planche">{t("layout")}</h2>
          <span className="muted">
            {t("slotCount", { count: slots.length })}
            {slots.some((s) => !s.media) && ` · ${t("emptyCount", { count: slots.filter((s) => !s.media).length })}`}
          </span>
        </div>
        <Uploader origin={origin} target={{ kind: "end", projectId: project.id }} libraryLabel={t("seeInLibrary")} onSeeLibrary={() => libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} />
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={collision}
          modifiers={[axis]}
          onDragStart={({ active }) => setDragging(isLib(active.id) ? ((active.data.current?.media as AdminMediaRow) ?? null) : null)}
          onDragMove={(e) => setHint(hintFor(e))}
          onDragCancel={() => {
            setHint(null);
            setDragging(null);
          }}
          onDragEnd={(e) => {
            const target = hintFor(e);
            setHint(null);
            setDragging(null);
            const { active, over: o } = e;
            if (isLib(active.id)) {
              const media = active.data.current?.media as AdminMediaRow | undefined;
              if (media && target) void place(media, target);
              return;
            }
            if (!o || active.id === o.id || o.id === "strip-end") return;
            const ids = slots.map((s) => String(s.id));
            reorder(arrayMove(slots, ids.indexOf(String(active.id)), ids.indexOf(String(o.id))));
          }}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: t("dragInstructions"),
            },
          }}
        >
          {slots.length >= SEARCH_FROM && (
            <div className="a-slot-search">
              <label>
                <span className="sr-only">{t("searchImage")}</span>
                <input className="a-input" type="search" aria-label={t("searchImage")} placeholder={t("searchPlaceholder")} value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
              </label>
              {needle && (
                <span className="muted" role="status">
                  {foundCount > 0 ? t("foundCount", { count: foundCount }) : t("noneFound")}
                </span>
              )}
            </div>
          )}
          <p className="a-help a-panel-intro">
            {t("planchIntro")}
          </p>
          <div
            ref={plancheRef}
            className="a-planche"
            data-over={over || undefined}
            onDragOver={(e) => {
              if (!hasFiles(e.dataTransfer)) return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
            }}
            onDrop={(e) => {
              if (!hasFiles(e.dataTransfer)) return;
              e.preventDefault();
              setOver(false);
              addFiles([...e.dataTransfer.files]);
            }}
          >
            <SortableItems
              items={slots}
              getId={(s) => String(s.id)}
              getLabel={(s) => slotLabel(s, slots.indexOf(s), t)}
              layout="horizontal"
              className="a-strip"
              itemStyle={(s) => ({ width: Math.round(STRIP_H * ratioOf(s)) })}
              render={(s, i) => (
                <SlotTile
                  slot={s}
                  index={i}
                  selected={selected === s.id}
                  preview={s.media ? previews[s.media.id] : undefined}
                  hint={hintOf(s, i)}
                  match={needle ? (matches(s, i) ? "found" : "dim") : undefined}
                  onOpen={() => setSelected(s.id)}
                  onFiles={(files) => void addFiles(files, s.id)}
                  onLibrary={() => setPicker({ slotId: s.id })}
                />
              )}
              after={
                <>
                  {pending.map((item) => (
                    <PendingTile key={item.key} item={item} />
                  ))}
                  <StripEnd
                    fileId={fileId}
                    onFiles={(files) => addFiles(files)}
                    onPicker={() => setPicker({ slotId: "end" })}
                    active={Boolean(hint && "index" in hint && hint.index === slots.length && slots.length === 0)}
                  />
                </>
              }
            />
          </div>
          <LibraryStrip regionRef={libraryRef} media={library} onAddEnd={(m) => void place(m, { index: slots.length })} />
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="a-libthumb-overlay" style={dragging.color ? { backgroundColor: dragging.color } : undefined}>
                {dragging.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={dragging.thumb} alt="" />
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        <p className="a-help">
          <Link href={`/fr`} target="_blank" rel="noopener">
            {t("seeSite")}
          </Link>{" "}
          · {t("processingNote")}
        </p>
      </section>

      {current && (
        <SlotPanel
          key={current.id}
          slot={current}
          index={selectedIndex}
          onClose={() => setSelected(null)}
          onReplaceFile={(files) => void addFiles(files, current.id)}
          onLibrary={() => setPicker({ slotId: current.id })}
        />
      )}

      <MediaPickerDialog
        open={picker !== null}
        media={library}
        title={picker?.slotId === "end" ? t("pickerAdd") : t("pickerChoose")}
        onClose={() => setPicker(null)}
        onPick={async (m) => {
          const target = picker?.slotId;
          setPicker(null);
          const r = target === "end" ? await addSlotsAction(project.id, [m.id]) : await setSlotMediaAction(target, m.id);
          if (!r.ok) return toast(r.message, "error");
          toast(target === "end" ? t("imageAdded") : t("imagePlaced"));
          refresh();
        }}
      />
    </div>
  );
}
