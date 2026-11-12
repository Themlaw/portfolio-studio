"use client";

/**
 * Surlignage des éléments qui utilisent un rôle de couleur de la palette (lots 17f et 19b). Un seul code pour :
 *
 * - la toile de l'éditeur visuel (SiteLookLayer : message `highlight`, panneau « Couleurs » du site) ;
 * - l'aperçu de l'éditeur de thème (PreviewBridge : message `portfolio:highlight`).
 *
 * `findUsers` cherche, dans la page affichée, les éléments dont une couleur calculée est celle du rôle ;
 * `useRoleHighlight` les re-mesure à chaque rendu, défilement et redimensionnement et renvoie la légende
 * « utilisé par » ; `HighlightBoxes` dessine contours et halo (couleurs de l'interface d'édition, jamais du thème).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminT } from "@/i18n/admin-lang";
import type { BaseKey } from "@/themes/palette";

import "@/app/admin/highlight.css";

export type Box = { top: number; left: number; width: number; height: number };
export type Found = { boxes: Box[]; frame: boolean; uses: string[]; count: number };

export const ROLE_VAR: Record<BaseKey, string> = {
  bg: "--t-color-bg",
  surface: "--t-color-surface",
  ink: "--t-color-ink",
  primary: "--t-color-primary",
  secondary: "--t-color-secondary",
  tertiary: "--t-color-tertiary",
};

/** Couleur calculée (notation rvb du navigateur) d'une variable du thème, telle que la page l'affiche. */
function computedOf(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");

/** Clé d'usage d'un élément pour la légende (editMenusHighlight : « titres », « paragraphes »…). */
function usageOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.closest("header.site-header")) return tag === "a" || el.closest("nav") ? "menu" : "header";
  if (el.closest("footer")) return "footer";
  if (el.classList.contains("eyebrow")) return "eyebrows";
  if (/^h[1-6]$/.test(tag)) return "headings";
  if (tag === "button" || el.classList.contains("btn") || el.getAttribute("role") === "button") return "buttons";
  if (tag === "a") return "links";
  if (tag === "figcaption" || el.classList.contains("caption-text")) return "captions";
  if (tag === "input" || tag === "textarea" || tag === "select") return "fields";
  if (tag === "p" || tag === "li" || tag === "span") return "paragraphs";
  if (tag === "section" || tag === "article") return "sections";
  if (tag === "hr") return "rules";
  return "cards";
}

export function findUsers(role: BaseKey, t: AdminT): Found {
  const target = computedOf(ROLE_VAR[role]);
  const boxes: Box[] = [];
  const counts = new Map<string, number>();
  const matched = new Set<Element>();
  let frame = false;
  const docW = document.documentElement.scrollWidth;
  const docH = document.documentElement.scrollHeight;
  const surfaceRole = role === "bg" || role === "surface";
  const all = [document.body, ...document.querySelectorAll<HTMLElement>("body *")];
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
  const uses = [...counts].sort((a, b) => b[1] - a[1]).map(([key]) => t(key)).slice(0, 6);
  return { boxes, frame, uses, count: [...counts.values()].reduce((a, b) => a + b, 0) };
}

/**
 * Éléments du rôle surligné, recalculés à chaque rendu de la page. `report` reçoit la légende (rôle, nombre
 * d'éléments, usages) quand elle change : l'éditeur la renvoie à son panneau.
 */
export function useRoleHighlight(role: BaseKey | null, report: (role: BaseKey, count: number, uses: string[]) => void): Found | null {
  const t = useTranslations("editMenusHighlight");
  const [found, setFound] = useState<Found | null>(null);
  const [tick, setTick] = useState(0);
  const lastInfo = useRef("");
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });

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
    // Une feuille de style (thème, palette) qui change déplace les couleurs sans toucher au corps de la page.
    mo.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["media"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  const compute = useCallback(() => {
    if (!role) {
      setFound(null);
      return;
    }
    const f = findUsers(role, t);
    setFound(f);
    const key = `${role}|${f.count}|${f.uses.join(",")}`;
    if (key !== lastInfo.current) {
      lastInfo.current = key;
      reportRef.current(role, f.count, f.uses);
    }
  }, [role, t]);
  useEffect(() => {
    if (!role) lastInfo.current = "";
    // Après le rendu en cours (le DOM de la page est à jour), hors du corps de l'effet.
    const frame = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(frame);
  }, [compute, role, tick]);

  return found;
}

/** Contours et halo des éléments trouvés (dans un `.pe-layer`/`.pe-host`). */
export function HighlightBoxes({ found }: { found: Found | null }) {
  return (
    <>
      {found?.frame && <div className="sl-frame" aria-hidden="true" data-testid="hl-frame" />}
      {found?.boxes.map((b, i) => (
        <div key={i} className="sl-hl" data-testid="hl-box" aria-hidden="true" style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />
      ))}
    </>
  );
}
