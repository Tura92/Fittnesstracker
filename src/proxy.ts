import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, isValidSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Online nie ohne Passwort: lieber gar nichts zeigen als die Daten offen
  if (process.env.VERCEL && !authEnabled()) {
    return new NextResponse("APP_PASSWORD fehlt. Bitte in Vercel unter Settings → Environment Variables setzen und neu deployen.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (request.nextUrl.pathname === "/login") return NextResponse.next();
  if (await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
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
