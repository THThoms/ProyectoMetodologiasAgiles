// Fase R — ticket-service valida la SESIÓN (no solo la firma) contra
// auth-service cuando AUTH_INTROSPECTION=true: logout/revocación efectivos.
import jwt from "jsonwebtoken";
import axios from "axios";

process.env.AUTH_INTROSPECTION = "true";
jest.mock("axios");
jest.mock("../src/db/client", () => ({
  prisma: { ticket: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } },
}));
jest.mock("../src/services/authClient", () => ({ fetchUsersByIds: jest.fn().mockResolvedValue([]), fetchTechnicians: jest.fn().mockResolvedValue([]) }));

import request from "supertest";
import { createApp } from "../src/app";
import { __clearSessionCache } from "../src/middleware/verifyJwt";

const app = createApp();
const post = axios.post as jest.Mock;
const tok = (n: number) =>
  jwt.sign({ userId: "99999999-9999-4999-8999-99999999999" + n, email: "u@uta.edu.ec", name: "U", role: "user", n }, process.env.JWT_SECRET!, { expiresIn: "1h" });

afterAll(() => { delete process.env.AUTH_INTROSPECTION; });
beforeEach(() => { post.mockReset(); __clearSessionCache(); });

it("sesión activa en auth-service → 200 (y se cachea: una sola llamada)", async () => {
  post.mockResolvedValue({ status: 200 });
  const t = tok(1);
  expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`)).status).toBe(200);
  expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`)).status).toBe(200);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toMatch(/\/auth\/verify$/);
});

it("sesión revocada (logout) → 401 aunque la firma sea válida", async () => {
  post.mockResolvedValue({ status: 401 });
  expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${tok(2)}`)).status).toBe(401);
});

it("auth-service caído → 503 (falla cerrado, no deja pasar)", async () => {
  post.mockRejectedValue(new Error("ECONNREFUSED"));
  expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${tok(3)}`)).status).toBe(503);
});

// Auditoría final — ventana de revocación acotada: una sesión válida se recuerda
// solo SESSION_CACHE_TTL_MS (5 s por defecto); pasado ese tiempo se vuelve a
// consultar auth-service y un logout se hace efectivo.
it("tras expirar la caché positiva, la revocación se aplica (ventana ≤ TTL)", async () => {
  process.env.SESSION_CACHE_TTL_MS = "40";
  try {
    post.mockResolvedValueOnce({ status: 200 });
    const t = tok(4);
    expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));
    post.mockResolvedValueOnce({ status: 401 }); // logout entre medias
    expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`)).status).toBe(401);
    // Un rechazo se recuerda (caché negativa): no se vuelve a consultar en seguida.
    expect((await request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`)).status).toBe(401);
    expect(post).toHaveBeenCalledTimes(2);
  } finally {
    delete process.env.SESSION_CACHE_TTL_MS;
  }
});

it("la caché positiva por defecto es de 5 s, no de 30 s", () => {
  delete process.env.SESSION_CACHE_TTL_MS;
  const src = require("node:fs").readFileSync(require.resolve("../src/middleware/verifyJwt"), "utf8");
  expect(src).toMatch(/SESSION_CACHE_TTL_MS \?\? 5_000/);
});
