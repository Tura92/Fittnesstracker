import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { RestTimerProvider } from "@/components/rest-timer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fittnesstracker",
  description: "Training eintragen, Plan ansehen, Fortschritt auswerten",
  appleWebApp: { capable: true, title: "Training", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <RestTimerProvider>
          <main className="mx-auto w-full max-w-md px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-48">
            {children}
          </main>
          <Suspense>
            <BottomNav />
          </Suspense>
        </RestTimerProvider>
      </body>
    </html>
  );
}
