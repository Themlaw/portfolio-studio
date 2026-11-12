"use client";

/**
 * Réglages d'un composant de la planche d'un projet (lot 31), dans l'onglet Réglages de l'éditeur : les
 * mêmes formulaires que pour la rubrique du même type sur une page (Grille, Image, Vidéo, Texte), branchés
 * sur le contenu de la planche (qui appartient au projet) au lieu de la page. La bande « Images qui
 * défilent » n'a pas de réglage : ses images se gèrent sur la planche.
 */
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { BlockEditorContext } from "@/blocks/editor-context";
import { GridAdvanced, GridTop } from "@/blocks/editors";
import type { EditorContext } from "@/blocks/editor-types";
import { Select } from "@/app/admin/_fields";
import { applyGridOp, type GridModelOp } from "@/blocks/grid-layouts";
import { BOX_ALIGNS, BOX_MIN, BOX_PRESETS, MAX_GRID_CHILDREN, MAX_RAIL_MEDIA, railIds, railList, type BoardBox, type BoardItemType } from "@/blocks/board-layout";
import { cleanLook, readLook } from "@/lib/look";

import { BlockLookPanel, ImageSizeSection, SpaceTopSection } from "./LookPanel";
import { StrokeField } from "./StrokeField";
import { MediaPickerDialog } from "@/components/admin/MediaLibrary";
import { modeOf, videoModeOptions } from "@/blocks/video-mode";
import { soundOf, videoSoundOptions } from "@/blocks/video-sound";

type Props = Record<string, unknown>;
type Kid = { uid: string; type: "image" | "video-single"; props: Props };

let n = 0;
const kidUid = () => `g${Date.now().toString(36)}${(++n).toString(36)}`;

/**
 * Images et vidéos d'une grille de planche, dans l'ordre des cases (lot 31d : mêmes opérations que la barre de la grille sur la
 * toile, `applyGridOp`). Chaque case : sa vignette, Remplacer, monter / descendre, retirer, et « Dans la case » pour une image.
 */
