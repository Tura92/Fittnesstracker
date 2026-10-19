import type { MetadataRoute } from "next";

/** Private App: Suchmaschinen sollen nichts davon erfassen */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
