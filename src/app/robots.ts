import type { MetadataRoute } from "next";

import { publicBase } from "@/lib/seo";

/** Lu à chaque demande : PUBLIC_BASE_URL est une variable du conteneur, absente au build (sinon l'adresse par défaut serait figée dans le fichier). */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = publicBase();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
