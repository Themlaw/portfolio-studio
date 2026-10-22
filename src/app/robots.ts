import type { MetadataRoute } from "next";

import { publicBase } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const base = publicBase();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
