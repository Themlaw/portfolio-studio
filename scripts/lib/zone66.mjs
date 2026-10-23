/**
 * Aide e2e (lot 66) : le menu « Fond » garde ses réglages fins (coins, marge, bordure, papier du site) dans une section repliée
 * (`details.fond-fine`). Les suites plus anciennes pilotent ces boutons : elles les veulent visibles, on ouvre la section dès qu'elle apparaît.
 * La suite du lot (surface66) vérifie, elle, qu'elle est bien repliée par défaut : elle n'appelle pas cette aide.
 */
export async function autoOpenFine(ctx) {
  await ctx.addInitScript(() => {
    const open = () => document.querySelectorAll("details.fond-fine:not([open])").forEach((d) => (d.open = true));
    const start = () => new MutationObserver(open).observe(document.documentElement, { childList: true, subtree: true });
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start);
  });
}
