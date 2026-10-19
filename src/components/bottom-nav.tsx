"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Training", match: (p: string) => p === "/" || p.startsWith("/einheit") },
  { href: "/logbuch", label: "Logbuch", match: (p: string) => p.startsWith("/logbuch") },
  { href: "/auswertung", label: "Auswertung", match: (p: string) => p.startsWith("/auswertung") },
  { href: "/plan", label: "Plan", match: (p: string) => p.startsWith("/plan") || p.startsWith("/uebungen") },
];

export function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-md">
        {tabs.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex h-14 items-center justify-center text-sm font-medium ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
