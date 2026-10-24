"use client";

/**
 * Menu des polices (lot 2), partagé par la barre typographique de la toile et
 * les « Styles du site » du panneau : recherche, catégories, aperçu de chaque
 * famille dans sa police. En tête : polices du thème et polices embarquées
 * (OFL) ; puis le catalogue Google Fonts embarqué (aucune requête vers
 * Google : les aperçus viennent de /admin/api/fonts/preview, téléchargés par
 * le serveur). Les polices déjà téléchargées pour le site sont marquées.
 * Lot 70 : « Récentes » en tête (les 6 dernières polices choisies, mémorisées par le
 * serveur) ; leurs aperçus se chargent comme ceux du catalogue, à la demande.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fontLabel, fontStack, THEME_FONTS } from "@/lib/look";
import { CATEGORY_LABELS, GOOGLE_FONTS, type GoogleCategory } from "@/themes/google-fonts";
import { FONT_IDS } from "@/themes/schema";

import { useRecentFonts } from "./recent-fonts";
import { useDismiss } from "./useDismiss";

const PAGE = 60;
const loaded = new Map<string, Promise<boolean>>();

/** Aperçu d'une famille Google : sous-ensemble servi par le serveur, chargé une fois. */
function loadPreview(family: string): Promise<boolean> {
  let p = loaded.get(family);
  if (!p) {
    const face = new FontFace(`pv ${family}`, `url("/admin/api/fonts/preview?famille=${encodeURIComponent(family)}")`);
    p = face.load().then(
      (f) => {
        document.fonts.add(f);
        return true;
      },
      () => false,
    );
    loaded.set(family, p);
  }
  return p;
}

function GoogleItem({ family, installed, current, onPick, eager, recent }: { family: string; installed: boolean; current: boolean; onPick: () => void; eager: boolean; recent?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Premiers de la liste : tout de suite ; les autres quand ils défilent sous les yeux.
    if (eager) {
      void loadPreview(family).then(setReady);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void loadPreview(family).then(setReady);
        }
      },
      { root: el.closest(".fm-list") },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [family, eager]);
  return (
    <button ref={ref} type="button" role="option" aria-selected={current} className="fm-item" {...(recent ? { "data-recent-font": `g:${family}` } : { "data-font": `g:${family}` })} onClick={onPick}>
      <span className="fm-name" style={ready ? { fontFamily: `"pv ${family}", system-ui` } : undefined}>
        {family}
      </span>
      {installed && <span className="fm-badge">sur le site</span>}
    </button>
  );
}

