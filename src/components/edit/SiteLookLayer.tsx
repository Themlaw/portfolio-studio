"use client";

/**
 * Palette et logo du site sur la toile (lot 17f), dans le calque de la couche d'édition :
 *
 * - aperçu immédiat de la palette et du logo posés depuis le panneau « Couleurs » / « Logo » de
 *   l'éditeur (message `site-look`) : la toile les montre aussitôt, renvoie l'intention `site-look`
 *   (numéro `seq`) et garde l'aperçu jusqu'à l'acquittement du serveur (optimistic.ts : settle,
 *   revert) ; les feuilles rendues par le serveur (`#site-palette`, `#site-logo`) sont mises de côté
 *   (`media="not all"`) le temps de l'aperçu, qui peut ainsi aussi REVENIR à la couleur du thème ;
 * - surlignage des éléments qui utilisent un rôle de couleur survolé dans le panneau (message
 *   `highlight`) : contour et halo, couleurs de l'interface d'édition (jamais du thème), halo animé
 *   seulement si l'utilisateur n'a pas demandé moins de mouvement ; la légende « utilisé par » repart
 *   vers le panneau (`highlight-info`) ;
 * - poignée de taille du logo, sous le nom ou la signature de l'en-tête : glisser, ou flèches.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { acceptToCanvas, EDIT_MSG } from "@/lib/edit/protocol";
import {
  cleanLogo,
  cleanSitePalette,
  logoCss,
  LOGO_SIZE_DEFAULT,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  SiteStylesSchema,
  type Logo,
  type SitePalette,
} from "@/lib/look";
import { sitePaletteCss, type ThemeColor } from "@/themes/css";
import type { BaseKey } from "@/themes/palette";

import { overlayData, postIntent, setOverlay } from "./optimistic";

type SiteLook = { palette: SitePalette; logo: Logo };
type Box = { top: number; left: number; width: number; height: number };

/* ---- État : serveur + aperçu en attente ----------------------------------------------- */

function serverLook(): SiteLook {
  try {
    const styles = SiteStylesSchema.safeParse(JSON.parse(document.getElementById("site-styles")?.dataset.editStyles ?? "{}")).data ?? {};
    return { palette: styles.palette ?? {}, logo: styles.logo ?? {} };
  } catch {
    return { palette: {}, logo: {} };
  }
}

/** Palette et logo actuels : l'aperçu non acquitté fait foi (deux gestes rapprochés partent de la bonne base). */
export function currentSiteLook(): SiteLook {
  return overlayData<SiteLook>("sitelook") ?? serverLook();
}

/** Couleurs du thème actif (sans la palette du site), posées par le serveur sur `#site-palette`. */
function themeBase(): { color: ThemeColor; palette: null } | null {
  try {
    const raw = JSON.parse(document.getElementById("site-palette")?.dataset.editTheme ?? "null") as { color?: ThemeColor; palette?: unknown } | null;
    return raw?.color && typeof raw.color.bg === "string" ? { color: raw.color, palette: (raw.palette ?? null) as null } : null;
  } catch {
    return null;
  }
}

const SERVER_SHEETS = ["site-palette", "site-logo"];

function applyPreview(look: SiteLook) {
  const base = themeBase();
  let el = document.getElementById("pe-sitelook-preview");
  if (!el) {
    el = document.createElement("style");
    el.id = "pe-sitelook-preview";
  }
  // Avant les styles de rôle (même ordre que le serveur : un réglage du « Nom du site » passe devant le logo).
  const anchor = document.getElementById("site-styles");
  if (anchor && el.nextElementSibling !== anchor) anchor.before(el);
  else if (!anchor && !el.isConnected) document.body.appendChild(el);
  const css = [base ? sitePaletteCss(base, look.palette, true) : "", logoCss(look.logo)].filter(Boolean).join("\n");
  if (el.textContent !== css) el.textContent = css;
  for (const id of SERVER_SHEETS) {
    const sheet = document.getElementById(id);
    if (sheet && sheet.getAttribute("media") !== "not all") sheet.setAttribute("media", "not all");
  }
}