function GridContent({ props, onChange, context }: { props: Props; onChange: (next: Props) => void; context: EditorContext }) {
  const t = useTranslations("editorPanelsBoard");
  const tl = useTranslations("blockRegLabels");
  const kids = (Array.isArray(props.children) ? props.children : []) as Kid[];
  const [picking, setPicking] = useState<{ index: number; kind: "image" | "video" } | null>(null);
  const apply = (op: GridModelOp) => {
    const res = applyGridOp(props, op);
    if (!("error" in res)) onChange(res.props);
  };
  const setKid = (i: number, patch: (p: Props) => Props) => onChange({ ...props, children: kids.map((k, j) => (j === i ? { ...k, props: patch(k.props) } : k)) });
  return (
    <section className="ve-board-kids" aria-label={t("gridContent")}>
      <h3 className="a-subhead">{t("gridTitle")}</h3>
      {kids.length === 0 && <p className="ve-hint">{t("gridEmpty")}</p>}
      <ol className="ve-board-kid-list">
        {kids.map((k, i) => {
          const m = context.media.find((x) => x.id === k.props.mediaId);
          return (
            <li key={k.uid} data-media-id={k.props.mediaId as number | undefined}>
              <span className="ve-board-kid-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="a-media-field-thumb">{m?.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.thumb} alt="" /> : <span className="muted">{t("empty")}</span>}</span>
              <span className="a-media-field-name">{m?.name ?? (k.type === "video-single" ? t("videoToPick") : t("imageToPick"))}</span>
              <div className="ve-board-kid-tools" role="group" aria-label={t("cell", { n: i + 1 })}>
                <button type="button" className="a-btn a-btn-small" data-testid={`board-grid-replace-${i}`} onClick={() => setPicking({ index: i, kind: k.type === "video-single" ? "video" : "image" })}>
                  {t("replace")}
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("up")} disabled={i === 0} onClick={() => apply({ op: "move", from: i, to: i - 1 })}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("down")} disabled={i === kids.length - 1} onClick={() => apply({ op: "move", from: i, to: i + 1 })}>
                  ↓
                </button>
                <button type="button" className="a-icon-btn a-danger-text" aria-label={t("remove")} onClick={() => apply({ op: "remove", index: i })}>
                  ✕
                </button>
              </div>
              {k.type === "video-single" && (
                <Select
                  label={t("playback")}
                  help={tl(`videoMode.hint.${modeOf(k.props)}`)}
                  value={modeOf(k.props)}
                  options={videoModeOptions(tl)}
                  onChange={(v) => setKid(i, (p) => ({ ...p, mode: v ?? "player" }))}
                />
              )}
              {k.type === "video-single" && m?.hasAudio !== false && (
                // Son au départ (lot 127) : seulement pour une vidéo qui a du son ; « Activé » retire le champ.
                <Select
                  label={t("startSound")}
                  help={tl(`videoSound.hint.${soundOf(k.props)}`)}
                  value={soundOf(k.props)}
                  options={videoSoundOptions(tl)}
                  onChange={(v) => setKid(i, (p) => (v === "off" ? { ...p, sound: "off" } : (({ sound: _s, ...rest }) => (void _s, rest))(p)))}
                />
              )}
              {k.type === "image" && (
                <Select
                  label={t("inCell")}
                  help={t("inCellHelp")}
                  value={(k.props.fit as string | undefined) ?? "auto"}
                  options={[
                    { value: "auto", label: t("fitAuto") },
                    { value: "contain", label: t("fitContain") },
                    { value: "cover", label: t("fitCover") },
                  ]}
                  onChange={(v) =>
                    setKid(i, (p) => {
                      const { fit: _f, ...rest } = p;
                      void _f;
                      return v && v !== "auto" ? { ...rest, fit: v } : rest;
                    })
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="ve-board-kid-add">
        <button type="button" className="a-btn" disabled={kids.length >= MAX_GRID_CHILDREN} data-testid="board-grid-add-image" onClick={() => setPicking({ index: kids.length, kind: "image" })}>
          {t("addImage")}
        </button>
        <button type="button" className="a-btn" disabled={kids.length >= MAX_GRID_CHILDREN} data-testid="board-grid-add-video" onClick={() => setPicking({ index: kids.length, kind: "video" })}>
          {t("addVideo")}
        </button>
      </div>
      <MediaPickerDialog
        open={picking !== null}
        media={context.media.filter((m) => m.kind === (picking?.kind ?? "image"))}
        title={picking?.kind === "video" ? t("pickVideo") : t("pickImage")}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          const at = picking;
          setPicking(null);
          if (!at) return;
          const video = m.kind === "video";
          apply({
            op: "put",
            index: at.index,
            child: { uid: kidUid(), type: video ? "video-single" : "image", props: video ? { variant: "card", mode: "player", mediaId: m.id } : { width: "wide", mediaId: m.id } },
          });
        }}
      />
    </section>
  );
}

const ALIGN_KEYS = { left: "alignLeft", center: "alignCenter", right: "alignRight" } as const;

/** Pictogramme d'alignement : une colonne claire posée à gauche, au centre ou à droite d'un cadre. */
function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const x = align === "left" ? 3 : align === "center" ? 9 : 15;
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
      <rect x="1" y="1" width="22" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x={x} y="4" width="6" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Largeur et alignement : UN seul bloc pour tous les composants de la planche (lot 31b). Préréglages (Petite,
 * Moyenne, Grande, Pleine largeur), curseur fin de 20 à 100 %, et Gauche / Centre / Droite (utile quand le composant
 * ne prend pas toute la largeur). Sans réglage : le rendu d'avant. Sur téléphone, le composant reprend toute la largeur.
 */
function BoxField({ box, onChange }: { box: BoardBox | undefined; onChange: (next: BoardBox | null) => void }) {
  const t = useTranslations("editorPanelsBoard");
  const tl = useTranslations("blockRegLabels");
  const width = box?.width ?? 100;
  const align = box?.align ?? "center";
  const apply = (w: number, a = box?.align) => onChange(w >= 100 && !a ? null : { width: w, ...(a ? { align: a } : {}) });
  return (
    <section className="ve-box-field" aria-label={t("boxTitle")} data-testid="box-field">
      <h3 className="a-subhead">{t("boxTitle")}</h3>
      <div className="ve-box-presets" role="radiogroup" aria-label={t("width")}>
        {BOX_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={width === p.width} data-preset={p.id} className="a-btn a-btn-small" onClick={() => apply(p.width)}>
            {tl(`boxPreset.${p.id}`)}
          </button>
        ))}
      </div>
      <label className="ve-box-range">
        <span>{t("fine", { width })}</span>
        <input type="range" min={BOX_MIN} max={100} step={1} value={width} data-testid="box-width" onChange={(e) => apply(Number(e.target.value))} />
      </label>
      <div className="ve-box-aligns" role="radiogroup" aria-label={t("alignment")}>
        {BOX_ALIGNS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={align === a} aria-label={t(ALIGN_KEYS[a])} title={t(ALIGN_KEYS[a])} data-align={a} className="a-icon-btn" onClick={() => apply(width, a)}>
            <AlignIcon align={a} />
          </button>
        ))}
      </div>
      <p className="a-help">{width >= 100 ? t("boxFull") : t("boxPhone")}</p>
    </section>
  );
}

