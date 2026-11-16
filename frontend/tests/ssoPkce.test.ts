// Verificador del login Microsoft en Android (tipo PKCE).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SSO_VERIFIER_KEY,
  beginSsoChallenge,
  challengeFor,
  generateVerifier,
  takeSsoVerifier,
} from "../src/lib/ssoPkce.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test("el verificador es aleatorio, de 43 caracteres base64url", () => {
  const a = generateVerifier();
  const b = generateVerifier();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test("el reto es el SHA-256 base64url del verificador (el mismo cálculo que hace el backend)", async () => {
  const verifier = generateVerifier();
  const expected = createHash("sha256").update(verifier, "utf8").digest("base64url");
  assert.equal(await challengeFor(verifier), expected);
  assert.match(expected, /^[A-Za-z0-9_-]{43}$/);
});

test("beginSsoChallenge guarda el verificador y takeSsoVerifier lo entrega una sola vez", async () => {
  const storage = memoryStorage();
  const challenge = await beginSsoChallenge(storage);
  const stored = storage.data.get(SSO_VERIFIER_KEY)!;
  assert.equal(challenge, createHash("sha256").update(stored, "utf8").digest("base64url"));
  assert.equal(takeSsoVerifier(storage), stored);
  assert.equal(takeSsoVerifier(storage), undefined);
  assert.equal(storage.data.size, 0);
});

test("sin criptografía disponible no hay reto y no queda un verificador antiguo", async () => {
  const storage = memoryStorage();
  storage.setItem(SSO_VERIFIER_KEY, "verificador-de-un-intento-anterior");
  assert.equal(await beginSsoChallenge(storage, null), null);
  assert.equal(takeSsoVerifier(storage), undefined);
});
