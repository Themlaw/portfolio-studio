"use client";

/**
 * Mise en page directement sur la toile (lot 2), dans le calque de la couche
 * d'édition (EditLayer) :
 *
 * - poignées d'espacement en haut / en bas du bloc choisi (glisser, aimantées
 *   aux crans du thème Auto · Aucun · S · M · L · XL ; flèches au clavier) ;
 * - barre typographique de tout texte éditable (« Aa » au survol, ou pendant
 *   la saisie) : ce texte (props.look du bloc) ou tous les textes de son rôle
 *   (styles du site, brouillon du site) ;
 * - position du titre (pictogrammes), fond du métier de l'ouverture ;
 * - « Cadrer » une image qui n'a pas le format de son emplacement : zone gardée
 *   claire, le reste grisé ; souris (glisser, molette) et clavier.
 *
 * La couche n'écrit rien : elle envoie l'intention (`look`, `site-style`) à
 * l'éditeur, qui valide, enregistre le brouillon et rafraîchit la toile. Un
 * aperçu immédiat est posé sur le DOM en attendant, et y reste (optimistic.ts)
 * jusqu'à ce que le serveur ait rendu une révision au moins aussi récente :
 * jamais d'affichage intermédiaire de l'ancienne valeur.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import FreeCropDialog from "@/components/edit/FreeCropDialog";
import HeroContrast from "@/components/edit/HeroContrast";
import { acceptToCanvas } from "@/lib/edit/protocol";
import { type Rect as CropRect } from "@/lib/images/crop";
import { parseRatio } from "@/lib/images/sizes";
import {
  BACKDROP_BLOCKED,
  cleanLook,
  cropFromWindow,
  cropWindow,
  googleOf,
  needsCrop,
  readLook,
  ROLE_LABELS,
  SPACE_LABELS,
  textStyleDecls,
  siteStylesCss,
  SiteStylesSchema,
  type Crop,
  type Look,
  type PaletteColor,
  type Role,
  type SiteStyles,
  type Space,
  type TextStyle,
  type TileKey,
  TILE_KEYS,
} from "@/lib/look";

import { googleFamily, nearestWeight } from "@/themes/google-fonts";

import { canvasPalette, overlayData, overlayList, postIntent, setOverlay } from "./optimistic";
import TypoControls from "./TypoControls";
import { useDismiss } from "./useDismiss";

import "@/app/admin/look-layer.css";

type Rect = { top: number; left: number; width: number; height: number };
export type LookTarget = { uid: string; type: string; parent?: string; parentType?: string } | null;

const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};
const swatch = (c: PaletteColor) => `var(--t-color-${c})`;

/** Enveloppe d'édition d'un bloc. */
const wrapperOf = (uid: string) => document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"], [data-edit-bitem="${CSS.escape(uid)}"]:not([data-edit-bitem-project])`);

/** Composant d'une planche (lot 31c : un Texte…) : sa mise en forme s'écrit dans ses réglages, par l'opération de planche. */
const itemFrameOf = (uid: string) => document.querySelector<HTMLElement>(`[data-edit-bitem="${CSS.escape(uid)}"]:not([data-edit-bitem-project])`);

/**
 * Réglages actuels d'un bloc : ceux envoyés mais pas encore acquittés par le
 * serveur (état local, optimistic.ts) font foi — deux gestes rapprochés
 * partent de la bonne base même si la page rendue est en retard —, sinon
 * ceux posés par BlockList en vue brouillon.
 */
export function lookOf(uid: string): Look {
  const pending = overlayData<Look>(`look:${uid}`);
  if (pending) return pending;
  try {
    return readLook(JSON.parse(wrapperOf(uid)?.dataset.editLook ?? "null")) ?? {};
  } catch {
    return {};
  }
}
/** Élément racine rendu par le bloc (sous son enveloppe de mise en page), ou null (conteneur sans boîte). */
function rootOf(uid: string): HTMLElement | null {
  let el = wrapperOf(uid)?.firstElementChild as HTMLElement | null;
  // Carte de rubrique (lot 17c) : l'enveloppe `.surface-card` est toujours là en vue brouillon, elle aussi se traverse.
  if (el?.classList.contains("surface-card")) el = el.firstElementChild as HTMLElement | null;
  if (el?.classList.contains("blk")) el = el.firstElementChild as HTMLElement | null;
  if (!el || el.hasAttribute("data-edit-block")) return null;
  return el;
}
/** Envoie les réglages d'un bloc ; renvoie le numéro de l'intention (pour les aperçus). */
export function sendLook(uid: string, look: Look): number {
  const clean = cleanLook(look);
  const frame = itemFrameOf(uid);
  const board = Number(frame?.dataset.board);
  const seq = frame && board ? postIntent({ kind: "bitem-look", board, uid, look: clean ?? null }) : postIntent({ kind: "look", uid, look: clean ?? null });
  setOverlay(`look:${uid}`, seq, { data: clean ?? {} });
  return seq;
}

/* ---- Espaces ---------------------------------------------------------------- */

type Cran = { key: Space | "auto"; px: number };
const SPACE_ORDER: Space[] = ["none", "s", "m", "l", "xl"];

