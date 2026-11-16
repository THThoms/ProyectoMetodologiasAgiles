// Destinos de las notificaciones push: solo rutas internas de la SPA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deepLinkFor, safeInternalPath } from "../src/lib/deepLink.ts";

const TICKET = "55555555-5555-4555-8555-555555555555";

test("acepta rutas internas de la aplicación", () => {
  assert.equal(safeInternalPath(`/tickets/${TICKET}`), `/tickets/${TICKET}`);
  assert.equal(safeInternalPath("/mis-tickets?openTicket=1"), "/mis-tickets?openTicket=1");
});

test("rechaza otros orígenes, esquemas y variantes con barras o espacios", () => {
  const bad: unknown[] = [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "tickets/abc",
    "/ruta con espacios",
    "",
    42,
    null,
    undefined,
    "/" + "a".repeat(3000),
  ];
  for (const b of bad) assert.equal(safeInternalPath(b), null, String(b));
});

test("deepLinkFor prefiere el deepLink interno y, si no, el ticket por UUID", () => {
  assert.equal(deepLinkFor({ deepLink: `/tickets/${TICKET}` }), `/tickets/${TICKET}`);
  assert.equal(deepLinkFor({ deepLink: "https://evil.example", ticketId: TICKET }), `/tickets/${TICKET}`);
  assert.equal(deepLinkFor({ ticketId: "../admin" }), null);
  assert.equal(deepLinkFor(undefined), null);
});
