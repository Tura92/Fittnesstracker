import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite lädt WASM-Dateien zur Laufzeit und darf nicht gebündelt werden
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