/** Valeur en px des crans du thème (sonde mesurée), et de « Auto » pour ce bloc. */
function crans(root: HTMLElement, side: "top" | "bottom"): Cran[] {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const out: Cran[] = SPACE_ORDER.map((key) => {
    probe.style.paddingTop = key === "none" ? "0px" : `var(--t-space-${key})`;
    return { key, px: parseFloat(getComputedStyle(probe).paddingTop) || 0 };
  });
  probe.remove();
  // Auto : la valeur du bloc sans réglage (attribut retiré le temps de la mesure).
  const blk = root.parentElement?.classList.contains("blk") ? root.parentElement : null;
  const attr = side === "top" ? "data-pt" : "data-pb";
  const saved = blk?.getAttribute(attr) ?? null;
  const inline = side === "top" ? root.style.paddingTop : root.style.paddingBottom;
  if (blk && saved !== null) blk.removeAttribute(attr);
  if (side === "top") root.style.paddingTop = "";
  else root.style.paddingBottom = "";
  const auto = parseFloat(getComputedStyle(root)[side === "top" ? "paddingTop" : "paddingBottom"]) || 0;
  if (blk && saved !== null) blk.setAttribute(attr, saved);
  if (side === "top") root.style.paddingTop = inline;
  else root.style.paddingBottom = inline;
  return [{ key: "auto", px: auto }, ...out];
}
function nearest(list: Cran[], px: number): Cran {
  return list.reduce((best, c) => (Math.abs(c.px - px) < Math.abs(best.px - px) - 0.5 ? c : best), list[0]);
}
const cranLabel = (c: Cran) => (c.key === "auto" ? "Auto (thème)" : SPACE_LABELS[c.key]);

/** Aperçu d'un espace sur le DOM du site (hors rendu React de la couche). */
function setPad(el: HTMLElement, prop: "paddingTop" | "paddingBottom", value: string) {
  el.style[prop] = value;
}

/**
 * Espace validé : posé sur l'élément du bloc et gardé (même si la page est
 * re-rendue par une réponse en retard) jusqu'à ce que le serveur le rende.
 */
function keepPad(uid: string, prop: "paddingTop" | "paddingBottom", px: number, seq: number) {
  const value = `${px}px`;
  setOverlay(`pad:${uid}:${prop}`, seq, {
    data: value,
    apply: () => {
      const el = rootOf(uid);
      if (el && el.style[prop] !== value) setPad(el, prop, value);
    },
    clear: () => {
      const el = rootOf(uid);
      if (el) setPad(el, prop, "");
    },
  });
}

function SpacingHandle({ uid, side, look, announce }: { uid: string; side: "top" | "bottom"; look: Look; announce: (s: string) => void }) {
  const [drag, setDrag] = useState<{ px: number; cran: Cran } | null>(null);
  const root = rootOf(uid);
  if (!root) return null;
  const r = docRect(root);
  const cs = getComputedStyle(root);
  const pad = parseFloat(side === "top" ? cs.paddingTop : cs.paddingBottom) || 0;
  const current: Space | "auto" = (side === "top" ? look.spaceTop : look.spaceBottom) ?? "auto";
  const prop = side === "top" ? "paddingTop" : "paddingBottom";
  const commit = (c: Cran) => {
    if (c.key === current) {
      // Inchangé : l'aperçu du glisser est retiré (au profit d'un espace validé et pas encore rendu, s'il y en a un).
      setPad(root, prop, overlayData<string>(`pad:${uid}:${prop}`) ?? "");
      return;
    }
    const seq = sendLook(uid, { ...look, [side === "top" ? "spaceTop" : "spaceBottom"]: c.key === "auto" ? undefined : c.key });
    keepPad(uid, prop, c.px, seq);
    announce(`Espace ${side === "top" ? "haut" : "bas"} : ${cranLabel(c)}`);
  };
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const list = crans(root, side);
    const startY = e.clientY;
    const start = pad;
    let last = nearest(list, start);
    const move = (ev: PointerEvent) => {
      const px = Math.max(0, start + (ev.clientY - startY));
      last = nearest(list, px);
      // Aperçu aimanté : le bloc prend la valeur du cran le plus proche.
      setPad(root, prop, `${last.px}px`);
      setDrag({ px, cran: last });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      commit(last);
    };
    const cancel = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      // Retour à l'espace d'avant le geste : validé et en attente, sinon celui du serveur.
      setPad(root, prop, overlayData<string>(`pad:${uid}:${prop}`) ?? "");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const list = crans(root, side).sort((a, b) => a.px - b.px || (a.key === "auto" ? -1 : 1));
    const i = list.findIndex((c) => c.key === current);
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) commit(next);
  };
  const shown = drag ? drag.cran.px : pad;
  const zoneTop = side === "top" ? r.top : r.top + r.height - shown;
  return (
    <>
      <div className="lk-space-zone" data-side={side} data-active={drag ? "" : undefined} style={{ top: zoneTop, left: r.left, width: r.width, height: Math.max(2, shown) }} aria-hidden="true">
        {(drag || shown > 14) && <span className="lk-space-value">{drag ? `${cranLabel(drag.cran)} · ${Math.round(drag.cran.px)} px` : `${current === "auto" ? "Auto" : SPACE_LABELS[current]} · ${Math.round(shown)} px`}</span>}
      </div>
      <button
        type="button"
        className="lk-space-handle"
        data-side={side}
        // Sur le bord de la zone qui suit le curseur : en haut, le bord côté contenu ;
        // en bas, le bord extérieur (le bloc grandit vers le bas, son contenu ne bouge pas).
        style={{ top: side === "top" ? r.top + shown - 5 : r.top + r.height - 5, left: r.left + r.width / 2 - 22 }}
        aria-label={`Espace ${side === "top" ? "haut" : "bas"} : ${current === "auto" ? "Auto" : SPACE_LABELS[current]}. Glisser, ou flèches haut et bas.`}
        title={`Espace ${side === "top" ? "haut" : "bas"} (glisser : crans du thème)`}
        onPointerDown={onDown}
        onKeyDown={onKey}
      />
    </>
  );
}

