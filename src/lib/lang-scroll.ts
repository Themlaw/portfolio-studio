/**
 * Position de défilement gardée au changement de langue (lot 87).
 *
 * Les deux langues n'ont pas la même hauteur (textes de longueurs différentes) : la position n'est donc pas
 * gardée en pixels mais SUR LE CONTENU. Avant de changer de langue, on retient le bloc de la page qui est juste
 * sous l'en-tête et le décalage dans ce bloc (en proportion de sa hauteur) ; une fois la nouvelle page affichée,
 * on remet ce bloc au même endroit. Les blocs sont les éléments de premier niveau de `<main id="contenu">` (les
 * enveloppes `display: contents` sont traversées) : mêmes blocs, dans le même ordre, dans les deux langues, sans
 * rien ajouter au HTML public. Si le nombre de blocs diffère (bloc vide dans une langue), repli : la proportion
 * de défilement de la page.
 *
 * Module sans état ni React : utilisé par le sélecteur de langue du site (`LocaleSwitcher` + `LangScrollRestore`)
 * et par la bascule FR / EN de l'éditeur visuel, qui l'applique au document de la toile (iframe).
 */

export type LangSnap =
  | { kind: "top" }
  | { kind: "frac"; frac: number }
  | { kind: "block"; index: number; count: number; tag: string; ratio: number | null; px: number; frac: number };

/** Passage en cours (sessionStorage, le temps d'une navigation) : jamais conservé au-delà de ce délai. */
export const LANG_SCROLL_KEY = "portfolio-lang-scroll";
export const LANG_SCROLL_TTL_MS = 15000;

export type LangRecord = { snap: LangSnap; to: string; t: number };

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);

/** Blocs de la page : éléments de premier niveau de `<main>`, enveloppes `display: contents` traversées, hauteur nulle écartée. */
export function blockEls(doc: Document): HTMLElement[] {
  const root = doc.getElementById("contenu");
  const view = doc.defaultView;
  if (!root || !view) return [];
  const out: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof view.HTMLElement) || SKIP.has(child.tagName) || child.hidden) continue;
      if (view.getComputedStyle(child).display === "contents") walk(child);
      else if (child.getBoundingClientRect().height > 0) out.push(child);
    }
  };
  walk(root);
  return out;
}

/** Ligne de référence : le bas de l'en-tête collant (le contenu visible commence dessous), 0 sans en-tête collant. */
function refLine(win: Window): number {
  const header = win.document.querySelector<HTMLElement>("header.site-header");
  if (!header) return 0;
  if (win.getComputedStyle(header).position !== "sticky") return 0;
  return Math.max(0, header.getBoundingClientRect().bottom);
}

/** Retient où l'on est dans la page. `null` : page sans équivalent à retrouver (404), rien à garder. */
export function takeSnap(win: Window): LangSnap | null {
  const doc = win.document;
  if (doc.querySelector("[data-not-found]")) return null;
  const y = win.scrollY;
  if (y <= 1) return { kind: "top" };
  const maxY = Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
  const frac = Math.min(1, y / maxY);
  const ref = refLine(win);
  const els = blockEls(doc);
  for (let index = 0; index < els.length; index++) {
    const r = els[index].getBoundingClientRect();
    if (r.bottom <= ref + 1) continue;
    return {
      kind: "block",
      index,
      count: els.length,
      tag: els[index].tagName,
      // Bloc commencé au-dessus de la ligne : proportion déjà parcourue ; sinon espace entre la ligne et le bloc, en pixels.
      ratio: r.top <= ref ? (ref - r.top) / r.height : null,
      px: r.top > ref ? r.top - ref : 0,
      frac,
    };
  }
  return { kind: "frac", frac };
}

/** Position de défilement (en pixels, dans la page courante) qui remet le contenu retenu à sa place. */
export function targetY(win: Window, snap: LangSnap): number {
  if (snap.kind === "top") return 0;
  const doc = win.document;
  const maxY = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
  if (snap.kind === "block") {
    const els = blockEls(doc);
    const el = els.length === snap.count ? els[snap.index] : undefined;
    if (el && el.tagName === snap.tag) {
      const r = el.getBoundingClientRect();
      const ref = refLine(win);
      const want = snap.ratio !== null ? ref - snap.ratio * r.height : ref + snap.px;
      return Math.max(0, Math.min(maxY, win.scrollY + (r.top - want)));
    }
  }
  return Math.round(snap.frac * maxY);
}

function jump(win: Window, top: number) {
  // `html { scroll-behavior: smooth }` : sans « instant », la page glisserait au lieu de rester en place.
  win.scrollTo({ top, left: 0, behavior: "instant" });
}

/**
 * Applique la position retenue, puis la corrige tant que la page se met en page (images, polices, hauteur qui change)
 * pendant un court moment. S'arrête dès que la personne défile elle-même. Renvoie la fonction qui l'arrête.
 */
export function settleSnap(win: Window, snap: LangSnap, duration = 2500): () => void {
  const doc = win.document;
  let stopped = false;
  const apply = () => {
    if (stopped) return;
    const t = targetY(win, snap);
    if (Math.abs(t - win.scrollY) >= 1) jump(win, t);
  };
  apply();
  if (snap.kind === "top") return () => undefined;
  const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const ro = RO ? new RO(apply) : null;
  ro?.observe(doc.documentElement);
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    ro?.disconnect();
    clearTimeout(timer);
    doc.removeEventListener("load", apply, true);
    for (const e of events) win.removeEventListener(e, stop);
  };
  const timer = setTimeout(stop, duration);
  doc.addEventListener("load", apply, true);
  for (const e of events) win.addEventListener(e, stop, { passive: true });
  void doc.fonts?.ready.then(apply, () => undefined);
  return stop;
}

/** Chemin comparable : sans barre finale, décodé. */
export function normalizePath(p: string): string {
  let s = p;
  try {
    s = decodeURI(p);
  } catch {}
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

export function saveRecord(snap: LangSnap, to: string) {
  try {
    const rec: LangRecord = { snap, to, t: Date.now() };
    sessionStorage.setItem(LANG_SCROLL_KEY, JSON.stringify(rec));
  } catch {}
}

/** Lit puis efface le passage en cours (une seule arrivée l'utilise). */
export function takeRecord(): LangRecord | null {
  try {
    const raw = sessionStorage.getItem(LANG_SCROLL_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(LANG_SCROLL_KEY);
    const rec = JSON.parse(raw) as LangRecord;
    if (!rec || typeof rec.to !== "string" || typeof rec.t !== "number" || !rec.snap) return null;
    return Date.now() - rec.t <= LANG_SCROLL_TTL_MS ? rec : null;
  } catch {
    return null;
  }
}
