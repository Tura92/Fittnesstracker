import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, looksLikeSessionToken } from "@/lib/auth";

/** Ohne Anmeldung erreichbar: Anmeldung samt Ersteinrichtung und Einladungslinks */
const PUBLIC_PAGES = ["/login", "/einladung"];

export async function proxy(request: NextRequest) {
  if (PUBLIC_PAGES.includes(request.nextUrl.pathname)) return NextResponse.next();
  // Nur eine Vorprüfung: Ob die Sitzung gilt und wem sie gehört, prüft jeder Datenzugriff (src/lib/session.ts)
  if (looksLikeSessionToken(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  // Die App fragt Daten im Hintergrund ab und braucht dann einen klaren Fehler statt der Login-Seite
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Manifest und Icons müssen ohne Login erreichbar sein, sonst klappt "Zum Home-Bildschirm"
  // Der QStash-Rückruf prüft stattdessen die Signatur, der Service Worker muss ohne Login laden
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sw.js|api/rest-timer).*)"],
};