/* ---- Textes ------------------------------------------------------------------- */

const TEXT_SEL = "[data-inline], [data-site-inline], [data-slot-inline], [data-project-inline]";

/** Rôle global d'un texte (styles du site). */
function roleOf(el: HTMLElement): Role {
  if (el.closest(".site-header")) return el.closest(".site-brand") ? "brand" : "menu";
  if (el.closest(".eyebrow")) return "eyebrow";
  if (el.closest("h1")) return "h1";
  if (el.closest("h2, h3")) return "h2";
  if (el.closest(".caption-text, figcaption, .strip-caption") || el.closest("footer")) return "caption";
  return "body";
}

/** Chemin stable d'un élément (le DOM est re-rendu au rafraîchissement). */
function pathOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    parts.unshift(`:nth-child(${[...parent.children].indexOf(cur) + 1})`);
    cur = parent;
  }
  return `body > ${parts.join(" > ")}`;
}

type TextTarget = {
  path: string;
  role: Role;
  /** Texte d'un bloc : style local possible (chemin dans look.text). */
  local: { uid: string; key: string } | null;
};

/**
 * Blocs dont des textes sont rendus par un composant client : seuls les chemins
 * listés reçoivent un style local (passé en props). Vidéo : la légende seule.
 * Le formulaire de contact transmet tous ses textes (ContactForm, `styles`).
 */
const LOCAL_ONLY: Record<string, Set<string>> = { "video-single": new Set(["description"]) };

/** Bloc de la page, ou composant d'une planche (lot 31c), qui porte ce texte : le plus proche des deux. */
const OWNER_SEL = "[data-edit-bitem]:not([data-edit-bitem-project]), [data-edit-block]";
const ownerUid = (b: HTMLElement) => b.dataset.editBlock ?? b.dataset.editBitem;

function targetOf(el: HTMLElement): TextTarget {
  const found = el.closest<HTMLElement>(OWNER_SEL);
  const only = found && Object.hasOwn(LOCAL_ONLY, found.dataset.editType ?? found.dataset.editBitemType ?? "") ? LOCAL_ONLY[(found.dataset.editType ?? found.dataset.editBitemType)!] : null;
  // `data-look-key` : texte du PROJET (contenu partagé) mis en forme localement par le bloc qui l'affiche.
  const inline = el.dataset.inline ?? el.dataset.lookKey;
  const block = found && (!only || (inline !== undefined && only.has(inline))) ? found : null;
  const site = el.dataset.siteInline;
  let local: TextTarget["local"] = null;
  const uid = block ? ownerUid(block) : undefined;
  if (uid && inline && el.closest(OWNER_SEL) === block) local = { uid, key: inline };
  else if (uid && (site === "name" || site === "role")) local = { uid, key: `site.${site}` };
  return { path: pathOf(el), role: roleOf(el), local };
}

/** Styles du site tels que le serveur les a rendus (feuille `#site-styles`). */
function serverStyles(): SiteStyles {
  try {
    return SiteStylesSchema.safeParse(JSON.parse(document.getElementById("site-styles")?.dataset.editStyles ?? "{}")).data ?? {};
  } catch {
    return {};
  }
}

/** Styles du site : ceux du serveur, et par-dessus les styles de rôle posés dont il n'a pas encore acquitté l'enregistrement. */
function siteStyles(): SiteStyles {
  const base = serverStyles();
  const pending = overlayList<{ role: Role; style: TextStyle | undefined }>("role:");
  if (!pending.length) return base;
  const roles = { ...(base.roles ?? {}) };
  for (const p of pending) {
    if (p.style) roles[p.role] = p.style;
    else delete roles[p.role];
  }
  return { ...base, roles };
}

/** Feuille d'aperçu des styles de rôle en attente (retirée quand il n'y en a plus). */
function renderRolePreview() {
  let el = document.getElementById("pe-style-preview");
  if (!overlayList("role:").length) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = "pe-style-preview";
    document.body.appendChild(el);
  }
  const css = siteStylesCss(siteStyles(), canvasPalette());
  if (el.textContent !== css) el.textContent = css;
}

/** Aperçu immédiat d'un style global, gardé jusqu'à ce que la feuille du serveur le porte. */
function previewRole(role: Role, style: TextStyle | undefined, seq: number) {
  setOverlay(`role:${role}`, seq, { data: { role, style }, apply: renderRolePreview, clear: renderRolePreview });
}

/** Éléments d'un texte de bloc visé par un style local (`look.text`). */
function localTexts(local: { uid: string; key: string }): HTMLElement[] {
  const block = wrapperOf(local.uid);
  if (!block) return [];
  const sel = local.key.startsWith("site.") ? `[data-site-inline="${CSS.escape(local.key.slice(5))}"]` : `[data-inline="${CSS.escape(local.key)}"]`;
  return [...block.querySelectorAll<HTMLElement>(sel)].filter((e) => e.closest(OWNER_SEL) === block);
}

/** Aperçu immédiat du style de CE texte, gardé jusqu'à ce que le serveur le rende. */
function previewTextStyle(local: { uid: string; key: string }, style: TextStyle | undefined, seq: number) {
  const css = textStyleDecls(style, canvasPalette()).map(([k, v]) => `${k}:${v}`).join(";");
  setOverlay(`tstyle:${local.uid}:${local.key}`, seq, {
    apply: () => {
      for (const el of localTexts(local)) if (el.getAttribute("style") !== css) el.setAttribute("style", css);
    },
  });
}

