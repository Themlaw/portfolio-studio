"use client";

/**
 * En-tête, pied de page et réseaux sur la toile (v0.13) — partie de la couche
 * d'édition. Ce sont des données COMMUNES à toutes les pages (brouillon du
 * site, publié avec la page : src/lib/edit/site.ts).
 *
 * - Liens du menu (`data-nav-item`) : au survol, × pour retirer et poignée
 *   pour réordonner (glisser) ; « + Ajouter un lien » sous le menu (au survol de
 *   l'en-tête ou en-tête choisi) : une
 *   page du site (recherche) ou un lien libre. Renommer : bouton
 *   « Renommer » de la barre (crayon, survol ou toucher), double-clic ou double-tap
 *   (EditLayer, `data-site-inline="nav"` ; l'événement `pe:rename` lui passe le libellé).
 * - Réseaux (`data-edit-socials` / `data-social-index`) : au survol, modifier
 *   le lien, × retirer, poignée ; « + Réseau » : réseaux classiques, ou
 *   « Autre lien ». Le réseau est reconnu d'après l'adresse collée.
 * Toute modification part vers l'éditeur (`site-op`), qui valide et enregistre.
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { newFieldId } from "@/lib/contact-form";
import { acceptToCanvas, type FromCanvas } from "@/lib/edit/protocol";
import { safeNavHref, socialKeyOf } from "@/lib/site-schema";

import { listKeys, postIntent, previewList } from "./edit/optimistic";
import Popover from "./edit/Popover";
import SocialPicker from "./SocialPicker";

/** Largeur approchée de la barre d'outils d'un réseau (poignée, modifier, retirer) : la garde dans la fenêtre. */
const SOCIAL_TOOLS_W = 84;

type Rect = { top: number; left: number; width: number; height: number };

/** Envoie une intention (numérotée : voir edit/optimistic.ts) ; renvoie son numéro. */
function post(msg: FromCanvas): number {
  return postIntent(msg);
}

/**
 * Éléments d'une liste, dans l'ordre où ils s'AFFICHENT (aperçu instantané : l'ordre visuel suit la
 * propriété `order`, pas le DOM), sans les éléments retirés par un aperçu.
 */
function visual(els: HTMLElement[]): HTMLElement[] {
  return els
    .filter((el) => el.style.display !== "none")
    .map((el, i) => ({ el, i, order: Number(el.style.order) || 0 }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.el);
}
/** Fils directs d'un conteneur qui sont des éléments de la liste (réels, ou fantômes d'un aperçu). */
const itemsIn = (list: Element, selector: string) => visual([...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && (c.matches(selector) || c.hasAttribute("data-pv-ghost"))));

const KEY_ATTR = { nav: "data-nav-key", social: "data-social-key" } as const;
/** Rang d'un élément dans la liste telle que l'éditeur la tient (aperçus en attente compris) ; `fallback` sinon. */
function rankOf(kind: "nav" | "social", el: Element | null | undefined, fallback: number): { key: string | null; index: number } {
  const key = el?.getAttribute(KEY_ATTR[kind]) ?? null;
  const i = key ? listKeys(kind).indexOf(key) : -1;
  return { key, index: i >= 0 ? i : fallback };
}
function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
}
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

type Hover = { kind: "nav" | "social"; index: number; list: Element } | null;
type PopState = { kind: "nav-add"; anchor: Element } | { kind: "social-add"; anchor: Element } | { kind: "social-edit"; index: number; key: string | null; anchor: Element; href: string } | null;

