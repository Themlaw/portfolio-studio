/**
 * Mode développement EXPLICITE (docs/SECURITE.md §2.5).
 *
 * Les facilités du développement (secret de session de dev, aperçu de thème ouvert sans session, origines locales de
 * confiance, CSP de l'admin avec `unsafe-eval` et WebSocket) ne s'ouvrent plus sur un simple `NODE_ENV !== "production"` :
 * un `NODE_ENV` oublié ou écrasé (application lancée hors de l'image, `.env`…) les ouvrait toutes en même temps et sans
 * bruit. Il faut maintenant `PORTFOLIO_DEV=1` (posé par `npm run dev` et par `.github/scripts/e2e.sh`) ET un `NODE_ENV`
 * différent de `production` : en production, le drapeau seul ne suffit jamais.
 */
export function isDevMode(): boolean {
  return process.env.PORTFOLIO_DEV === "1" && process.env.NODE_ENV !== "production";
}
