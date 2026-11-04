/**
 * Barre « Aa » et ses fenêtres (hotfix v0.33.4) : UN seul mécanisme pour que ni la barre ni ses portails (liste de polices, de graisses, de tailles,
 * roue des couleurs, surlignage…) ne fassent finir la saisie du texte.
 *
 *  - un geste sur un élément de la barre ou d'une de ses fenêtres (`.pe-pop`, bouton « Aa ») ne prend pas le focus au texte (LookLayer annule le
 *    `mousedown` / `pointerdown` par defaut, souris comme tactile) ;
 *  - les champs qui ONT besoin du focus (`<select>` natif, champ de recherche, taille numérique) le prennent : la saisie n'est alors pas finie, elle
 *    est « tenue » (`holdForAa`) ; la valeur choisie rend le focus au texte, à sa sélection d'avant ; un geste ailleurs la finit comme avant.
 */

/** Vrai pour un élément de la barre « Aa », d'une de ses fenêtres ou du bouton « Aa ». */
export function inAaUi(n: unknown): boolean {
  return n instanceof Element && Boolean(n.closest(".pe-pop, .lk-aa"));
}

/** Sélection du champ à l'instant du `blur` (elle passe au champ de la barre juste après). */
export function savedRange(field: HTMLElement): Range | null {
  const sel = field.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return field.contains(r.startContainer) && field.contains(r.endContainer) ? r.cloneRange() : null;
}

/**
 * La saisie de `field` est tenue pendant que le focus est dans la barre : `done(true)` la finit quand le focus ou un geste va ailleurs, `rearm` la
 * rend à son `blur` habituel quand le texte reprend le focus. Rend le contrôleur (à interrompre si la saisie finit autrement).
 */
export function holdForAa(field: HTMLElement, range: Range | null, done: (commit: boolean) => void, rearm: () => void): AbortController {
  const doc = field.ownerDocument;
  const ac = new AbortController();
  const { signal } = ac;
  const inField = (t: EventTarget | null) => t instanceof Node && field.contains(t);
  doc.addEventListener(
    "focusin",
    (e) => {
      if (inAaUi(e.target)) return;
      ac.abort();
      if (inField(e.target)) rearm();
      else done(true);
    },
    { capture: true, signal },
  );
  doc.addEventListener(
    "pointerdown",
    (e) => {
      if (inAaUi(e.target) || inField(e.target)) return;
      ac.abort();
      done(true);
    },
    { capture: true, signal },
  );
  // Valeur choisie dans la barre (liste native, champ validé par Entrée) : le texte reprend le focus et sa sélection.
  const back = () =>
    queueMicrotask(() => {
      if (signal.aborted || !field.isConnected) return;
      field.focus({ preventScroll: true });
      const sel = doc.getSelection();
      if (range && sel && field.contains(range.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  // Une liste de la barre se referme (le choix est fait) : le champ qui avait le focus disparaît, le texte le reprend.
  doc.addEventListener(
    "click",
    (e) => {
      if (!inAaUi(e.target)) return;
      setTimeout(() => {
        const a = doc.activeElement;
        // Un bouton qui garde le focus (liste refermée sur son bouton) le rend au texte ; un champ à saisir le garde.
        const typing = a instanceof HTMLElement && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
        if (!signal.aborted && !typing) back();
      }, 60);
    },
    { capture: true, signal },
  );
  doc.addEventListener("change", (e) => inAaUi(e.target) && back(), { capture: true, signal });
  doc.addEventListener("keydown", (e) => e.key === "Enter" && e.target instanceof HTMLInputElement && inAaUi(e.target) && back(), { capture: true, signal });
  return ac;
}
