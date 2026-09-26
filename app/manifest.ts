import type { MetadataRoute } from "next";

// Required for `output: export` — emit the manifest as a static file at build.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CalendarSync — יומן ותזכורות",
    short_name: "CalendarSync",
    description: "ריכוז יומנים ותיבות דואר, עם תזכורות ועדכונים ב-WhatsApp",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#2563EB",
    lang: "he",
    dir: "rtl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
