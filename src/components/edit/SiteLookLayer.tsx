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
import { useEffect, useRef, useState } from "react";

import { acceptToCanvas, EDIT_MSG } from "@/lib/edit/protocol";
import type { BaseKey } from "@/themes/palette";
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

import { HighlightBoxes, useRoleHighlight } from "./highlight";
import { overlayData, postIntent, refreshCards, setOverlay } from "./optimistic";

type SiteLook = { palette: SitePalette; logo: Logo };

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
  refreshCards();
  for (const id of SERVER_SHEETS) {
    const sheet = document.getElementById(id);
    if (sheet && sheet.getAttribute("media") !== "not all") sheet.setAttribute("media", "not all");
  }
}

function clearPreview() {
  document.getElementById("pe-sitelook-preview")?.remove();
  for (const id of SERVER_SHEETS) document.getElementById(id)?.removeAttribute("media");
  refreshCards();
}

/** Montre `next` tout de suite et l'envoie à l'éditeur ; renvoie le numéro de l'intention. */
export function emitSiteLook(next: SiteLook): number {
  const look: SiteLook = { palette: cleanSitePalette(next.palette) ?? {}, logo: cleanLogo(next.logo) ?? {} };
  const seq = postIntent({ kind: "site-look", palette: look.palette, logo: look.logo });
  setOverlay("sitelook", seq, { data: look, apply: () => applyPreview(look), clear: clearPreview });
  return seq;
}

/* ---- Calque --------------------------------------------------------------------------------- */

const clampSize = (n: number) => Math.max(LOGO_SIZE_MIN, Math.min(LOGO_SIZE_MAX, Math.round(n)));

export default function SiteLookLayer({ headerSelected, dragging }: { headerSelected: boolean; dragging: boolean }) {
  const [role, setRole] = useState<BaseKey | null>(null);
  const [overHeader, setOverHeader] = useState(false);
  const [dragSize, setDragSize] = useState<number | null>(null);
  const drag = useRef<{ y: number; size: number } | null>(null);

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

  // Éléments du rôle surligné (recalculés à chaque rendu), légende renvoyée au panneau.
  const found = useRoleHighlight(role, (r, count, uses) => window.parent.postMessage({ type: EDIT_MSG, kind: "highlight-info", role: r, count, uses }, window.location.origin));

  // En-tête survolé : la poignée du logo apparaît.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const over = e.target instanceof Element && Boolean(e.target.closest('[data-edit-global="header"], .sl-logo-handle'));
      setOverHeader((prev) => (prev === over ? prev : over));
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

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
      <HighlightBoxes found={found} />
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