function TextBar({
  target,
  installed,
  themeNames,
  onClose,
  tick,
}: {
  target: TextTarget;
  installed: string[];
  themeNames?: Partial<Record<"display" | "body" | "caption", string>>;
  onClose: () => void;
  tick: number;
}) {
  const [scope, setScope] = useState<"local" | "role">(target.local ? "local" : "role");
  const barRef = useRef<HTMLDivElement>(null);
  const el = document.querySelector<HTMLElement>(target.path);
  // Clic ailleurs : la barre se ferme (les réglages sont déjà appliqués). Le texte visé
  // reste cliquable (déplacer le curseur pendant la saisie) sans la fermer.
  useDismiss(barRef, onClose, { ignore: (t) => Boolean(document.querySelector(target.path)?.contains(t)) });
  void tick;
  // Le texte n'est plus là (la page s'est redessinée autrement, ex. le bloc a perdu son enveloppe) : la barre n'a plus de cible
  // et, sans cette fermeture, bloquerait le « Aa » des autres textes. Un redessin passager la retrouve avant le délai.
  const missing = !el;
  useEffect(() => {
    if (!missing) return;
    const t = setTimeout(onClose, 2000);
    return () => clearTimeout(t);
  }, [missing, onClose, tick]);
  // La barre ne recouvre jamais la barre d'outils du bloc sélectionné (`.pe-tools` : Monter, Descendre, Supprimer…) : au-dessus du
  // texte par défaut, sinon dessous, sinon décalée à gauche de cette barre d'outils. Calculé sur les tailles (pas sur la position
  // actuelle), donc sans boucle ; refait à chaque rendu (la barre d'outils apparaît quand la saisie sélectionne le bloc).
  const [avoid, setAvoid] = useState<{ below: boolean; left: number | null } | null>(null);
  // Sans liste de dépendances (volontaire) : la barre d'outils apparaît et bouge sans que ce composant le sache ; le setState ne
  // change rien (même objet) quand le placement est déjà bon, donc pas de boucle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const bar = barRef.current;
    const text = document.querySelector<HTMLElement>(target.path);
    let next: { below: boolean; left: number | null } | null = null;
    if (bar && text) {
      const tr = docRect(text);
      const tools = [...document.querySelectorAll<HTMLElement>(".pe-tools")].map(docRect).filter((t) => t.width > 0);
      const [w, h] = [bar.offsetWidth, bar.offsetHeight];
      const gap = 6;
      const left0 = Math.max(window.scrollX + 8, Math.min(tr.left, window.scrollX + document.documentElement.clientWidth - 560));
      const hitTool = (below: boolean, left: number) => {
        const top = below ? tr.top + tr.height + 8 : tr.top - 8 - h;
        return tools.find((t) => left < t.left + t.width + gap && left + w > t.left - gap && top < t.top + t.height + gap && top + h > t.top - gap);
      };
      const hits = (below: boolean, left: number) => Boolean(hitTool(below, left));
      const below0 = tr.top - window.scrollY < 150;
      if (tools.length && hits(below0, left0)) {
        const shifted = (below: boolean) => {
          const t = hitTool(below, left0);
          return t ? Math.max(window.scrollX + 8, t.left - gap - w) : left0;
        };
        if (!hits(!below0, left0)) next = { below: !below0, left: null };
        else if (!hits(below0, shifted(below0))) next = { below: below0, left: shifted(below0) };
        else if (!hits(!below0, shifted(!below0))) next = { below: !below0, left: shifted(!below0) };
      }
    }
    setAvoid((prev) => (prev?.below === next?.below && prev?.left === next?.left ? prev : next));
  });
  if (!el) return null;
  const r = docRect(el);
  const look = target.local ? lookOf(target.local.uid) : {};
  // Fond du métier de l'ouverture réglé avant le lot 21 (`look.roleBackdrop`) : « Ombre douce » et « Bandeau » sont montrés comme
  // celui du texte et migrés dans son style dès qu'on le modifie (le rendu ne change pas). L'ancien « Surlignage » (aplat en
  // ligne, look.css) n'a pas le rendu du nouveau (trait derrière le texte) : il reste tel quel, sans être montré ni migré,
  // jusqu'à ce qu'on choisisse un nouveau fond (ou « Revenir au style global »).
  const oldBackdrop = target.local?.key === "site.role" ? look.roleBackdrop : undefined;
  const legacyBackdrop = oldBackdrop && oldBackdrop !== "highlight" ? oldBackdrop : undefined;
  const localStyle: TextStyle = target.local ? { ...(legacyBackdrop ? { backdrop: legacyBackdrop } : {}), ...(look.text?.[target.local.key] ?? {}) } : {};
  const roleStyle = siteStyles().roles?.[target.role] ?? {};
  const value = scope === "local" ? localStyle : roleStyle;
  const change = (input: TextStyle | undefined) => {
    let next = input;
    // Police Google choisie sans graisse : celle du texte affiché (le serveur
    // télécharge exactement ce style).
    const fam = googleOf(next?.font) ? googleFamily(googleOf(next?.font)!) : undefined;
    if (next && fam && !next.weight) next = { ...next, weight: nearestWeight(fam, parseInt(getComputedStyle(el).fontWeight, 10) || 400, Boolean(next.italic)) };
    if (scope === "local" && target.local) {
      const text = { ...(look.text ?? {}) };
      if (next) text[target.local.key] = next;
      else delete text[target.local.key];
      const seq = sendLook(target.local.uid, { ...look, text, ...(oldBackdrop && (legacyBackdrop || next === undefined || next.backdrop !== undefined) ? { roleBackdrop: undefined } : {}) });
      // Aperçu immédiat sur ce texte.
      previewTextStyle(target.local, next, seq);
    } else {
      const seq = postIntent({ kind: "site-style", role: target.role, style: next ?? null });
      previewRole(target.role, next, seq);
    }
  };
  const below = avoid ? avoid.below : r.top - window.scrollY < 150;
  return (
    <div
      ref={barRef}
      className="lk-bar"
      role="toolbar"
      aria-label="Style du texte"
      data-below={below || undefined}
      style={{ top: below ? r.top + r.height + 8 : r.top - 8, left: avoid?.left ?? Math.max(window.scrollX + 8, Math.min(r.left, window.scrollX + document.documentElement.clientWidth - 560)) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="lk-bar-head">
        <span className="lk-seg" role="radiogroup" aria-label="Appliquer à">
          {target.local && (
            <button type="button" role="radio" aria-checked={scope === "local"} onClick={() => setScope("local")}>
              Ce texte
            </button>
          )}
          <button type="button" role="radio" aria-checked={scope === "role"} onClick={() => setScope("role")} title="Styles du site : toutes les pages (publié avec la page)">
            Tous les « {ROLE_LABELS[target.role]} »
          </button>
        </span>
        <button type="button" className="lk-close" aria-label="Fermer la barre" onClick={onClose}>
          ✕
        </button>
      </div>
      <TypoControls
        value={value}
        onChange={change}
        installed={installed}
        swatch={swatch}
        themeNames={themeNames}
        compact
        resetLabel={scope === "local" ? "Revenir au style global" : "Revenir au thème"}
        palette={canvasPalette()}
        backdropBlocked={BACKDROP_BLOCKED[target.role]}
        inheritedColor={scope === "local" ? roleStyle.color : undefined}
      />
    </div>
  );
}

/* ---- Position du titre ------------------------------------------------------------ */

const TITLE_TYPES = new Set(["section-title", "collection-intro", "hero", "project-board", "collection-tiles"]);

function PosIcon({ axis, v }: { axis: "h" | "v"; v: string }) {
  // Trait épais = le titre ; cadre = l'emplacement.
  const pos = v === "left" || v === "top" ? 3 : v === "right" || v === "bottom" ? 11 : 7;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {axis === "h" ? <rect x={pos - 2} y="4" width="5" height="8" fill="currentColor" /> : <rect x="4" y={pos - 2} width="8" height="5" fill="currentColor" />}
    </svg>
  );
}

