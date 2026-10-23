/**
 * Anmeldung mit Nutzerkonten: Im Cookie steht ein zufälliges Token, die Datenbank kennt
 * nur dessen Hash und das zugehörige Konto (siehe src/lib/session.ts). Der Proxy prüft
 * nur die Form des Cookies, damit Seiten ohne Anmeldung gar nicht erst laden; ob die
 * Sitzung gültig ist, entscheidet jeder Datenzugriff selbst.
 */
export const AUTH_COOKIE = "ft_session";

/** 32 Zufallsbytes, base64url. Alte Cookies aus der Zeit des gemeinsamen Passworts passen nicht. */
export function looksLikeSessionToken(value: string | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
