// HU-10 - Tests de integración para GET /knowledge/search.
// Prisma mockeado; JWT real firmado con el secreto de tests/setup-env.ts.

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    knowledgeArticle: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    service: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000001") {
  return jwt.sign(
    { userId, email: "u@uta.edu.ec", name: "Test", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

function mockResults(results: unknown[], total = results.length) {
  (prisma.knowledgeArticle.findMany as jest.Mock).mockResolvedValue(results);
  (prisma.knowledgeArticle.count as jest.Mock).mockResolvedValue(total);
}

beforeEach(() => {
  jest.clearAllMocks();
});

const SAMPLE_VPN = {
  id: "kb1",
  title: "Error de conexión VPN institucional",
  problemDescription: "El usuario no puede conectarse a la VPN.",
  solution: "Verificar credenciales, conexión y configuración VPN.",
  keywords: ["vpn", "red", "conexion"],
  service: { id: "svc1", name: "Red e Internet" },
  updatedAt: new Date("2026-05-18T10:00:00Z"),
  createdAt: new Date("2026-05-18T10:00:00Z"),
};

describe("GET /knowledge/search - HU-10", () => {
  // -------------------------------------------------------------------------
  // ACs principales
  // -------------------------------------------------------------------------
  it("AC1: q=VPN devuelve soluciones relacionadas", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=VPN")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.query).toBe("VPN");
    expect(res.body.total).toBe(1);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      title: expect.stringContaining("VPN"),
      service: { name: "Red e Internet" },
      keywords: expect.arrayContaining(["vpn"]),
    });
  });

  it("búsqueda construye OR sobre title/description/solution/keywords/service.name", async () => {
    mockResults([]);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=wifi")
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
    const or = call.where.AND[0].OR;
    expect(or).toEqual(
      expect.arrayContaining([
        { title:              { contains: "wifi", mode: "insensitive" } },
        { problemDescription: { contains: "wifi", mode: "insensitive" } },
        { solution:           { contains: "wifi", mode: "insensitive" } },
        { keywords:           { hasSome: ["wifi"] } },
        { service: { name: { contains: "wifi", mode: "insensitive" } } },
      ])
    );
  });

  it("la query a keywords usa lowercase para case-insensitive", async () => {
    mockResults([]);
    const token = makeToken("tech_n2");
    await request(app)
      .get("/knowledge/search?q=VPN")
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    const or = call.where.AND[0].OR;
    expect(or).toEqual(expect.arrayContaining([{ keywords: { hasSome: ["vpn"] } }]));
  });

  // -------------------------------------------------------------------------
  // Filtro por serviceId
  // -------------------------------------------------------------------------
  it("filtra por serviceId cuando se proporciona", async () => {
    mockResults([]);
    const token = makeToken("tech_n1");
    const svcId = "11111111-1111-4111-8111-111111111111";
    await request(app)
      .get(`/knowledge/search?q=red&serviceId=${svcId}`)
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([{ serviceId: svcId }])
    );
  });

  // -------------------------------------------------------------------------
  // Validaciones de q
  // -------------------------------------------------------------------------
  it("400 sin q", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con q vacío o solo espacios", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=%20%20%20")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con q de 1 caracter (mínimo 2)", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=a")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con serviceId que no es UUID", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=red&serviceId=abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con limit > 50", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=red&limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Permisos
  // -------------------------------------------------------------------------
  it("401 sin JWT", async () => {
    const res = await request(app).get("/knowledge/search?q=red");
    expect(res.status).toBe(401);
  });

  it("403 cuando el role es 'user' (no técnico ni admin)", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get("/knowledge/search?q=red")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(prisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
  });

  it("técnico autenticado puede buscar (AC10)", async () => {
    mockResults([]);
    const token = makeToken("tech_n3");
    const res = await request(app)
      .get("/knowledge/search?q=seguridad")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("admin autenticado puede buscar (AC11)", async () => {
    mockResults([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/knowledge/search?q=correo")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Resultados vacíos / paginación / orden
  // -------------------------------------------------------------------------
  it("AC12: búsqueda sin resultados devuelve total=0 y results=[]", async () => {
    mockResults([], 0);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=palabra-imposible-xyz")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });

  it("orden por updatedAt desc", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=vpn")
      .set("Authorization", `Bearer ${token}`);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("paginación page=2 limit=5 -> skip=5 take=5", async () => {
    mockResults([], 0);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=red&page=2&limit=5")
      .set("Authorization", `Bearer ${token}`);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.skip).toBe(5);
    expect(call.take).toBe(5);
  });
});