function clearPreview() {
  document.getElementById("pe-sitelook-preview")?.remove();
  for (const id of SERVER_SHEETS) document.getElementById(id)?.removeAttribute("media");
}

/** Montre `next` tout de suite et l'envoie à l'éditeur ; renvoie le numéro de l'intention. */
export function emitSiteLook(next: SiteLook): number {
  const look: SiteLook = { palette: cleanSitePalette(next.palette) ?? {}, logo: cleanLogo(next.logo) ?? {} };
  const seq = postIntent({ kind: "site-look", palette: look.palette, logo: look.logo });
  setOverlay("sitelook", seq, { data: look, apply: () => applyPreview(look), clear: clearPreview });
  return seq;
}

/* ---- Surlignage ------------------------------------------------------------------------- */

const ROLE_VAR: Record<BaseKey, string> = {
  bg: "--t-color-bg",
  surface: "--t-color-surface",
  ink: "--t-color-ink",
  primary: "--t-color-primary",
  secondary: "--t-color-secondary",
  tertiary: "--t-color-tertiary",
};

/** Couleur calculée (notation rvb du navigateur) d'une variable du thème, telle que la toile l'affiche. */
function computedOf(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");

/** Nom d'usage d'un élément pour la légende (« titres », « paragraphes »…). */
function usageOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.closest("header.site-header")) return tag === "a" || el.closest("nav") ? "menu" : "en-tête";
  if (el.closest("footer")) return "pied de page";
  if (el.classList.contains("eyebrow")) return "étiquettes";
  if (/^h[1-6]$/.test(tag)) return "titres";
  if (tag === "button" || el.classList.contains("btn") || el.getAttribute("role") === "button") return "boutons";
  if (tag === "a") return "liens";
  if (tag === "figcaption" || el.classList.contains("caption-text")) return "légendes";
  if (tag === "input" || tag === "textarea" || tag === "select") return "champs";
  if (tag === "p" || tag === "li" || tag === "span") return "paragraphes";
  if (tag === "section" || tag === "article") return "sections";
  if (tag === "hr") return "filets";
  return "cartes et encadrés";
}

type Found = { boxes: Box[]; frame: boolean; uses: string[]; count: number };

