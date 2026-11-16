// Verificador del inicio de sesión Microsoft en la app Android (principio de
// PKCE, RFC 7636).
//
// El login vuelve a la app por un enlace con esquema propio
// (ec.uta.servicedesk://auth/success?code=…) y Android no garantiza qué
// aplicación lo recibe. Para que el código de un solo uso solo le sirva a esta
// app: antes de abrir el navegador se genera un verificador aleatorio, se envía
// al backend su SHA-256 (`cc`) y, al canjear el código, se presenta el
// verificador original. Otra app que capture el enlace no lo conoce.
//
// Módulo sin dependencias de Capacitor para poder probarlo con `node --test`.

export const SSO_VERIFIER_KEY = "sd_sso_verifier";

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  subtle: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Verificador aleatorio de 256 bits (43 caracteres base64url). */
export function generateVerifier(cryptoImpl: CryptoLike = globalThis.crypto as unknown as CryptoLike): string {
  return base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
}

/** Reto que se envía al backend: SHA-256 del verificador, en base64url. */
export async function challengeFor(
  verifier: string,
  cryptoImpl: CryptoLike = globalThis.crypto as unknown as CryptoLike
): Promise<string> {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Prepara un login: guarda el verificador y devuelve el reto. Devuelve null si
 * el entorno no ofrece criptografía (el login sigue, sin esta protección).
 */
export async function beginSsoChallenge(
  storage: StorageLike,
  // null = entorno sin criptografía (un undefined explícito tomaría el valor por defecto).
  cryptoImpl: CryptoLike | null = (globalThis.crypto as unknown as CryptoLike | undefined) ?? null
): Promise<string | null> {
  try {
    if (!cryptoImpl?.subtle) {
      storage.removeItem(SSO_VERIFIER_KEY);
      return null;
    }
    const verifier = generateVerifier(cryptoImpl);
    const challenge = await challengeFor(verifier, cryptoImpl);
    storage.setItem(SSO_VERIFIER_KEY, verifier);
    return challenge;
  } catch {
    storage.removeItem(SSO_VERIFIER_KEY);
    return null;
  }
}

/** Devuelve el verificador guardado y lo borra (un solo uso). */
export function takeSsoVerifier(storage: StorageLike): string | undefined {
  try {
    const verifier = storage.getItem(SSO_VERIFIER_KEY) ?? undefined;
    storage.removeItem(SSO_VERIFIER_KEY);
    return verifier;
  } catch {
    return undefined;
  }
}