function TitlePosition({ uid, type, inCell, rect }: { uid: string; type: string; inCell: boolean; rect: Rect }) {
  const look = lookOf(uid);
  const vertical = type === "hero" || inCell;
  const H = [
    ["left", "Titre à gauche"],
    ["center", "Titre centré"],
    ["right", "Titre à droite"],
  ] as const;
  const V = [
    ["top", "Titre en haut"],
    ["middle", "Titre au milieu"],
    ["bottom", "Titre en bas"],
  ] as const;
  return (
    <div className="lk-pos" role="toolbar" aria-label="Position du titre" style={{ top: rect.top + rect.height + 4, left: rect.left + 8 }}>
      {H.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={(look.titleH ?? "left") === v} aria-label={label} title={label} onClick={() => sendLook(uid, { ...look, titleH: v === "left" ? undefined : v })}>
          <PosIcon axis="h" v={v} />
        </button>
      ))}
      {vertical && <span className="lk-sep" aria-hidden="true" />}
      {vertical &&
        V.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={(look.titleV ?? (type === "hero" ? "bottom" : "top")) === v}
            aria-label={label}
            title={label}
            onClick={() => sendLook(uid, { ...look, titleV: v === (type === "hero" ? "bottom" : "top") ? undefined : v })}
          >
            <PosIcon axis="v" v={v} />
          </button>
        ))}
    </div>
  );
}

/* ---- Cadrage ------------------------------------------------------------------------ */

type CropTarget = {
  uid: string;
  field: "mediaId" | "backgroundMediaId" | "portraitMediaId";
  media: HTMLImageElement | HTMLVideoElement;
  /** Tuile de collection : son cadrage vit dans `look.tileCrop[tile]`. */
  tile?: TileKey;
  /**
   * Bloc Image (lot 17d) : l'image ENTIÈRE (le cadre peut afficher une variante recadrée), son rapport, ses
   * pixels, et le format imposé au cadre (null : aucun). Recadrage libre possible seulement avec elle.
   */
  full?: { src: string; ratio: number; w: number; h: number; box: number | null };
};
const CROPPABLE: Record<string, CropTarget["field"]> = { image: "mediaId", hero: "backgroundMediaId", profile: "portraitMediaId" };

function mediaRatio(m: HTMLImageElement | HTMLVideoElement): number {
  const w = m instanceof HTMLImageElement ? m.naturalWidth : m.videoWidth;
  const h = m instanceof HTMLImageElement ? m.naturalHeight : m.videoHeight;
  return w && h ? w / h : 0;
}

