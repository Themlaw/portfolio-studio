"use client";

/**
 * Éditeur de projet : informations (enregistrées avec « Enregistrer »), puis la
 * planche, qui ressemble à la planche publique : bande d'emplacements à hauteur
 * fixe, chacun au ratio de son image. Les gestes de la planche (déposer des
 * fichiers, réordonner, retirer, supprimer) sont des actions immédiates,
 * annoncées (toast + aria-live) ; les textes d'un emplacement se modifient dans
 * le panneau et s'enregistrent avec son bouton.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { MediaPickerDialog, UploadList } from "./MediaLibrary";
import { DragHandle, SortableList } from "./Sortable";
import { ACCEPT, formatSent, hasFiles, useMediaWatch, useUploadQueue, type UploadItem } from "./uploads";
import { formatDuration, isLoop } from "@/lib/video/limits";

const STRIP_H = 180;
const COLLECTIONS = [
  { value: "characters" as const, label: "Personnages" },
  { value: "backgrounds" as const, label: "Décors" },
  { value: "animation" as const, label: "Animation" },
];

/** Ratio de la place : celui de l'image, sinon celui de la dernière image retirée, sinon 4:3. */
const ratioOf = (slot: AdminSlot) => (slot.media?.width && slot.media.height ? slot.media.width / slot.media.height : (slot.aspect ?? 4 / 3));

/** Titre proposé d'après le nom du fichier (jamais publié sans ton accord). */
export function suggestTitle(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toLocaleUpperCase("fr-FR") + base.slice(1) : "";
}
const slotLabel = (slot: AdminSlot, index: number) => slot.title.fr.trim() || `Emplacement ${index + 1}`;

/* ---- Informations du projet ------------------------------------------------- */

type Meta = Pick<AdminProjectEdit, "title" | "context" | "description" | "year" | "featured">;

function ProjectMeta({ project }: { project: AdminProjectEdit }) {
  const router = useRouter();
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
      <h2 id="pr-infos">Informations</h2>
      <div className="a-form-grid">
        <TextI18n label="Titre" value={meta.title} onChange={(v) => set("title", v)} error={errorAt(errors, "title")} />
        <TextI18n label="Contexte" help="Nature du projet et ton rôle (ex. Court métrage · Character design)." value={meta.context} onChange={(v) => set("context", v)} error={errorAt(errors, "context")} />
        <TextareaI18n label="Description" value={meta.description} onChange={(v) => set("description", v)} error={errorAt(errors, "description")} />
        <div>
          <TextField label="Année ou période" help="Affichée telle quelle (ex. 2023–2024)." value={meta.year} onChange={(v) => set("year", v)} error={errors.year} />
          <Toggle label="Mis en avant" help="Proposé en premier par le bloc « Projets mis en avant »." checked={meta.featured} onChange={(v) => set("featured", v)} />
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
            setSaved(clone(meta));
            toast("Projet enregistré");
            setTimeout(() => router.refresh(), 0);
          })
        }
      />
    </section>
  );
}

/* ---- Emplacement ------------------------------------------------------------- */