function findUsers(role: BaseKey): Found {
  const target = computedOf(ROLE_VAR[role]);
  const boxes: Box[] = [];
  const counts = new Map<string, number>();
  const matched = new Set<Element>();
  let frame = false;
  const docW = document.documentElement.scrollWidth;
  const docH = document.documentElement.scrollHeight;
  const surfaceRole = role === "bg" || role === "surface";
  const all = document.querySelectorAll<HTMLElement>("body *");
  for (const el of all) {
    if (el.closest(".pe-host") || /^(script|style|link|meta|noscript|svg|path)$/i.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const bgHit = cs.backgroundColor === target;
    const textHit = cs.color === target && hasOwnText(el);
    const borderHit = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && cs.borderTopColor === target;
    const hit = role === "bg" || role === "surface" ? bgHit : role === "ink" ? textHit : bgHit || textHit || borderHit;
    if (!hit) continue;
    matched.add(el);
    // Fonds imbriqués : seul le plus extérieur est surligné.
    if (surfaceRole && el.parentElement && matched.has(el.parentElement)) continue;
    counts.set(usageOf(el), (counts.get(usageOf(el)) ?? 0) + 1);
    // Cadre de la page entière : un liseré autour de la fenêtre plutôt qu'une boîte de la hauteur du document.
    if (r.width >= docW * 0.95 && r.height >= Math.min(docH, window.innerHeight) * 0.95 && (el === document.body || el.classList.contains("site-frame") || r.height >= docH * 0.9)) {
      frame = true;
      continue;
    }
    if (boxes.length < 80) boxes.push({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
  }
  const uses = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 6);
  return { boxes, frame, uses, count: [...counts.values()].reduce((a, b) => a + b, 0) };
}

/* ---- Calque --------------------------------------------------------------------------------- */

const clampSize = (n: number) => Math.max(LOGO_SIZE_MIN, Math.min(LOGO_SIZE_MAX, Math.round(n)));

export default function SiteLookLayer({ headerSelected, dragging }: { headerSelected: boolean; dragging: boolean }) {
  const [role, setRole] = useState<BaseKey | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [tick, setTick] = useState(0);
  const [overHeader, setOverHeader] = useState(false);
  const [dragSize, setDragSize] = useState<number | null>(null);
  const drag = useRef<{ y: number; size: number } | null>(null);
  const lastInfo = useRef("");

  // Messages de l'éditeur : aperçu de la palette / du logo, rôle à surligner.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (msg?.kind === "site-look") emitSiteLook({ palette: msg.palette, logo: msg.logo });
      else if (msg?.kind === "highlight") setRole(msg.role);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Re-mesure : rendu de la page, défilement, redimensionnement.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const mo = new MutationObserver((records) => {
      if (records.every((r) => (r.target as Element).closest?.(".pe-host") || (r.target as Node).parentElement?.closest?.(".pe-host"))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "media", "data-scrolled"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  // En-tête survolé : la poignée du logo apparaît.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const over = e.target instanceof Element && Boolean(e.target.closest('[data-edit-global="header"], .sl-logo-handle'));
      setOverHeader((prev) => (prev === over ? prev : over));
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  // Éléments du rôle surligné (recalculés à chaque rendu), et légende renvoyée au panneau.
  const compute = useCallback(() => {
    if (!role) {
      setFound(null);
      return;
    }
    const f = findUsers(role);
    setFound(f);
    const key = `${role}|${f.count}|${f.uses.join(",")}`;
    if (key !== lastInfo.current) {
      lastInfo.current = key;
      window.parent.postMessage({ type: EDIT_MSG, kind: "highlight-info", role, count: f.count, uses: f.uses }, window.location.origin);
    }
  }, [role]);
  useEffect(() => {
    if (!role) lastInfo.current = "";
    // Après le rendu en cours (le DOM de la page est à jour), hors du corps de l'effet.
    const frame = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(frame);
  }, [compute, role, tick]);

  if (dragging) return null;

  const brand = document.querySelector<HTMLElement>(".site-header .site-brand");
  const look = currentSiteLook();
  const size = dragSize ?? look.logo.size ?? LOGO_SIZE_DEFAULT;
  const brandRect = brand?.getBoundingClientRect();
  const showHandle = Boolean(brand && brandRect && (headerSelected || overHeader || dragSize !== null));

  const setSize = (next: number) => {
    const cur = currentSiteLook();
    emitSiteLook({ palette: cur.palette, logo: { ...cur.logo, size: clampSize(next) } });
  };

  return (
    <div className="pe-layer pe-sitelook-layer" lang="fr">
      {found?.frame && <div className="sl-frame" aria-hidden="true" data-testid="hl-frame" />}
      {found?.boxes.map((b, i) => (
        <div key={i} className="sl-hl" data-testid="hl-box" aria-hidden="true" style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />
      ))}
      {showHandle && brandRect && (
        <button
          type="button"
          role="slider"
          className="sl-logo-handle"
          data-testid="logo-handle"
          aria-label="Taille du logo : flèches haut et bas, glisser vers le bas pour agrandir"
          aria-orientation="vertical"
          aria-valuemin={LOGO_SIZE_MIN}
          aria-valuemax={LOGO_SIZE_MAX}
          aria-valuenow={size}
          aria-valuetext={`${size} pixels`}
          title="Taille du logo : glisse vers le bas pour l'agrandir"
          style={{ top: brandRect.bottom + window.scrollY - 9, left: brandRect.right + window.scrollX - 9 }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, size };
            setDragSize(size);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const next = clampSize(drag.current.size + (e.clientY - drag.current.y));
            setDragSize(next);
            setSize(next);
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragSize(null);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragSize(null);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            const next = e.key === "ArrowUp" || e.key === "ArrowLeft" ? size - step : e.key === "ArrowDown" || e.key === "ArrowRight" ? size + step : e.key === "Home" ? LOGO_SIZE_MIN : e.key === "End" ? LOGO_SIZE_MAX : null;
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            setSize(next);
          }}
        >
          {dragSize !== null && <span className="sl-logo-value">{dragSize} px</span>}
        </button>
      )}
    </div>
  );
}
