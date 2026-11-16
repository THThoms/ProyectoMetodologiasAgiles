// Fase T — `state` OAuth ligado al navegador (protección CSRF del login SSO).
//
// Antes, `state` solo transportaba el tipo de cliente y nunca se comparaba con
// nada propio del navegador: un atacante podía hacer que la víctima completara
// el callback con un código del atacante (login CSRF). Ahora:
//   1. GET /auth/microsoft genera un nonce aleatorio (256 bits), lo envía a
//      Microsoft dentro de `state` = "<cliente>.<nonce>" y lo guarda en una
//      cookie HttpOnly, SameSite=Lax, Secure (si la app es https), 10 minutos.
//   2. El callback exige que el nonce de `state` coincida (tiempo constante) con
//      la cookie de ESE navegador; si no, rechaza sin canjear el código.
// La app Android abre el login en el navegador del sistema (Custom Tabs): el
// inicio y el callback ocurren en el mismo navegador, así que la cookie llega.
import crypto from "crypto";

export const OAUTH_STATE_COOKIE = "sd_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600;
export type OAuthClient = "web" | "android";

const STATE_RE = /^(web|android)\.([A-Za-z0-9_-]{43})$/;

function cookieAttrs(secure: boolean, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** Nuevo `state` y la cabecera Set-Cookie que lo liga a este navegador. */
export function issueOAuthState(client: OAuthClient, secure: boolean): { state: string; setCookie: string } {
  const nonce = crypto.randomBytes(32).toString("base64url"); // 43 caracteres
  return {
    state: `${client}.${nonce}`,
    setCookie: `${OAUTH_STATE_COOKIE}=${nonce}; ${cookieAttrs(secure, OAUTH_STATE_TTL_SECONDS)}`,
  };
}

/** Cabecera Set-Cookie que borra la cookie de estado (un solo uso). */
export function clearOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Verifica el `state` del callback contra la cookie del navegador.
 * Devuelve el tipo de cliente si es válido; null si falta, está mal formado o
 * no coincide.
 */
export function verifyOAuthState(state: unknown, cookieHeader: string | undefined): OAuthClient | null {
  if (typeof state !== "string") return null;
  const m = STATE_RE.exec(state);
  if (!m) return null;
  const cookie = readCookie(cookieHeader, OAUTH_STATE_COOKIE);
  if (!cookie) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return m[1] as OAuthClient;
}

/** Tipo de cliente declarado en `state` (solo para elegir el destino de un error). */
export function clientFromState(state: unknown): OAuthClient {
  return typeof state === "string" && state.startsWith("android.") ? "android" : "web";
}

// -----------------------------------------------------------------------------
// Reto del cliente Android (mismo principio que PKCE, RFC 7636).
//
// El inicio de sesión de la app termina en un enlace con esquema propio
// (ec.uta.servicedesk://auth/success?code=…). Android no garantiza qué
// aplicación recibe ese enlace: otra app instalada puede declarar el mismo
// esquema, capturar el código de un solo uso y canjearlo. Para que el código
// solo le sirva a quien inició el login:
//   1. La app genera un verificador aleatorio y envía su SHA-256 (`cc`).
//   2. El backend lo guarda en una cookie HttpOnly del navegador y, en el
//      callback, lo asocia al código de un solo uso.
//   3. El canje exige el verificador original; quien solo capturó el enlace no
//      lo tiene.
// Una app antigua que no envía `cc` sigue funcionando como antes.
// -----------------------------------------------------------------------------
export const OAUTH_CHALLENGE_COOKIE = "sd_oauth_cc";
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // SHA-256 en base64url

/** Reto válido o null (cualquier otro valor se ignora). */
export function parseChallenge(value: unknown): string | null {
  return typeof value === "string" && CHALLENGE_RE.test(value) ? value : null;
}

export function challengeCookie(challenge: string, secure: boolean): string {
  return `${OAUTH_CHALLENGE_COOKIE}=${challenge}; ${cookieAttrs(secure, OAUTH_STATE_TTL_SECONDS)}`;
}

export function clearChallengeCookie(secure: boolean): string {
  return `${OAUTH_CHALLENGE_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

export function readChallengeCookie(cookieHeader: string | undefined): string | null {
  return parseChallenge(readCookie(cookieHeader, OAUTH_CHALLENGE_COOKIE));
}

/** ¿El verificador presentado corresponde al reto guardado? (tiempo constante) */
export function verifierMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  const computed = Buffer.from(crypto.createHash("sha256").update(verifier, "utf8").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
