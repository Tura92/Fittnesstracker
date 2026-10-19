/**
 * Einfacher Passwortschutz für eine Ein-Personen-App: Ist APP_PASSWORD gesetzt,
 * braucht jede Anfrage ein Cookie mit einem daraus abgeleiteten Token.
 * Ohne APP_PASSWORD (lokale Entwicklung) ist die App offen.
 */
export const AUTH_COOKIE = "ft_session";

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

export async function sessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("fittnesstracker-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await sessionToken());
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
