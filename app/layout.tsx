import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import PwaBoot from "@/components/pwa/PwaBoot";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CalendarSync — יומן ותיבת דואר מרוכזים",
  description: "ריכוז יומנים ותיבות דואר מכמה חשבונות, עם תזכורות ועדכונים ב-WhatsApp",
  applicationName: "CalendarSync",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CalendarSync" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563EB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="color-scheme" content="light" />
      </head>
      <body className="min-h-full font-heebo antialiased overflow-x-hidden" style={{ background: "#F8FAFC", color: "#0D1321" }}>
        <AuthProvider>{children}</AuthProvider>
        <PwaBoot accent="#2563EB" appName="CalendarSync" />
      </body>
    </html>
  );
}
