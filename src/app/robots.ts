import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.PUBLIC_BASE_URL || "https://portfolio.example.org").replace(/\/+$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    host: base,
  };
}