export default function FontMenu({
  value,
  installed,
  themeNames,
  onPick,
  onClose,
}: {
  value: string | undefined;
  installed: string[];
  /** Nom réel des polices du thème (titres, texte, légendes). */
  themeNames?: Partial<Record<(typeof THEME_FONTS)[number], string>>;
  onPick: (ref: string | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<GoogleCategory | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  // Lot 65 (R3) : la liste s'ouvre sous la barre qui l'a ouverte, mais reste TOUJOURS entièrement dans la fenêtre du navigateur,
  // recherche comprise, sans défiler la page : sous la barre si elle y tient, sinon au-dessus, sinon du côté le plus grand en
  // réduisant sa hauteur (la liste défile en interne) ; décalée pour ne pas sortir à droite ni à gauche.
  useLayoutEffect(() => {
    const el = root.current;
    const parent = el?.offsetParent;
    if (!el || !parent) return;
    const win = el.ownerDocument.defaultView ?? window;
    const EDGE = 8;
    const GAP = 6;
    const place = () => {
      el.style.top = "";
      el.style.left = "";
      el.style.height = "";
      const vw = el.ownerDocument.documentElement.clientWidth;
      const vh = win.innerHeight;
      const p = parent.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = vh - EDGE - (p.bottom + GAP);
      const above = p.top - GAP - EDGE;
      let top = p.bottom + GAP;
      let height = h;
      if (h > below) {
        if (h <= above) top = p.top - GAP - h;
        else if (Math.max(below, above) >= 220) {
          height = Math.max(below, above);
          top = below >= above ? p.bottom + GAP : p.top - GAP - height;
        } else {
          // Aucune des deux places ne convient : la fenêtre se pose dans l'écran, par-dessus la barre.
          height = Math.min(h, vh - 2 * EDGE);
          top = Math.max(EDGE, Math.min(p.bottom + GAP, vh - EDGE - height));
        }
      }
      let left = p.left;
      left = Math.max(EDGE, Math.min(left, vw - EDGE - w));
      if (height !== h) el.style.height = `${Math.round(height)}px`;
      if (top !== p.bottom + GAP) el.style.top = `${Math.round(top - p.top)}px`;
      if (left !== p.left) el.style.left = `${Math.round(left - p.left)}px`;
    };
    place();
    win.addEventListener("resize", place);
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) place();
    };
    win.addEventListener("scroll", onScroll, true);
    const ro = new win.ResizeObserver(place);
    ro.observe(parent);
    return () => {
      win.removeEventListener("resize", place);
      win.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
    };
  }, []);
  // Clic ailleurs : le menu se ferme (la police déjà choisie reste appliquée).
  useDismiss(root, onClose);
  const q = query.trim().toLowerCase();
  const google = useMemo(
    () => GOOGLE_FONTS.filter((f) => (cat === "all" || f.category === cat) && (!q || f.family.toLowerCase().includes(q))),
    [q, cat],
  );
  const local = [
    ...THEME_FONTS.map((t) => `theme:${t}`),
    ...FONT_IDS.map((id) => `embed:${id}`),
  ].filter((ref) => !q || fontLabel(ref).toLowerCase().includes(q) || (ref.startsWith("theme:") && themeNames?.[ref.slice(6) as "display"]?.toLowerCase().includes(q)));
  const installedSet = new Set(installed);
  const { recent, remember } = useRecentFonts();
  // Récentes : la plus récente d'abord, filtrées par la recherche (et la catégorie, pour le catalogue).
  const recents = recent.filter((ref) => {
    if (ref.startsWith("g:")) return google.some((f) => f.family === ref.slice(2));
    return cat === "all" && local.includes(ref);
  });
  const choose = (ref: string | undefined) => {
    if (ref) remember(ref);
    onPick(ref);
  };

  return (
    <div
      ref={root}
      className="fm"
      role="dialog"
      aria-label="Choisir une police"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="fm-head">
        <input
          ref={input}
          className="fm-search"
          type="search"
          placeholder={`Rechercher parmi ${GOOGLE_FONTS.length + local.length} polices`}
          aria-label="Rechercher une police"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
        />
        <div className="fm-cats" role="group" aria-label="Catégorie">
          {(["all", "sans", "serif", "display", "handwriting", "mono"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => (setCat(c), setShown(PAGE))}>
              {c === "all" ? "Toutes" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <div
        className="fm-list"
        role="listbox"
        aria-label="Polices"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && shown < google.length) setShown((n) => n + PAGE);
        }}
      >
        <button type="button" role="option" aria-selected={!value} className="fm-item fm-reset" onClick={() => onPick(undefined)}>
          <span className="fm-name">Police par défaut (style global)</span>
        </button>
        {recents.length > 0 && (
          <div className="fm-recent" role="group" aria-label="Polices récentes">
            <p className="fm-group">Récentes</p>
            {recents.map((ref) =>
              ref.startsWith("g:") ? (
                <GoogleItem key={ref} recent eager={false} family={ref.slice(2)} installed={installedSet.has(ref.slice(2))} current={value === ref} onPick={() => choose(ref)} />
              ) : (
                <button key={ref} type="button" role="option" aria-selected={value === ref} className="fm-item" data-recent-font={ref} onClick={() => choose(ref)}>
                  <span className="fm-name" style={{ fontFamily: fontStack(ref) ?? undefined }}>
                    {fontLabel(ref)}
                    {ref.startsWith("theme:") && themeNames?.[ref.slice(6) as "display"] ? ` — ${themeNames[ref.slice(6) as "display"]}` : ""}
                  </span>
                </button>
              ),
            )}
          </div>
        )}
        {cat === "all" && local.length > 0 && (
          <>
            <p className="fm-group">Thème et polices du site</p>
            {local.map((ref) => (
              <button key={ref} type="button" role="option" aria-selected={value === ref} className="fm-item" data-font={ref} onClick={() => choose(ref)}>
                <span className="fm-name" style={{ fontFamily: fontStack(ref) ?? undefined }}>
                  {fontLabel(ref)}
                  {ref.startsWith("theme:") && themeNames?.[ref.slice(6) as "display"] ? ` — ${themeNames[ref.slice(6) as "display"]}` : ""}
                </span>
              </button>
            ))}
          </>
        )}
        <p className="fm-group">Google Fonts · téléchargée par le site au premier choix</p>
        {google.slice(0, shown).map((f, i) => (
          <GoogleItem key={f.family} eager={i < 10} family={f.family} installed={installedSet.has(f.family)} current={value === `g:${f.family}`} onPick={() => choose(`g:${f.family}`)} />
        ))}
        {google.length === 0 && <p className="fm-empty">Aucune police ne correspond.</p>}
      </div>
    </div>
  );
}