function SlotTile({
  slot,
  index,
  selected,
  preview,
  onOpen,
  onFiles,
  onLibrary,
}: {
  slot: AdminSlot;
  index: number;
  selected: boolean;
  preview?: string;
  onOpen: () => void;
  onFiles: (files: File[]) => void;
  onLibrary: () => void;
}) {
  const [over, setOver] = useState(false);
  const media = slot.media;
  const label = slotLabel(slot, index);
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
      <div className="a-slot a-slot-empty" data-slot={slot.id} data-over={over || undefined} data-selected={selected || undefined} {...dropProps}>
        <div className="a-slot-bar">
          <DragHandle />
          <button type="button" className="a-slot-open" onClick={onOpen} aria-label={`Modifier ${label} (vide)`}>
            {label}
          </button>
        </div>
        <p>Dépose une image ici</p>
        <button type="button" className="a-btn a-btn-small" onClick={onLibrary}>
          Choisir dans la médiathèque
        </button>
      </div>
    );
  }
  const src = media.thumb ?? preview;
  return (
    <div className="a-slot" data-slot={slot.id} data-status={media.status} data-over={over || undefined} data-selected={selected || undefined} {...dropProps}>
      <button type="button" className="a-slot-image" onClick={onOpen} aria-label={`Modifier ${label}`} style={media.color ? { backgroundColor: media.color } : undefined}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" />
        )}
        {media.kind === "video" && media.status === "ready" && (
          <span className="a-duration-badge">
            <span aria-hidden="true">▶ </span>
            {formatDuration(media.duration)}
            {isLoop(media) && " · boucle"}
          </span>
        )}
        {media.status !== "ready" && (
          <span className="a-slot-overlay">
            {media.status === "processing" ? (
              <>
                <span>{media.kind === "video" ? (media.progress ? `Conversion… ${media.progress} %` : "Conversion en attente…") : "Traitement…"}</span>
                <span className="a-progress" aria-hidden="true">
                  <span data-indeterminate style={{ width: "100%" }} />
                </span>
              </>
            ) : (
              <span>Échec : remplace l&apos;image</span>
            )}
          </span>
        )}
      </button>
      <div className="a-slot-bar">
        <DragHandle />
        <span className="a-slot-title">{label}</span>
        {!media.alt.fr.trim() && media.status === "ready" && (
          <span className="a-slot-warn" title="Texte alternatif manquant">
            alt
          </span>
        )}
      </div>
    </div>
  );
}