/** Carrousel à liste propre : ses images et vidéos, choisies dans la médiathèque, dans l'ordre. */
function RailContent({ props, onChange, context }: { props: Props; onChange: (next: Props) => void; context: EditorContext }) {
  const t = useTranslations("editorPanelsBoard");
  const ids = railList(props);
  const keys = railIds(props);
  const [adding, setAdding] = useState<"image" | "video" | null>(null);
  // La liste et l'identité de ses places avancent ensemble (réglages d'arrondi et de cadre suivent la place).
  const set = (next: (number | null)[], nextKeys: string[]) => onChange({ ...props, media: next, ids: nextKeys });
  const move = (i: number, d: -1 | 1) => {
    const next = ids.slice();
    const nextKeys = keys.slice();
    const [k] = next.splice(i, 1);
    const [kk] = nextKeys.splice(i, 1);
    next.splice(i + d, 0, k);
    nextKeys.splice(i + d, 0, kk);
    set(next, nextKeys);
  };
  return (
    <section className="ve-board-kids" aria-label={t("railContent")}>
      <h3 className="a-subhead">{t("railTitle")}</h3>
      <p className="ve-hint">{t("railHint")}</p>
      {ids.length === 0 && <p className="ve-hint">{t("railEmpty")}</p>}
      <ol className="ve-board-kid-list">
        {ids.map((id, i) => {
          const m = id === null ? undefined : context.media.find((x) => x.id === id);
          return (
            <li key={`${id}-${i}`} {...(id !== null ? { "data-media-id": id } : { "data-place-empty": "" })}>
              <span className="a-media-field-thumb">{id === null ? <span className="muted">{t("empty")}</span> : m?.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.thumb} alt="" /> : <span className="muted">{t("mediaNo", { id })}</span>}</span>
              <span className="a-media-field-name">{id === null ? t("keptPlace") : (m?.name ?? t("mediaFallback", { id }))}</span>
              <div className="ve-board-kid-tools" role="group" aria-label={t("element", { n: i + 1 })}>
                <button type="button" className="a-icon-btn" aria-label={t("up")} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label={t("down")} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="a-icon-btn a-danger-text" aria-label={t("remove")} onClick={() => set(ids.filter((_, j) => j !== i), keys.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="ve-board-kid-add">
        <button type="button" className="a-btn" disabled={ids.length >= MAX_RAIL_MEDIA} data-testid="board-rail-add-image" onClick={() => setAdding("image")}>
          {t("addImage")}
        </button>
        <button type="button" className="a-btn" disabled={ids.length >= MAX_RAIL_MEDIA} data-testid="board-rail-add-video" onClick={() => setAdding("video")}>
          {t("addVideo")}
        </button>
      </div>
      <MediaPickerDialog
        open={adding !== null}
        media={context.media.filter((m) => m.kind === (adding ?? "image"))}
        title={adding === "video" ? t("addVideoTitle") : t("addImageTitle")}
        onClose={() => setAdding(null)}
        onPick={(m) => {
          set([...ids, m.id], [...keys, `n${Math.random().toString(36).slice(2, 10)}`.slice(0, 12).replace(/[^a-z0-9]/g, "x")]);
          setAdding(null);
        }}
      />
    </section>
  );
}

/**
 * « Afficher en : Grille / Images qui défilent » (lot 69) : la même suite d'images en grille ou en carrousel, sans rien recopier.
 * Seule une grille, ou des images qui défilent à liste propre, peuvent changer de forme (la bande des images du projet, non).
 */
function ConvertField({ type, onConvert }: { type: BoardItemType; onConvert: (to: "grid" | "strip") => void }) {
  const t = useTranslations("editorPanelsBoard");
  return (
    <section className="ve-box-field" aria-label={t("convertTitle")} data-testid="convert-field">
      <h3 className="a-subhead">{t("convertTitle")}</h3>
      <div className="ve-box-presets" role="radiogroup" aria-label={t("convertTitle")}>
        {(
          [
            ["grid", t("convertGrid")],
            ["strip", t("convertStrip")],
          ] as const
        ).map(([to, label]) => (
          <button key={to} type="button" role="radio" aria-checked={type === to} data-convert={to} className="a-btn a-btn-small" onClick={() => type !== to && onConvert(to)}>
            {label}
          </button>
        ))}
      </div>
      <p className="a-help">{t("convertHelp")}</p>
    </section>
  );
}

export default function BoardItemPanel({
  type,
  props,
  box,
  onChange,
  onBox,
  onConvert,
  context,
  editor,
  uid,
  head,
}: {
  type: BoardItemType;
  props: Props;
  box: BoardBox | undefined;
  onChange: (next: Props) => void;
  onBox: (next: BoardBox | null) => void;
  /** Passe la grille en images qui défilent, ou l'inverse (la planche et la rubrique de la page sont mises à jour par l'éditeur). */
  onConvert: (to: "grid" | "strip") => void;
  context: EditorContext;
  /** Formulaire du type (registre), le même que sur une page. */
  editor: ReactNode;
  uid: string;
  /** Barre du haut (monter, descendre, supprimer…). */
  head: ReactNode;
}) {
  const t = useTranslations("editorPanelsBoard");
  const tl = useTranslations("blockRegLabels");
  const projectStrip = type === "strip" && props.source !== "own";
  return (
    <div className="ve-settings" data-testid="board-item-panel" data-type={type}>
      <header className="ve-settings-head">
        <h2>{tl(`boardItem.label.${type.replace(/[^A-Za-z0-9_]/g, "_")}`)}</h2>
        {head}
      </header>
      <p className="ve-hint">{t("belongs")}</p>
      {projectStrip && <p className="ve-hint">{t("projectStrip")}</p>}
      {(type === "grid" || (type === "strip" && !projectStrip)) && <ConvertField type={type} onConvert={onConvert} />}
      {/* Grille : l'essentiel en haut (agencement, espace, format, nombre d'images), puis la liste des cases, puis les réglages avancés. */}
      {type === "grid" && (
        <BlockEditorContext.Provider value={{ value: props, onChange, errors: {}, context, idPrefix: `ve-bitem-${uid}` }}>
          <GridTop />
          <GridContent props={props} onChange={onChange} context={context} />
          <GridAdvanced />
        </BlockEditorContext.Provider>
      )}
      {type === "image" && (
        <ImageSizeSection
          look={readLook(props.look) ?? {}}
          onChange={(next) => {
            const clean = cleanLook(next);
            const { look: _old, ...rest } = props;
            void _old;
            onChange(clean ? { ...rest, look: clean } : rest);
          }}
        />
      )}
      {type === "strip" && !projectStrip && <RailContent props={props} onChange={onChange} context={context} />}
      {type !== "strip" && type !== "grid" && <BlockEditorContext.Provider value={{ value: props, onChange, errors: {}, context, idPrefix: `ve-bitem-${uid}` }}>{editor}</BlockEditorContext.Provider>}
      <BoxField box={box} onChange={onBox} />
      {type === "strip" && (
        <SpaceTopSection
          look={readLook(props.look) ?? {}}
          onChange={(next) => {
            const clean = cleanLook(next);
            const { look: _old, ...rest } = props;
            void _old;
            onChange(clean ? { ...rest, look: clean } : rest);
          }}
        />
      )}
      {type === "strip" && (
        <StrokeField
          title={t("stroke")}
          help={t("strokeHelp")}
          value={props.stroke}
          testid="rail-stroke"
          onChange={(tint) => {
            const { stroke: _old, ...rest } = props;
            void _old;
            onChange(tint ? { ...rest, stroke: tint } : rest);
          }}
        />
      )}
      {type !== "strip" && <BlockLookPanel
        key={uid}
        type={type}
        look={readLook(props.look) ?? {}}
        inCell={false}
        onChange={(next) => {
          const clean = cleanLook(next);
          const { look: _old, ...rest } = props;
          void _old;
          onChange(clean ? { ...rest, look: clean } : rest);
        }}
      />}
    </div>
  );
}