export default function SiteLayer({ mode, host, selected, announce }: { mode: "off" | "edit" | "preview"; host: HTMLElement | null; selected: string | null; announce: (t: string) => void }) {
  const t = useTranslations("canvasSite");
  const uiLang = useLocale().slice(0, 2);
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<Hover>(null);
  const [headerNear, setHeaderNear] = useState(false);
  const [pages, setPages] = useState<{ id: number; title: string }[]>([]);
  const [pop, setPop] = useState<PopState>(null);
  const [drag, setDrag] = useState<{ kind: "nav" | "social"; from: number; to: number; marker: Rect } | null>(null);
  /** Glisser en cours : la barre d'outils qui porte la poignée reste montée (sinon la capture du pointeur est perdue). */
  const dragging = useRef(false);
  /** Délai de grâce avant de retirer les outils d'un élément : le temps d'aller du texte à la poignée (lot 86). */
  const leaveTimer = useRef<number | null>(null);
  const cancelLeave = () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const edit = mode === "edit";

  useEffect(() => cancelLeave, []);

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (msg?.kind === "pages") setPages(msg.list);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!edit) return;
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((n) => n + 1));
    };
    const onMove = (e: PointerEvent) => {
      if (dragging.current) return;
      // Sur la barre d'outils (ou une autre pièce de la couche) : elle reste, le délai de grâce s'arrête.
      if (e.target instanceof Element && e.target.closest(".pe-layer")) {
        cancelLeave();
        return;
      }
      const t = e.target instanceof Element ? e.target : null;
      const nav = t?.closest<HTMLElement>("[data-edit-global='header'] [data-nav-item]");
      const social = t?.closest<HTMLElement>("[data-social-index]");
      // « + Ajouter un lien » : seulement au survol de l'en-tête (ou sous lui, jusqu'à
      // la pastille) ou en-tête choisi ; sinon il chevauchait le bloc suivant.
      const head = document.querySelector("[data-edit-global='header']")?.getBoundingClientRect();
      setHeaderNear(Boolean(head && e.clientY >= head.top && e.clientY <= head.bottom + 48 && e.clientX >= head.left && e.clientX <= head.right));
      if (nav || social) {
        cancelLeave();
        if (nav) setHover({ kind: "nav", index: Number(nav.dataset.navItem), list: nav.parentElement! });
        else setHover({ kind: "social", index: Number(social!.dataset.socialIndex), list: social!.parentElement! });
      } else if (leaveTimer.current === null) {
        // Pas de retrait immédiat : la poignée est à quelques pixels du texte, le pointeur doit pouvoir l'atteindre.
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          setHover(null);
        }, 450);
      }
    };
    // Clavier (focus sur un lien) et toucher (un appui, sans survol) : mêmes outils que le survol.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(".pe-layer")) return;
      const nav = t.closest<HTMLElement>("[data-edit-global='header'] [data-nav-item]");
      const social = t.closest<HTMLElement>("[data-social-index]");
      cancelLeave();
      if (nav) setHover({ kind: "nav", index: Number(nav.dataset.navItem), list: nav.parentElement! });
      else if (social) setHover({ kind: "social", index: Number(social.dataset.socialIndex), list: social.parentElement! });
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      onMove(e);
    };
    // Alt + flèche sur un lien du menu (gauche, droite) ou un réseau (haut, bas) : le déplace d'un cran.
    const onKeyMove = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof Element)) return;
      const nav = e.target.closest<HTMLElement>("[data-edit-global='header'] [data-nav-item]");
      const social = e.target.closest<HTMLElement>("[data-social-index]");
      const el = nav ?? social;
      if (!el || !el.parentElement) return;
      const kind = nav ? "nav" : "social";
      const delta = e.key === (nav ? "ArrowLeft" : "ArrowUp") ? -1 : e.key === (nav ? "ArrowRight" : "ArrowDown") ? 1 : 0;
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      moveBy(kind, el, delta);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyMove, true);
    window.addEventListener("scroll", redraw, { passive: true });
    window.addEventListener("resize", redraw);
    const mo = new MutationObserver(redraw);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyMove, true);
      window.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", redraw);
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moveBy ne dépend que de refs et de fonctions stables
  }, [edit]);

  const header = typeof document !== "undefined" ? document.querySelector("[data-edit-global='header']") : null;
  const navItems = header ? visual([...header.querySelectorAll<HTMLElement>("nav [data-nav-item], nav [data-pv-ghost]")]) : [];
  const navBox = header?.querySelector("nav") ?? null;
  const socialLists = typeof document !== "undefined" ? [...document.querySelectorAll<HTMLElement>("[data-edit-socials]")] : [];

  /** Déplace un lien du menu ou un réseau d'un cran (clavier : Alt + flèche, ou flèches sur la poignée). */
  function moveBy(kind: "nav" | "social", el: HTMLElement, delta: -1 | 1) {
    const list = el.parentElement;
    if (!list) return;
    const items = itemsIn(list, kind === "nav" ? "[data-nav-item]" : "[data-social-index]");
    const at = items.indexOf(el);
    const target = at + delta;
    if (at < 0 || target < 0 || target >= items.length) return;
    const fallback = Number(kind === "nav" ? el.dataset.navItem : el.dataset.socialIndex);
    const { key, index } = rankOf(kind, el, Number.isFinite(fallback) ? fallback : at);
    const seq = post({ kind: "site-op", op: kind === "nav" ? "nav-move" : "social-move", index, ...(key ? { key } : {}), to: target });
    if (key) previewList(kind, { t: "move", key, to: target }, seq);
    announce(t(kind === "nav" ? "movedNav" : "movedSocial", { position: target + 1 }));
  }

  /** Glisser un lien du menu ou un réseau pour le réordonner. */
  const startDrag = (e: React.PointerEvent, kind: "nav" | "social", from: number, list: Element) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    dragging.current = true;
    document.documentElement.setAttribute("data-edit-dragging", "");
    const items = () => itemsIn(list, kind === "nav" ? "[data-nav-item]" : "[data-social-index]");
    // Clé de l'élément déplacé : celui qui est au rang `from` de la liste telle que l'éditeur la tient.
    const draggedKey = listKeys(kind)[from] ?? null;
    let to = from;
    const update = (x: number, y: number) => {
      const els = items();
      // Menu : horizontal ; réseaux : vertical.
      to = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return kind === "nav" ? r.left + r.width / 2 < x : r.top + r.height / 2 < y;
      }).length;
      const ref = els[Math.min(to, els.length - 1)];
      if (!ref) return;
      const r = rectOf(ref);
      const after = to >= els.length;
      setDrag({
        kind,
        from,
        to,
        marker: kind === "nav" ? { top: r.top - 4, left: after ? r.left + r.width + 8 : r.left - 10, width: 3, height: r.height + 8 } : { top: after ? r.top + r.height + 2 : r.top - 3, left: r.left, width: Math.max(120, r.width), height: 3 },
      });
    };
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.documentElement.removeAttribute("data-edit-dragging");
      dragging.current = false;
      setDrag(null);
      if (to !== from && to !== from + 1) {
        const target = to > from ? to - 1 : to;
        const seq = post({ kind: "site-op", op: kind === "nav" ? "nav-move" : "social-move", index: from, ...(draggedKey ? { key: draggedKey } : {}), to: target });
        if (draggedKey) previewList(kind, { t: "move", key: draggedKey, to: target }, seq);
        announce(t(kind === "nav" ? "movedNav" : "movedSocial", { position: target + 1 }));
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  if (!edit || !host) return null;

  const hovEl = hover ? hover.list.querySelectorAll<HTMLElement>(hover.kind === "nav" ? "[data-nav-item]" : "[data-social-index]")[hover.index] : null;
  // Réseaux : la barre se colle au TEXTE de la ligne (le lien), pas au bord de la colonne (la ligne est large comme elle).
  const hovBox = hovEl ? rectOf(hover?.kind === "social" ? (hovEl.querySelector("a") ?? hovEl) : hovEl) : null;
  const addNavBox = navItems.length ? rectOf(navItems[navItems.length - 1]) : navBox ? rectOf(navBox) : null;
  const headerSelected = selected === "site-header";

  return createPortal(
    <div className="pe-layer pe-site-layer" lang={uiLang}>
      {hover && hovBox && (
        <div
          className="pe-item-tools"
          data-kind={hover.kind}
          // Caché, pas démonté, pendant le glisser : la poignée garde la capture du pointeur.
          style={{ ...(hover.kind === "nav" ? { top: hovBox.top - 26, left: hovBox.left + hovBox.width / 2 - 46 } : { top: hovBox.top - 2, left: Math.max(window.scrollX + 4, Math.min(hovBox.left + hovBox.width + 4, window.scrollX + document.documentElement.clientWidth - SOCIAL_TOOLS_W - 4)) }), ...(drag ? { visibility: "hidden" as const } : {}) }}
          onPointerEnter={() => {
            cancelLeave();
            setHover(hover);
          }}
          role="toolbar"
          aria-label={hover.kind === "nav" ? t("navItem") : t("social")}
        >
          <button
            type="button"
            className="pe-grip-sm"
            aria-label={t("gripArrows")}
            title={t("grip")}
            onPointerDown={(e) => startDrag(e, hover.kind, rankOf(hover.kind, hovEl, hover.index).index, hover.list)}
            onKeyDown={(e) => {
              const back = hover.kind === "nav" ? "ArrowLeft" : "ArrowUp";
              const fwd = hover.kind === "nav" ? "ArrowRight" : "ArrowDown";
              if (hovEl && (e.key === back || e.key === fwd)) {
                e.preventDefault();
                e.stopPropagation();
                moveBy(hover.kind, hovEl, e.key === back ? -1 : 1);
              }
            }}
          >
            ⠿
          </button>
          {hover.kind === "social" && (
            <button
              type="button"
              aria-label={t("editLink")}
              title={t("editLink")}
              onClick={(e) => setPop({ kind: "social-edit", index: rankOf("social", hovEl, hover.index).index, key: rankOf("social", hovEl, hover.index).key, anchor: e.currentTarget, href: hovEl?.querySelector("a")?.getAttribute("href") ?? "" })}
            >
              ✎
            </button>
          )}
          {hover.kind === "nav" && (
            <button
              type="button"
              data-testid="nav-rename"
              aria-label={t("renameAria")}
              title={t("renameTitle")}
              onClick={() => {
                const field = hovEl?.querySelector<HTMLElement>('[data-site-inline="nav"]');
                setHover(null);
                if (field) document.dispatchEvent(new CustomEvent("pe:rename", { detail: { el: field } }));
              }}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            className="pe-danger"
            aria-label={hover.kind === "nav" ? t("removeNav") : t("removeSocial")}
            title={t("remove")}
            onClick={() => {
              const { key, index } = rankOf(hover.kind, hovEl, hover.index);
              const seq = post({ kind: "site-op", op: hover.kind === "nav" ? "nav-remove" : "social-remove", index, ...(key ? { key } : {}) });
              if (key) previewList(hover.kind, { t: "remove", key }, seq);
              setHover(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      {drag && <div className="pe-drop pe-drop-cursor" style={drag.marker} aria-hidden="true" />}

      {addNavBox && (headerSelected || headerNear || pop?.kind === "nav-add") && (
        <button
          type="button"
          className="pe-add-chip"
          data-testid="nav-add"
          aria-haspopup="dialog"
          aria-expanded={pop?.kind === "nav-add"}
          // Sous le dernier lien du menu : ne recouvre ni le menu ni le choix de langue.
          style={{
            top: addNavBox.top + addNavBox.height + 10,
            left: Math.min(Math.max(window.scrollX + 8, addNavBox.left + addNavBox.width - 130), window.scrollX + document.documentElement.clientWidth - 150),
          }}
          onClick={(e) => setPop({ kind: "nav-add", anchor: e.currentTarget })}
        >
          {t("addLink")}
        </button>
      )}

      {socialLists.map((list, i) => {
          const r = rectOf(list);
          return (
            <button key={i} type="button" className="pe-add-chip" data-testid="social-add" aria-haspopup="menu" aria-expanded={pop?.kind === "social-add"} style={{ top: r.top + r.height + 6, left: r.left }} onClick={(e) => setPop({ kind: "social-add", anchor: e.currentTarget })}>
              {t("addSocial")}
            </button>
          );
        })}

      {pop?.kind === "nav-add" && <NavAddPopover anchor={pop.anchor} pages={pages} onClose={() => setPop(null)} />}
      {pop?.kind === "social-add" && <SocialPopover anchor={pop.anchor} onClose={() => setPop(null)} />}
      {pop?.kind === "social-edit" && <SocialPopover anchor={pop.anchor} editIndex={pop.index} editKey={pop.key} initialHref={pop.href} onClose={() => setPop(null)} />}
    </div>,
    host,
  );
}

/** Touches d'une fenêtre ancrée : elles ne remontent pas à l'éditeur (Suppr, flèches…), Échap ferme. */
const panelKeys = (onClose: () => void) => (e: React.KeyboardEvent) => {
  e.stopPropagation();
  if (e.key === "Escape") onClose();
};

/** « + Ajouter un lien » : une page du site (recherche), ou un lien libre. */
function NavAddPopover({ anchor, pages, onClose }: { anchor: Element; pages: { id: number; title: string }[]; onClose: () => void }) {
  const t = useTranslations("canvasSite");
  const [q, setQ] = useState("");
  const [href, setHref] = useState("");
  const [label, setLabel] = useState("");
  const shown = useMemo(() => pages.filter((p) => !q || fold(p.title).includes(fold(q))).slice(0, 20), [pages, q]);
  const hrefOk = safeNavHref(href.trim());
  return (
    <Popover className="pe-popover" focusFirst anchor={anchor} label={t("addNavTitle")} onClose={onClose} onKeyDown={panelKeys(onClose)}>
      <p className="pe-popover-title">{t("addNavTitle")}</p>
      <label className="pe-board-field">
        <span>{t("aPage")}</span>
        <input type="search" autoFocus placeholder={t("searchPage")} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="pe-popover-list" role="listbox" aria-label={t("sitePages")}>
        {shown.length === 0 && <li className="pe-popover-empty">{pages.length ? t("noMatch") : t("allInMenu")}</li>}
        {shown.map((p) => (
          <li key={p.id} role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => {
                const seq = post({ kind: "site-op", op: "nav-add-page", pageId: p.id });
                previewList("nav", { t: "add", key: `p${p.id}`, label: p.title }, seq);
                onClose();
              }}
            >
              {p.title}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="pe-popover-form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!hrefOk || !label.trim()) return;
          const seq = post({ kind: "site-op", op: "nav-add-link", href: href.trim(), label: label.trim().slice(0, 60) });
          previewList("nav", { t: "add", key: `l:${href.trim()}`, label: label.trim().slice(0, 60) }, seq);
          onClose();
        }}
      >
        <span className="pe-popover-sub">{t("freeLink")}</span>
        <label className="pe-board-field">
          <span>{t("linkText")}</span>
          <input type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="pe-board-field">
          <span>{t("address")}</span>
          <input type="text" maxLength={300} placeholder={t("addressPlaceholder")} value={href} onChange={(e) => setHref(e.target.value)} aria-invalid={href.trim() !== "" && !hrefOk} />
        </label>
        {href.trim() && !hrefOk && <small className="pe-popover-error">{t("addressError")}</small>}
        <button type="submit" className="pe-btn" disabled={!hrefOk || !label.trim()}>
          {t("addThisLink")}
        </button>
      </form>
    </Popover>
  );
}

const PICKER_CLASSES = {
  title: "pe-popover-title",
  grid: "pe-network-grid",
  form: "pe-popover-form",
  field: "pe-board-field",
  hint: "pe-popover-hint",
  error: "pe-popover-error",
  button: "pe-btn",
  back: "pe-link-btn",
};

/** « + Réseau » (ou modifier un lien) : le choix de réseau partagé avec l'écran Réglages (SocialPicker). */
function SocialPopover({ anchor, editIndex, editKey, initialHref = "", onClose }: { anchor: Element; editIndex?: number; editKey?: string | null; initialHref?: string; onClose: () => void }) {
  const t = useTranslations("canvasSite");
  return (
    <Popover className="pe-popover" focusFirst anchor={anchor} label={editIndex !== undefined ? t("editSocialLink") : t("addSocialTitle")} onClose={onClose} onKeyDown={panelKeys(onClose)}>
      <SocialPicker
        mode={editIndex !== undefined ? "edit" : "add"}
        initialHref={initialHref}
        classes={PICKER_CLASSES}
        onDone={({ href, label, network }) => {
          if (editIndex !== undefined) {
            // Le lien d'un réseau ne se voit pas : l'élément est seulement marqué « en cours ».
            const seq = post({ kind: "site-op", op: "social-edit", index: editIndex, ...(editKey ? { key: editKey } : {}), href });
            if (editKey) previewList("social", { t: "pending", key: editKey }, seq);
          } else {
            const seq = post({ kind: "site-op", op: "social-add", href, label, network });
            previewList("social", { t: "add", key: socialKeyOf({ label, href }), label: label.trim() }, seq);
          }
          onClose();
        }}
      />
    </Popover>
  );
}

/** Libellé du champ neuf montré en attendant (fr, en), comme `makeField`. */
const NEW_FIELD_LABELS = { text: ["Ton nom", "Your name"], email: ["Ton e-mail", "Your email"], textarea: ["Ton message", "Your message"], select: ["Sujet", "Topic"] } as const;

/**
 * Formulaire de contact sur la toile (v0.13) : au survol d'un champ, poignée
 * (réordonner) et × (retirer ; le champ e-mail qui sert à répondre est
 * protégé par l'éditeur) ; « + Ajouter un champ » sous le formulaire (texte
 * court, e-mail, texte long, choix dans une liste). Message de confirmation
 * ou d'erreur montré à la demande du panneau (`form-preview`).
 */
export function FormLayer({ mode, host }: { mode: "off" | "edit" | "preview"; host: HTMLElement | null }) {
  const t = useTranslations("canvasSite");
  const uiLang = useLocale().slice(0, 2);
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<{ uid: string; index: number } | null>(null);
  const [menu, setMenu] = useState<{ uid: string; anchor: Element } | null>(null);
  const [drag, setDrag] = useState<Rect | null>(null);
  // Glisser en cours : la barre d'outils qui porte la poignée reste montée (sinon la capture du pointeur est perdue).
  const dragging = useRef(false);
  const edit = mode === "edit";

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (msg?.kind !== "form-preview") return;
      const block = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(msg.uid)}"]`);
      if (block) {
        block.setAttribute("data-form-preview", msg.pane);
        block.querySelector(msg.pane === "form" ? "form" : `[data-form-pane="${msg.pane}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!edit) return;
    const onMove = (e: PointerEvent) => {
      if (dragging.current) return;
      if (e.target instanceof Element && e.target.closest(".pe-layer")) return;
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-form-field]") : null;
      const uid = field?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
      setHover(field && uid ? { uid, index: Number(field.dataset.formField) } : null);
    };
    const redraw = () => setTick((n) => n + 1);
    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", redraw, { passive: true });
    const mo = new MutationObserver(redraw);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", redraw);
      mo.disconnect();
    };
  }, [edit]);

  if (!edit || !host) return null;
  const forms = [...document.querySelectorAll<HTMLElement>("form[data-form-edit]")]
    .map((form) => ({ form, uid: form.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "" }))
    .filter((x) => x.uid);
  const fieldEl = (uid: string, i: number) => document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"] [data-form-field="${i}"]`);
  const hovEl = hover ? fieldEl(hover.uid, hover.index) : null;
  const hovBox = hovEl ? rectOf(hovEl) : null;
  /** Rang du champ dans la liste telle que l'éditeur la tient (aperçus en attente compris), et sa clé. */
  const fieldRank = (uid: string, el: Element | null, fallback: number) => {
    const key = el?.getAttribute("data-form-field-id") ?? null;
    const i = key ? listKeys(`form:${uid}`).indexOf(key) : -1;
    return { key, index: i >= 0 ? i : fallback };
  };

  const startDrag = (e: React.PointerEvent, uid: string, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    dragging.current = true;
    document.documentElement.setAttribute("data-edit-dragging", "");
    const els = () => visual([...document.querySelectorAll<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"] [data-form-field-id]`)]);
    const draggedKey = listKeys(`form:${uid}`)[from] ?? null;
    let to = from;
    const move = (ev: PointerEvent) => {
      const list = els();
      to = list.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 < ev.clientY;
      }).length;
      const ref = list[Math.min(to, list.length - 1)];
      if (ref) {
        const r = rectOf(ref);
        setDrag({ top: to >= list.length ? r.top + r.height + 4 : r.top - 6, left: r.left, width: r.width, height: 3 });
      }
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.documentElement.removeAttribute("data-edit-dragging");
      dragging.current = false;
      setDrag(null);
      if (to !== from && to !== from + 1) {
        const target = to > from ? to - 1 : to;
        const seq = post({ kind: "form-field", uid, op: "move", index: from, to: target });
        if (draggedKey) previewList(`form:${uid}`, { t: "move", key: draggedKey, to: target }, seq);
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return createPortal(
    <div className="pe-layer pe-form-layer" lang={uiLang}>
      {hover && hovBox && (
        <div className="pe-item-tools" data-kind="field" style={{ top: hovBox.top, left: hovBox.left + hovBox.width + 8, ...(drag ? { visibility: "hidden" as const } : {}) }} onPointerEnter={() => setHover(hover)} role="toolbar" aria-label={t("formField")}>
          <button type="button" className="pe-grip-sm" aria-label={t("gripField")} title={t("grip")} onPointerDown={(e) => startDrag(e, hover.uid, fieldRank(hover.uid, hovEl, hover.index).index)}>
            ⠿
          </button>
          <button
            type="button"
            className="pe-field-op-sm"
            data-testid="field-help-op"
            onClick={() => {
              const { index } = fieldRank(hover.uid, hovEl, hover.index);
              post({ kind: "form-field", uid: hover.uid, op: hovEl?.hasAttribute("data-form-has-help") ? "help-remove" : "help-add", index });
              setHover(null);
            }}
          >
            {hovEl?.hasAttribute("data-form-has-help") ? t("removeHelp") : t("addHelp")}
          </button>
          <button
            type="button"
            className="pe-danger"
            aria-label={t("removeField")}
            title={hovEl?.hasAttribute("data-form-reply") ? t("replyField") : t("remove")}
            onClick={() => {
              const { key, index } = fieldRank(hover.uid, hovEl, hover.index);
              const seq = post({ kind: "form-field", uid: hover.uid, op: "remove", index });
              if (key) previewList(`form:${hover.uid}`, { t: "remove", key }, seq);
              setHover(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {drag && <div className="pe-drop pe-drop-cursor" style={drag} aria-hidden="true" />}
      {forms.map(({ form, uid }) => {
        const fields = visual([...form.querySelectorAll<HTMLElement>("[data-form-field-id]")]);
        const last = fields[fields.length - 1];
        if (!last || fields.length >= 12) return null;
        const r = rectOf(last);
        return (
          <button
            key={uid}
            type="button"
            className="pe-add-chip"
            data-testid="field-add"
            style={{ top: r.top + r.height + 6, left: r.left + r.width - 140 }}
            // Ancré sur la puce elle-même (et non sous le dernier champ : un texte long
            // l'envoyait hors de la fenêtre, le menu semblait ne pas s'ouvrir).
            aria-haspopup="menu"
            aria-expanded={menu?.uid === uid}
            onClick={(e) => setMenu({ uid, anchor: e.currentTarget })}
          >
            {t("addField")}
          </button>
        );
      })}
      {menu && (
        <Popover className="pe-popover" focusFirst anchor={menu.anchor} label={t("addFieldTitle")} onClose={() => setMenu(null)} onKeyDown={panelKeys(() => setMenu(null))}>
          <p className="pe-popover-title">{t("addFieldTitle")}</p>
          <ul className="pe-popover-list" role="menu" aria-label={t("fieldTypes")}>
            {(
              [
                ["text", t("typeText")],
                ["email", t("typeEmail")],
                ["textarea", t("typeTextarea")],
                ["select", t("typeSelect")],
              ] as const
            ).map(([type, label]) => (
              <li key={type} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    // Identifiant choisi ici : le champ montré en attendant et le champ réel se reconnaissent.
                    const id = newFieldId();
                    const seq = post({ kind: "form-field", uid: menu.uid, op: "add", fieldType: type, id });
                    previewList(`form:${menu.uid}`, { t: "add", key: id, label: NEW_FIELD_LABELS[type][document.documentElement.lang === "en" ? 1 : 0] }, seq);
                    setMenu(null);
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>,
    host,
  );
}