/** Image d'un emplacement qui n'a pas son format (affichée en « cover »). */
function cropTargetAt(t: EventTarget | null): CropTarget | null {
  if (!(t instanceof Element)) return null;
  // Tuile de collection (accueil) : une image par collection, format imposé par le bloc.
  const tileHost = t.closest<HTMLElement>("[data-edit-tile]");
  if (tileHost) {
    const tileBlock = tileHost.closest<HTMLElement>("[data-edit-block]");
    const tile = tileHost.dataset.editTile as TileKey | undefined;
    const img = tileHost.querySelector<HTMLImageElement>("img");
    if (!tileBlock?.dataset.editBlock || !tile || !(TILE_KEYS as readonly string[]).includes(tile) || !img) return null;
    // Couverture raster : recadrage libre toujours possible (l'image ENTIÈRE vient de la tuile, pas de la variante affichée).
    const fullSrc = tileHost.dataset.fullSrc;
    if (fullSrc) {
      const [fw, fh] = (tileHost.dataset.fullPx ?? "0x0").split("x").map(Number);
      const ratio = Number(tileHost.dataset.fullRatio);
      if (!ratio || !fw || !fh) return null;
      return { uid: tileBlock.dataset.editBlock, field: "mediaId", media: img, tile, full: { src: fullSrc, ratio, w: fw, h: fh, box: parseRatio(tileHost.closest<HTMLElement>(".tiles")?.dataset.ratio) } };
    }
    const ir = mediaRatio(img);
    const box = img.getBoundingClientRect();
    // Le zoom agrandit l'image dans son cadre : le cadre (parent) donne le format.
    const frame = tileHost.getBoundingClientRect();
    if (!ir || !frame.height || !box.height || !needsCrop(ir, frame.width / frame.height)) return null;
    return { uid: tileBlock.dataset.editBlock, field: "mediaId", media: img, tile };
  }
  const host = t.closest<HTMLElement>("[data-edit-media]");
  const block = host?.closest<HTMLElement>("[data-edit-block]");
  const field = block ? CROPPABLE[block.dataset.editType ?? ""] : undefined;
  if (!host || !block?.dataset.editBlock || !field || host.dataset.editMedia !== field) return null;
  // Ouverture : seulement une image ou vidéo de fond choisie (pas le décor du thème).
  const media = host.querySelector<HTMLImageElement | HTMLVideoElement>(field === "backgroundMediaId" ? ".hero-backdrop img, .hero-backdrop video" : "img");
  if (!media) return null;
  // Bloc Image : toujours recadrable (libre) ; l'image entière vient du bloc, pas de la variante affichée.
  const fullSrc = host.dataset.fullSrc;
  if (field === "mediaId" && fullSrc && media instanceof HTMLImageElement) {
    const [fw, fh] = (host.dataset.fullPx ?? "0x0").split("x").map(Number);
    const ratio = Number(host.dataset.fullRatio);
    if (!ratio || !fw || !fh) return null;
    const figure = host.closest<HTMLElement>("figure.block-image");
    const box = parseRatio(figure?.dataset.editBox);
    return { uid: block.dataset.editBlock, field, media, full: { src: fullSrc, ratio, w: fw, h: fh, box } };
  }
  const ir = mediaRatio(media);
  const box = media.getBoundingClientRect();
  if (!ir || !box.height || !needsCrop(ir, box.width / box.height)) return null;
  return { uid: block.dataset.editBlock, field, media };
}

/** Onglets Libre / Cadre du bloc de la modale « Cadrer l'image ». */
function CropTabs({ mode, onMode }: { mode: "free" | "frame"; onMode: (m: "free" | "frame") => void }) {
  return (
    <div className="lk-crop-tabs" role="tablist" aria-label="Mode de cadrage">
      <button type="button" role="tab" aria-selected={mode === "free"} onClick={() => onMode("free")}>
        Libre
      </button>
      <button type="button" role="tab" aria-selected={mode === "frame"} onClick={() => onMode("frame")} title="Point focal et zoom dans le format imposé à la rubrique">
        Dans le cadre de la rubrique
      </button>
    </div>
  );
}

/** Modale de cadrage : « Libre » par défaut pour une image seule ; « Dans le cadre de la rubrique » (point focal + zoom) quand un format est imposé. */
function CropDialog({ target, onClose }: { target: CropTarget; onClose: () => void }) {
  const look = lookOf(target.uid);
  const existing = target.tile ? look.tileCrop?.[target.tile] : look.crop?.[target.field];
  const full = target.full;
  // Cadre au format imposé : l'ancien mode (point focal + zoom) reste possible, et reste ouvert s'il est déjà réglé.
  const frameOk = Boolean(full?.box) || Boolean(existing && !existing.rect);
  const [mode, setMode] = useState<"free" | "frame">(full && !(existing && !existing.rect && frameOk) ? "free" : "frame");
  if (full && mode === "free") {
    return (
      <FreeCropDialog
        src={full.src}
        px={{ w: full.w, h: full.h }}
        initial={existing?.rect ?? null}
        tabs={frameOk ? <CropTabs mode="free" onMode={setMode} /> : undefined}
        onClose={onClose}
        onSave={(rect: CropRect | null) => {
          if (target.tile) {
            const tiles = { ...(look.tileCrop ?? {}) };
            if (rect) tiles[target.tile] = { x: 50, y: 50, zoom: 1, rect };
            else delete tiles[target.tile];
            sendLook(target.uid, { ...look, tileCrop: tiles });
          } else {
            const next = { ...(look.crop ?? {}) };
            if (rect) next[target.field] = { x: 50, y: 50, zoom: 1, rect };
            else delete next[target.field];
            sendLook(target.uid, { ...look, crop: next });
          }
          onClose();
        }}
      />
    );
  }
  return <FrameCropDialog target={target} onClose={onClose} tabs={full && frameOk ? <CropTabs mode="frame" onMode={setMode} /> : undefined} />;
}

