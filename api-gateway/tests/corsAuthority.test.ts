// Auditoría general — el gateway es la única autoridad CORS.
//
// Los microservicios internos responden con `Access-Control-Allow-Origin: *`
// (cors() por defecto). Antes, el proxy copiaba esas cabeceras encima de las del
// gateway: el navegador recibía "*" junto a "Allow-Credentials: true" y la lista
// de orígenes permitidos no se aplicaba a las respuestas sin preflight.
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Express } from "express";

let upstream: http.Server;
let app: Express;
const ORIGINAL_ENV = { ...process.env };

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Expose-Headers", "X-Interno");
    res.setHeader("X-Servicio", "auth");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as AddressInfo).port;
  process.env = { ...ORIGINAL_ENV, AUTH_SERVICE_URL: `http://127.0.0.1:${port}` };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("../src/app").createApp();
  });
});

afterAll(async () => {
  process.env = ORIGINAL_ENV;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe("cabeceras CORS del servicio interno", () => {
  it("no sobrescriben la decisión del gateway para un origen permitido", async () => {
    const res = await request(app).get("/api/auth/config").set("Origin", "https://localhost");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://localhost");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-expose-headers"]).toBeUndefined();
    // El resto de cabeceras del servicio sí llegan.
    expect(res.headers["x-servicio"]).toBe("auth");
    expect(res.body).toEqual({ path: "/auth/config" });
  });

  it("una petición sin Origin no recibe la '*' del servicio como origen permitido", async () => {
    const res = await request(app).get("/api/auth/config");
    expect(res.status).toBe(200);
    // Sin Origin el gateway no concede ningún origen (la cabecera
    // Allow-Credentials que añade cors() por sí sola no autoriza nada).
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
