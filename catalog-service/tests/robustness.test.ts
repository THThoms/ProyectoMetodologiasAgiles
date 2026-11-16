// Auditoría general — robustez de catalog-service.
//
// GET /services/:id es público (lo usa el formulario de tickets) y consultaba la
// base con el id tal cual. Con un id que no es un GUID, SQL Server rechaza la
// consulta; al ser un handler `async` sin try/catch, Express 4 no capturaba el
// rechazo y Node terminaba el proceso: una petición SIN autenticar tumbaba el
// catálogo. Ahora el id se valida antes y cualquier error asíncrono responde 500.
import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    service: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    location: { findMany: jest.fn() },
    knowledgeArticle: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const token = (payload: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
  jwt.sign(payload, SECRET, { expiresIn: "1h", ...opts });
const admin = () => token({ userId: "00000000-0000-4000-8000-000000000001", email: "a@uta.edu.ec", name: "Admin", role: "admin" });

let errorLog: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe("identificadores que no son UUID", () => {
  it.each(["abc", "1", "33333333-3333-4333-8333-33333333333", "' OR 1=1 --", "33333333-3333-4333-8333-333333333333x"])(
    "GET /services/%s (sin autenticar) → 400 sin consultar la base",
    async (id) => {
      const res = await request(app).get(`/services/${encodeURIComponent(id)}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Identificador inválido" });
      expect(prisma.service.findUnique).not.toHaveBeenCalled();
    }
  );

  it("PATCH y DELETE /services/:id con id inválido → 400", async () => {
    const auth = `Bearer ${admin()}`;
    expect((await request(app).patch("/services/no-uuid").set("Authorization", auth).send({ name: "x" })).status).toBe(400);
    expect((await request(app).delete("/services/no-uuid").set("Authorization", auth)).status).toBe(400);
    expect(prisma.service.update).not.toHaveBeenCalled();
  });

  it("un UUID válido (en mayúsculas o minúsculas) sí se consulta", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue({ id: SERVICE_ID, name: "Red", isActive: true, routingRule: null });
    expect((await request(app).get(`/services/${SERVICE_ID}`)).status).toBe(200);
    expect((await request(app).get(`/services/${SERVICE_ID.toUpperCase()}`)).status).toBe(200);
  });
});

describe("errores asíncronos", () => {
  it("si la base falla en una ruta pública, responde 500 JSON (no deja la petición colgada)", async () => {
    (prisma.service.findUnique as jest.Mock).mockRejectedValue(new Error("Conversion failed / conexión perdida"));
    const res = await request(app).get(`/services/${SERVICE_ID}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Error interno del servidor" });
  });

  it("lo mismo en un listado y en una creación (errores relanzados con throw)", async () => {
    (prisma.service.findMany as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await request(app).get("/services")).status).toBe(500);
    (prisma.service.create as jest.Mock).mockRejectedValue(new Error("db"));
    const res = await request(app).post("/services").set("Authorization", `Bearer ${admin()}`).send({ name: "Nuevo" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/db|stack|prisma/i);
  });

  it("un JSON mal formado es un error del cliente (400), no un 500", async () => {
    const res = await request(app)
      .post("/services")
      .set("Authorization", `Bearer ${admin()}`)
      .set("Content-Type", "application/json")
      .send('{"name": ');
    expect(res.status).toBe(400);
  });
});

describe("JWT", () => {
  const call = (t: string) => request(app).post("/locations").set("Authorization", `Bearer ${t}`).send({ name: "Aula 1" });

  it("un token interno de servicio (con audiencia, sin userId) no vale como usuario", async () => {
    const service = token({ typ: "service", svc: "ticket-service", role: "admin" }, { audience: "servicedesk-internal" });
    expect((await call(service)).status).toBe(401);
    expect((await call(token({ role: "admin" }))).status).toBe(401);
  });

  it("solo se acepta HS256", async () => {
    const hs512 = token({ userId: "00000000-0000-4000-8000-000000000001", role: "admin" }, { algorithm: "HS512" });
    expect((await call(hs512)).status).toBe(401);
  });
});

describe("base de conocimiento: tamaño de los textos", () => {
  it("un artículo con un texto desproporcionado se rechaza", async () => {
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${admin()}`)
      .send({ title: "Título", problemDescription: "p".repeat(20_001), solution: "solución válida", keywords: ["red"] });
    expect(res.status).toBe(400);
    expect(prisma.knowledgeArticle.create).not.toHaveBeenCalled();
  });
});
