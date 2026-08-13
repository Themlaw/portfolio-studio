import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Toutes les routes sauf l'API, les fichiers statiques Next et les assets.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
