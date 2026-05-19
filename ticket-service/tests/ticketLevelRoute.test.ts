// HU-07 - Tests de integración para GET /tickets/level.
// Mockeamos prisma (sin BD real). JWT real firmado con el secreto del entorno
// configurado en tests/setup-env.ts.

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// HU-07 enriquecimiento: el endpoint hace lookup a auth + catalog para
// resolver userName/serviceName. En los tests devolvemos listas vacías por
// defecto (los casos que validan enrichment usan mockResolvedValueOnce).
jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return {
    ...actual,
    fetchAllServices: jest.fn().mockResolvedValue([]),
    fetchService: jest.fn(),
  };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchUsersByIds } from "../src/services/authClient";
import { fetchAllServices } from "../src/services/catalogClient";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000001") {
  return jwt.sign(
    { userId, email: "u@uta.edu.ec", name: "Test", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

function mockEmpty() {
  (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /tickets/level - HU-07", () => {
  // -------------------------------------------------------------------------
  // ACs 1-4: cada técnico recibe sólo tickets de su nivel
  // -------------------------------------------------------------------------
  it.each([
    ["tech_n1", "N1"],
    ["tech_n2", "N2"],
    ["tech_n3", "N3"],
    ["tech_n4", "N4"],
  ])("AC: técnico %s recibe únicamente tickets %s", async (role, expectedLevel) => {
    mockEmpty();
    const token = makeToken(role);
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.level).toBe(expectedLevel);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ levelAssigned: expectedLevel }),
      })
    );
  });

  // -------------------------------------------------------------------------
  // AC: el técnico no puede traer otro nivel inyectando ?level
  // -------------------------------------------------------------------------
  it("técnico no puede ver tickets de otro nivel aunque pase ?level=N3", async () => {
    mockEmpty();
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level?level=N3")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.level).toBe("N1"); // sigue siendo N1
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ levelAssigned: "N1" }) })
    );
  });

  // -------------------------------------------------------------------------
  // AC 5: filtro status=Pendiente devuelve solo tickets pendientes
  // -------------------------------------------------------------------------
  it("AC5: status=pendiente se traduce a abierto en BD", async () => {
    mockEmpty();
    const token = makeToken("tech_n2");
    const res = await request(app)
      .get("/tickets/level?status=pendiente")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.status).toBe("pendiente");
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "abierto" }),
      })
    );
  });

  it("AC5b: status=abierto se acepta directamente", async () => {
    mockEmpty();
    const token = makeToken("tech_n2");
    const res = await request(app)
      .get("/tickets/level?status=abierto")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "abierto" }),
      })
    );
  });

  it("AC5c: status=escalado es un filtro válido", async () => {
    mockEmpty();
    const token = makeToken("tech_n3");
    const res = await request(app)
      .get("/tickets/level?status=escalado")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "escalado" }),
      })
    );
  });

  // -------------------------------------------------------------------------
  // AC 6: filtro priority=Alta devuelve solo tickets con prioridad alta
  // -------------------------------------------------------------------------
  it("AC6: priority=alta filtra por prioridad", async () => {
    mockEmpty();
    const token = makeToken("tech_n2");
    const res = await request(app)
      .get("/tickets/level?priority=alta")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.priority).toBe("alta");
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ priority: "alta" }),
      })
    );
  });

  // -------------------------------------------------------------------------
  // AC: search por número/detalle
  // -------------------------------------------------------------------------
  it("filtro search aplica OR contains sobre number y detail", async () => {
    mockEmpty();
    const token = makeToken("tech_n2");
    const res = await request(app)
      .get("/tickets/level?search=wifi")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const call = (prisma.ticket.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { number: { contains: "wifi", mode: "insensitive" } },
      { detail: { contains: "wifi", mode: "insensitive" } },
    ]);
  });

  // -------------------------------------------------------------------------
  // Paginación
  // -------------------------------------------------------------------------
  it("paginación: page=2 limit=10 calcula skip=10 take=10", async () => {
    mockEmpty();
    const token = makeToken("tech_n1");
    await request(app)
      .get("/tickets/level?page=2&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it("respuesta incluye total y filters", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
      { id: "t1", number: "TK-1", levelAssigned: "N1", status: "abierto", priority: "media" },
    ]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(42);

    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tickets: expect.any(Array),
      total: 42,
      filters: {
        level: "N1",
        status: null,
        priority: null,
        search: null,
        page: 1,
        limit: 20,
      },
    });
  });

  // -------------------------------------------------------------------------
  // AC 9: admin puede acceder y ver todos los niveles
  // -------------------------------------------------------------------------
  it("AC9: admin sin filtro level devuelve todos los niveles", async () => {
    mockEmpty();
    const token = makeToken("admin");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.level).toBe("todos");
    // El where NO debe tener levelAssigned cuando admin no filtra
    const call = (prisma.ticket.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.levelAssigned).toBeUndefined();
  });

  it("AC9b: admin puede filtrar por level=N4 explícito", async () => {
    mockEmpty();
    const token = makeToken("admin");
    const res = await request(app)
      .get("/tickets/level?level=N4")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.filters.level).toBe("N4");
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ levelAssigned: "N4" }),
      })
    );
  });

  // -------------------------------------------------------------------------
  // AC 7: 401 sin JWT
  // -------------------------------------------------------------------------
  it("AC7: 401 sin Authorization header", async () => {
    const res = await request(app).get("/tickets/level");
    expect(res.status).toBe(401);
  });

  it("AC7b: 401 con token mal firmado", async () => {
    const bad = jwt.sign({ userId: "x", role: "admin" }, "OTHER_SECRET");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC 8: 403 para usuario sin rol técnico ni admin
  // -------------------------------------------------------------------------
  it("AC8: 403 cuando el rol es 'user'", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Validación de query params
  // -------------------------------------------------------------------------
  it("status inválido devuelve 400", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level?status=zzz")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("priority inválido devuelve 400", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level?priority=urgent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("level inválido devuelve 400 (admin)", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/tickets/level?level=N9")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("limit > 100 devuelve 400", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level?limit=500")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // HU-07 enriquecimiento: el ticket incluye userName, userEmail, serviceName
  // -------------------------------------------------------------------------
  it("incluye userName, userEmail y serviceName resueltos por lookup", async () => {
    const USER_ID = "11111111-1111-4111-8111-111111111111";
    const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
      {
        id: "t1",
        number: "TK-1",
        userId: USER_ID,
        serviceId: SERVICE_ID,
        levelAssigned: "N1",
        status: "abierto",
        priority: "media",
        detail: "x",
        attachments: [],
      },
    ]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(1);
    (fetchUsersByIds as jest.Mock).mockResolvedValueOnce([
      { id: USER_ID, name: "Juan Pérez", email: "juan@uta.edu.ec", role: "user" },
    ]);
    (fetchAllServices as jest.Mock).mockResolvedValueOnce([
      { id: SERVICE_ID, name: "Red e Internet", isActive: true, levelEntry: "N1", routingRule: null },
    ]);

    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tickets[0]).toMatchObject({
      userName: "Juan Pérez",
      userEmail: "juan@uta.edu.ec",
      serviceName: "Red e Internet",
    });
  });

  it("si el lookup de auth falla, igual responde 200 con userName=null", async () => {
    const USER_ID = "11111111-1111-4111-8111-111111111111";
    const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
      { id: "t1", number: "TK-1", userId: USER_ID, serviceId: SERVICE_ID,
        levelAssigned: "N1", status: "abierto", priority: "media", detail: "x", attachments: [] },
    ]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(1);
    (fetchUsersByIds as jest.Mock).mockRejectedValueOnce(new Error("auth-service caído"));
    (fetchAllServices as jest.Mock).mockResolvedValueOnce([
      { id: SERVICE_ID, name: "Red e Internet", isActive: true, levelEntry: "N1", routingRule: null },
    ]);

    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tickets[0]).toMatchObject({
      userName: null,
      userEmail: null,
      serviceName: "Red e Internet",
    });
  });

  // -------------------------------------------------------------------------
  // AC 10: no se rompe el endpoint anterior GET /tickets
  // -------------------------------------------------------------------------
  it("AC10: GET /tickets (HU-06) sigue respondiendo", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tickets");
  });
});
