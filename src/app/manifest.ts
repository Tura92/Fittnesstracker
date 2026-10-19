import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fittnesstracker",
    short_name: "Training",
    description: "Training eintragen, Plan ansehen, Fortschritt auswerten",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f5",
    theme_color: "#059669",
    lang: "de",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