function FrameCropDialog({ target, onClose, tabs }: { target: CropTarget; onClose: () => void; tabs?: React.ReactNode }) {
  const look = lookOf(target.uid);
  // Une tuile : le cadre est le parent de l'image (l'image zoomée déborde de sa boîte).
  const box = (target.tile ? target.media.closest("[data-edit-tile]") ?? target.media : target.media).getBoundingClientRect();
  // Bloc Image : le format du cadre est celui que le bloc impose (l'image affichée peut être une variante recadrée).
  const boxRatio = target.full?.box ?? box.width / box.height;
  const ir = target.full?.ratio ?? mediaRatio(target.media);
  const stored = target.tile ? look.tileCrop?.[target.tile] : look.crop?.[target.field];
  const [crop, setCrop] = useState<Crop>(stored && !stored.rect ? stored : { x: 50, y: 50, zoom: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  const win = cropWindow(crop, ir, boxRatio);
  const src = target.full?.src ?? (target.media instanceof HTMLImageElement ? target.media.currentSrc || target.media.src : "");
  const poster = target.media instanceof HTMLVideoElement ? target.media.poster : "";
  // Taille de l'image affichée : tient dans 80 % × 62 % de la fenêtre.
  const maxW = window.innerWidth * 0.8;
  const maxH = window.innerHeight * 0.62;
  const w = Math.min(maxW, maxH * ir);
  const h = w / ir;
  const moveBy = (dx: number, dy: number) => setCrop((c) => {
    const cw = cropWindow(c, ir, boxRatio);
    return cropFromWindow(Math.min(1 - cw.width, Math.max(0, cw.left + dx)), Math.min(1 - cw.height, Math.max(0, cw.top + dy)), c.zoom, ir, boxRatio);
  });
  const zoomTo = (z: number) => setCrop((c) => {
    const cw = cropWindow(c, ir, boxRatio);
    const nz = Math.min(4, Math.max(1, Math.round(z * 100) / 100));
    const nw = cropWindow({ ...c, zoom: nz }, ir, boxRatio);
    // Zoom autour du centre de la zone gardée.
    const cx = cw.left + cw.width / 2;
    const cy = cw.top + cw.height / 2;
    return cropFromWindow(Math.min(1 - nw.width, Math.max(0, cx - nw.width / 2)), Math.min(1 - nw.height, Math.max(0, cy - nw.height / 2)), nz, ir, boxRatio);
  });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: PointerEvent) => {
      moveBy((ev.clientX - lx) / w, (ev.clientY - ly) / h);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const save = () => {
    const centered = crop.zoom === 1 && Math.abs(crop.x - 50) < 0.01 && Math.abs(crop.y - 50) < 0.01;
    if (target.tile) {
      const tiles = { ...(look.tileCrop ?? {}) };
      if (centered) delete tiles[target.tile];
      else tiles[target.tile] = crop;
      sendLook(target.uid, { ...look, tileCrop: tiles });
      onClose();
      return;
    }
    const next = { ...(look.crop ?? {}) };
    if (centered) delete next[target.field];
    else next[target.field] = crop;
    sendLook(target.uid, { ...look, crop: next });
    onClose();
  };
  return (
    <div className="lk-crop-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="lk-crop"
        role="dialog"
        aria-modal="true"
        aria-label="Cadrer l'image"
        tabIndex={-1}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const keys: Record<string, () => void> = {
            ArrowLeft: () => moveBy(-step, 0),
            ArrowRight: () => moveBy(step, 0),
            ArrowUp: () => moveBy(0, -step),
            ArrowDown: () => moveBy(0, step),
            "+": () => zoomTo(crop.zoom + 0.1),
            "=": () => zoomTo(crop.zoom + 0.1),
            "-": () => zoomTo(crop.zoom - 0.1),
            Escape: onClose,
            Enter: save,
          };
          if (keys[e.key] && !(e.target instanceof HTMLButtonElement && e.key === "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            keys[e.key]();
          }
        }}
      >
        <p className="lk-crop-title">Cadrer l&apos;image</p>
        {tabs}
        <p className="lk-crop-help">La zone claire est gardée sur la page. Glisse-la, zoome à la molette (ou + / −) ; flèches pour la déplacer.</p>
        <div
          ref={stage}
          className="lk-crop-stage"
          style={{ width: w, height: h, backgroundImage: src || poster ? `url("${(src || poster).replace(/"/g, "%22")}")` : undefined }}
          onWheel={(e) => {
            e.preventDefault();
            zoomTo(crop.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
          }}
        >
          <div
            className="lk-crop-window"
            data-testid="crop-window"
            style={{ left: win.left * w, top: win.top * h, width: win.width * w, height: win.height * h }}
            onPointerDown={onDown}
          />
        </div>
        <div className="lk-crop-actions">
          <label className="lk-crop-zoom">
            Zoom
            <input type="range" min={1} max={4} step={0.05} value={crop.zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" />
            <output>{Math.round(crop.zoom * 100)} %</output>
          </label>
          <button type="button" onClick={() => setCrop({ x: 50, y: 50, zoom: 1 })}>
            Recentrer
          </button>
          <span className="lk-spacer" />
          <button type="button" onClick={onClose}>
            Fermer sans enregistrer
          </button>
          <button type="button" className="lk-primary" onClick={save}>
            Enregistrer le cadrage
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Calque --------------------------------------------------------------------------- */

export default function LookLayer({
  selected,
  dragging,
  announce,
}: {
  selected: LookTarget;
  dragging: boolean;
  announce: (s: string) => void;
}) {
  const [hoverText, setHoverText] = useState<{ el: HTMLElement; rect: Rect } | null>(null);
  const [bar, setBar] = useState<TextTarget | null>(null);
  const [cropHover, setCropHover] = useState<CropTarget | null>(null);
  const [cropOpen, setCropOpen] = useState<CropTarget | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [themeNames] = useState(readThemeNames);

  // Polices déjà téléchargées (message de l'éditeur).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (msg?.kind === "fonts") setInstalled(msg.installed);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Re-mesure au défilement, au redimensionnement et quand la page est re-rendue.
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(bump);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [bump]);

  // Survol : « Aa » sur un texte éditable, « Cadrer » sur une image à cadrer.
  useEffect(() => {
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    const onMove = (e: PointerEvent) => {
      if (inLayer(e.target)) {
        clearTimeout(hideTimer.current);
        return;
      }
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>(TEXT_SEL) : null;
      clearTimeout(hideTimer.current);
      if (t) setHoverText((h) => (h?.el === t ? h : { el: t, rect: docRect(t) }));
      else hideTimer.current = setTimeout(() => setHoverText(null), 500);
      const c = cropTargetAt(e.target);
      setCropHover((prev) => (c ? (prev?.media === c.media ? prev : c) : prev && (e.target as Element)?.closest?.("[data-edit-media], [data-edit-tile]") ? prev : null));
    };
    // Saisie d'un texte : sa barre s'ouvre d'elle-même.
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement && e.target.hasAttribute("data-editing") ? e.target : null;
      if (el) setBar(targetOf(el));
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      clearTimeout(hideTimer.current);
    };
  }, []);

  if (dragging) return null;
  void tick;
  const root = selected && !selected.uid.startsWith("site-") ? rootOf(selected.uid) : null;
  const selLook = selected ? lookOf(selected.uid) : {};
  const selRect = selected ? (wrapperOf(selected.uid) ? rectOfWrapper(selected.uid) : null) : null;
  const hoverValid = hoverText && document.contains(hoverText.el) ? { ...hoverText, rect: docRect(hoverText.el) } : null;
  const cropValid = cropHover && document.contains(cropHover.media) ? cropHover : null;

  return (
    <div className="pe-layer pe-look-layer" lang="fr">
      {root && selected && (
        <>
          <SpacingHandle key={`t-${selected.uid}`} uid={selected.uid} side="top" look={selLook} announce={announce} />
          <SpacingHandle key={`b-${selected.uid}`} uid={selected.uid} side="bottom" look={selLook} announce={announce} />
        </>
      )}
      {selected && selRect && TITLE_TYPES.has(selected.type) && <TitlePosition uid={selected.uid} type={selected.type} inCell={selected.parentType === "grid"} rect={selRect} />}

      {hoverValid && !bar && (
        <button
          type="button"
          className="lk-aa"
          style={{ top: Math.max(window.scrollY + 2, hoverValid.rect.top - 24), left: hoverValid.rect.left + hoverValid.rect.width - 30 }}
          aria-label="Style du texte"
          title="Police, taille, couleur… de ce texte"
          onClick={() => setBar(targetOf(hoverValid.el))}
        >
          Aa
        </button>
      )}
      {bar && <TextBar key={bar.path} target={bar} installed={installed} themeNames={themeNames} onClose={() => setBar(null)} tick={tick} />}

      {cropValid && !cropOpen && (() => {
        const r = docRect(cropValid.media.closest("[data-edit-media], [data-edit-tile]") ?? cropValid.media);
        const look = lookOf(cropValid.uid);
        // Fond de l'ouverture : la barre « Changer le fond » occupe déjà le coin bas droit
        // de la partie visible ; « Cadrer » se pose juste à sa gauche, sur la même ligne.
        const bar = !cropValid.tile && cropValid.field === "backgroundMediaId" ? document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Fond de l\'ouverture"]') : null;
        const barBox = bar ? docRect(bar) : null;
        const pos = barBox
          ? { top: barBox.top, left: Math.max(r.left + 8, barBox.left - 112) }
          : { top: r.top + Math.max(8, r.height - 46), left: r.left + Math.max(8, r.width - 120) };
        return (
          <button
            type="button"
            className="lk-crop-btn"
            style={pos}
            onClick={() => setCropOpen(cropValid)}
            title="Choisir la zone gardée de l'image"
          >
            {(cropValid.tile ? look.tileCrop?.[cropValid.tile] : look.crop?.[cropValid.field]) ? "Recadrer" : "Cadrer"}
          </button>
        );
      })()}
      {cropOpen && <CropDialog target={cropOpen} onClose={() => setCropOpen(null)} />}
      <HeroContrast />
    </div>
  );
}

/** Nom réel des polices du thème (affiché dans le menu des polices). */
function readThemeNames(): Partial<Record<"display" | "body" | "caption", string>> {
  const names: Partial<Record<"display" | "body" | "caption", string>> = {};
  if (typeof document === "undefined") return names;
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["display", "body", "caption"] as const) {
    const probe = document.createElement("span");
    probe.style.fontFamily = cs.getPropertyValue(`--t-font-${k}`);
    document.body.appendChild(probe);
    const fam = getComputedStyle(probe).fontFamily.split(",")[0]?.replace(/["']/g, "").replace(/^__|_Fallback.*$|_[0-9a-f]{6,}$/g, "").replace(/_/g, " ").trim();
    probe.remove();
    if (fam) names[k] = fam;
  }
  return names;
}

/** Boîte d'une enveloppe display: contents (réunion de ses enfants). */
function rectOfWrapper(uid: string): Rect | null {
  const el = wrapperOf(uid);
  if (!el) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const visit = (node: Element) => {
    const r = node.getBoundingClientRect();
    if (r.width || r.height) {
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    } else for (const c of node.children) visit(c);
  };
  for (const c of el.children) visit(c);
  if (top === Infinity) return null;
  return { top: top + window.scrollY, left: left + window.scrollX, width: right - left, height: bottom - top };
}