function PendingTile({ item }: { item: UploadItem }) {
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
                    ? "En attente"
                    : item.phase === "uploading"
                      ? item.total && item.total > 8 * 1024 * 1024
                        ? `Envoi ${formatSent(item.sent, item.total)}`
                        : `Envoi ${Math.round(item.progress * 100)} %`
                      : item.video
                        ? "Conversion…"
                        : "Traitement…"}
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
  const label = slotLabel(slot, index);
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
      toast("Emplacement enregistré");
      setTimeout(() => router.refresh(), 0);
    });

  return (
    <aside className="a-sidepanel a-slot-panel" aria-labelledby="sp-title">
      <div className="a-sidepanel-head">
        <h2 id="sp-title">{label}</h2>
        <button type="button" className="a-icon-btn" aria-label="Fermer le panneau" onClick={onClose}>
          ✕
        </button>
      </div>
      {slot.media?.status === "failed" && <p className="a-alert">{slot.media.error}</p>}
      <TextI18n
        label="Titre"
        help="Sous l'image et dans la visionneuse. Sans titre, seule l'année s'affiche."
        value={form.title}
        onChange={(v) => set("title", v)}
        error={errorAt(errors, "title")}
      />
      {!form.title.fr.trim() && slot.media && suggestTitle(slot.media.name) && (
        <p className="a-suggest">
          <button type="button" className="a-btn a-btn-small" onClick={() => set("title", { fr: suggestTitle(slot.media!.name), en: form.title.en || suggestTitle(slot.media!.name) })}>
            Titre suggéré : {suggestTitle(slot.media.name)}
          </button>
        </p>
      )}
      <TextareaI18n label="Description" value={form.description} onChange={(v) => set("description", v)} error={errorAt(errors, "description")} />
      <div className="a-form-grid">
        <Select label="Collection" value={form.collection} options={COLLECTIONS} onChange={(v) => v && set("collection", v)} error={errors.collection} />
        <Field label="Année" error={errors.year} htmlFor={`${fileId}-year`}>
          <input id={`${fileId}-year`} className="a-input" type="number" min={1900} max={2200} value={form.year} onChange={(e) => set("year", Number(e.target.value))} />
        </Field>
      </div>
      <Toggle label="Mis en avant" checked={form.featured} onChange={(v) => set("featured", v)} />
      {slot.media && (
        <>
          <TextI18n
            label="Texte alternatif de l'image"
            help="Décris l'image pour qui ne la voit pas. Commun à tous les emplacements qui montrent cette image."
            value={form.alt}
            onChange={(v) => set("alt", v)}
            error={errorAt(errors, "alt")}
          />
          {!form.alt.fr.trim() && <p className="a-notice">Texte alternatif manquant : le titre sera lu à la place.</p>}
        </>
      )}
      <div className="a-panel-actions">
        <span className="a-save-state" aria-live="polite">
          {dirty ? (
            <>
              <span className="a-dot" aria-hidden="true" /> Non enregistré
            </>
          ) : (
            <>
              <span aria-hidden="true">✓</span> Enregistré
            </>
          )}
        </span>
        <button type="button" className="a-btn a-btn-primary" disabled={!dirty || busy} onClick={save}>
          Enregistrer
        </button>
      </div>

      <h3 className="a-subhead">Image</h3>
      <div className="a-panel-buttons">
        <label htmlFor={fileId} className="a-btn a-file-btn">
          {slot.media ? "Remplacer l'image" : "Envoyer une image"}
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
          Choisir dans la médiathèque
        </button>
        {slot.media && (
          <button type="button" className="a-btn a-btn-quiet a-danger-text" onClick={() => setConfirm("remove")}>
            Retirer l&apos;image
          </button>
        )}
      </div>
      <div className="a-panel-danger">
        <button type="button" className="a-btn a-btn-quiet a-danger-text" onClick={() => setConfirm("delete")}>
          Supprimer l&apos;emplacement
        </button>
      </div>

      <ConfirmDialog
        open={confirm === "remove"}
        title={`Retirer l'image de « ${label} » ?`}
        confirmLabel="Retirer l'image"
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r = await setSlotMediaAction(slot.id, null);
            if (!r.ok) return toast(r.message, "error");
            setConfirm(null);
            toast("Image retirée · l'emplacement garde sa place");
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        <p className="muted">L&apos;emplacement reste sur la planche, vide (invisible sur le site). L&apos;image reste dans la médiathèque.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Supprimer l'emplacement « ${label} » ?`}
        confirmLabel="Supprimer l'emplacement"
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteSlotAction(slot.id);
            if (!r.ok) return toast(r.message, "error");
            setConfirm(null);
            toast("Emplacement supprimé");
            onClose();
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        <p className="muted">Son titre et sa description sont perdus. L&apos;image reste dans la médiathèque.</p>
      </ConfirmDialog>
    </aside>
  );
}

/* ---- Planche ----------------------------------------------------------------- */

export default function ProjectEditor({ project, library }: { project: AdminProjectEdit; library: AdminMediaRow[] }) {
  const router = useRouter();
  const [slots, setSlots] = useState(project.slots);
  const [source, setSource] = useState(project.slots);
  if (project.slots !== source) {
    setSource(project.slots);
    setSlots(project.slots);
  }
  const [selected, setSelected] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ slotId: number | "end" } | null>(null);
  const [over, setOver] = useState(false);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const refresh = useCallback(() => setTimeout(() => router.refresh(), 0), [router]);

  const uploads = useUploadQueue(async (item, mediaId, api) => {
    if (item.preview) setPreviews((p) => ({ ...p, [mediaId]: item.preview! }));
    const r = item.target === "end" || item.target === undefined ? await addSlotsAction(project.id, [mediaId]) : await setSlotMediaAction(item.target, mediaId);
    if (!r.ok) {
      api.patch(item.key, { phase: "failed", message: r.message });
      return;
    }
    api.remove(item.key);
    refresh();
  });

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
      toast("Ordre de la planche enregistré");
      refresh();
    });
  };

  const pending = uploads.items.filter((i) => i.target === "end" && i.phase !== "ready");
  // Des images arrivent en fin de planche : la bande défile pour les montrer.
  const plancheRef = useRef<HTMLDivElement>(null);
  const arriving = pending.length;
  useEffect(() => {
    const el = plancheRef.current;
    if (arriving > 0 && el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [arriving]);
  const selectedIndex = slots.findIndex((s) => s.id === selected);
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

  return (
    <div className="a-project-editor" data-panel={current ? "open" : undefined}>
      <ProjectMeta project={project} />

      <section className="a-panel a-planche-panel" aria-labelledby="pr-planche">
        <div className="a-panel-head">
          <h2 id="pr-planche">Planche</h2>
          <span className="muted">
            {slots.length} emplacement{slots.length > 1 ? "s" : ""}
            {slots.some((s) => !s.media) && ` · ${slots.filter((s) => !s.media).length} vide${slots.filter((s) => !s.media).length > 1 ? "s" : ""} (masqué${slots.filter((s) => !s.media).length > 1 ? "s" : ""} sur le site)`}
          </span>
        </div>
        <p className="a-help a-panel-intro">
          Dépose des images ou des vidéos sur la bande pour les ajouter à la fin, ou sur un emplacement vide pour le remplir. Fais glisser par la poignée
          pour réordonner (clavier : Espace, flèches gauche et droite, Espace). Clique sur une image pour la modifier.
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
            void uploads.add([...e.dataTransfer.files], "end");
          }}
        >
          <SortableList
            items={slots}
            getId={(s) => String(s.id)}
            getLabel={(s) => slotLabel(s, slots.indexOf(s))}
            onReorder={reorder}
            layout="horizontal"
            className="a-strip"
            itemStyle={(s) => ({ width: Math.round(STRIP_H * ratioOf(s)) })}
            render={(s, i) => (
              <SlotTile
                slot={s}
                index={i}
                selected={selected === s.id}
                preview={s.media ? previews[s.media.id] : undefined}
                onOpen={() => setSelected(s.id)}
                onFiles={(files) => void uploads.add(files, s.id)}
                onLibrary={() => setPicker({ slotId: s.id })}
              />
            )}
            after={
              <>
                {pending.map((item) => (
                  <PendingTile key={item.key} item={item} />
                ))}
                <li className="a-strip-end">
                  <label htmlFor={fileId} className="a-strip-add">
                    <span aria-hidden="true">+</span>
                    Ajouter des images ou vidéos
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
                      if (files.length) void uploads.add(files, "end");
                    }}
                  />
                  <button type="button" className="a-btn a-btn-small" onClick={() => setPicker({ slotId: "end" })}>
                    Depuis la médiathèque
                  </button>
                </li>
              </>
            }
          />
        </div>
        <UploadList items={uploads.items.filter((i) => i.phase === "failed")} onDismiss={uploads.remove} />
        <p className="a-help">
          <Link href={`/fr`} target="_blank" rel="noopener">
            Voir le site ↗
          </Link>{" "}
          · les images en traitement apparaissent sur le site dès qu&apos;elles sont prêtes.
        </p>
      </section>

      {current && (
        <SlotPanel
          key={current.id}
          slot={current}
          index={selectedIndex}
          onClose={() => setSelected(null)}
          onReplaceFile={(files) => void uploads.add(files, current.id)}
          onLibrary={() => setPicker({ slotId: current.id })}
        />
      )}

      <MediaPickerDialog
        open={picker !== null}
        media={library}
        title={picker?.slotId === "end" ? "Ajouter une image de la médiathèque" : "Choisir l'image de cet emplacement"}
        onClose={() => setPicker(null)}
        onPick={async (m) => {
          const target = picker?.slotId;
          setPicker(null);
          const r = target === "end" ? await addSlotsAction(project.id, [m.id]) : await setSlotMediaAction(target, m.id);
          if (!r.ok) return toast(r.message, "error");
          toast(target === "end" ? "Image ajoutée à la planche" : "Image placée");
          refresh();
        }}
      />
    </div>
  );
}
