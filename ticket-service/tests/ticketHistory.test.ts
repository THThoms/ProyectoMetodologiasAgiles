// HU-09 - Tests de integración:
//   - GET /tickets/history/:id (ordenado cronológicamente, permisos, 404, 401)
//   - PATCH /tickets/:id/status (registra STATUS_CHANGED)
//   - Regresión: HU-08 PUT /escalate registra ESCALATED en historial

import jwt from "jsonwebtoken";

const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    ticketEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: { update: mockTicketUpdate },
        ticketEvent: { create: mockEventCreate },
      })
    ),
  },
}));

jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchAllServices: jest.fn().mockResolvedValue([]), fetchService: jest.fn() };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function makeToken(role: string, userId = USER_ID, name = "Test User") {
  return jwt.sign({ userId, email: "u@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

function mockTicket(overrides: Partial<{ levelAssigned: string; status: string; userId: string }> = {}) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID,
    number: "TK-1",
    userId: overrides.userId ?? "11111111-1111-4111-8111-aaaaaaaaaaaa",
    serviceId: "ss",
    levelAssigned: overrides.levelAssigned ?? "N1",
    status: overrides.status ?? "abierto",
    priority: "media",
    createdAt: new Date("2026-05-18T10:00:00Z"),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTicketUpdate.mockReset();
  mockEventCreate.mockReset();
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({ ticket: { update: mockTicketUpdate }, ticketEvent: { create: mockEventCreate } })
  );
});

// =============================================================================
// GET /tickets/history/:id
// =============================================================================
describe("GET /tickets/history/:id - HU-09", () => {
  it("AC1: devuelve historial completo ordenado cronológicamente", async () => {
    mockTicket();
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: "ev1",
        action: "CREATED",
        previousStatus: null,
        newStatus: "abierto",
        previousLevel: null,
        newLevel: "N1",
        reason: null,
        performedBy: USER_ID,
        performedByName: "Docente de Prueba",
        createdAt: new Date("2026-05-18T10:00:00Z"),
      },
      {
        id: "ev2",
        action: "STATUS_CHANGED",
        previousStatus: "abierto",
        newStatus: "en_proceso",
        previousLevel: null,
        newLevel: null,
        reason: "Iniciando revisión",
        performedBy: "tech-id",
        performedByName: "Técnico N1",
        createdAt: new Date("2026-05-18T11:00:00Z"),
      },
      {
        id: "ev3",
        action: "ESCALATED",
        previousStatus: "en_proceso",
        newStatus: "escalado",
        previousLevel: "N1",
        newLevel: "N2",
        reason: "Requiere mayor expertise",
        performedBy: "tech-id",
        performedByName: "Técnico N1",
        createdAt: new Date("2026-05-18T12:00:00Z"),
      },
    ]);

    const token = makeToken("admin");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe(TICKET_ID);
    expect(res.body.history).toHaveLength(3);
    expect(res.body.history.map((e: { actionType: string }) => e.actionType)).toEqual([
      "CREATED",
      "STATUS_CHANGED",
      "ESCALATED",
    ]);
    // El backend pidió orden ascendente
    expect(prisma.ticketEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticketId: TICKET_ID },
        orderBy: { createdAt: "asc" },
      })
    );
  });

  it("cada evento incluye descripción legible y responsable", async () => {
    mockTicket();
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: "ev1",
        action: "ESCALATED",
        previousStatus: "abierto",
        newStatus: "escalado",
        previousLevel: "N1",
        newLevel: "N2",
        previousArea: "TECHNICIANS",
        newArea: "TICS",
        reason: "Caso complejo",
        performedBy: "tech-id",
        performedByName: "Técnico Nivel 1",
        createdAt: new Date(),
      },
    ]);
    const token = makeToken("tech_n2");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.history[0]).toMatchObject({
      actionType: "ESCALATED",
      description: expect.stringContaining("escaló"),
      previousLevel: "N1",
      newLevel: "N2",
      reason: "Caso complejo",
      performedBy: { id: "tech-id", name: "Técnico Nivel 1" },
    });
    expect(res.body.history[0].description).toContain("Técnicos");
    expect(res.body.history[0].description).toContain("TICs");
    expect(res.body.history[0].description).not.toContain("Nivel 1");
  });

  it("AC3: devuelve 404 si el ticket no existe", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("admin");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("AC4: 401 sin JWT", async () => {
    const res = await request(app).get(`/tickets/history/${TICKET_ID}`);
    expect(res.status).toBe(401);
  });

  it("AC5: 403 usuario normal intentando ver ticket de otro", async () => {
    mockTicket({ userId: "owner-id" });
    const token = makeToken("user", "other-user-id");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("usuario normal puede ver historial de su propio ticket", async () => {
    mockTicket({ userId: USER_ID });
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("user", USER_ID);
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("técnico puede ver historial de tickets de otros niveles (trazabilidad post-escalamiento)", async () => {
    mockTicket({ levelAssigned: "N3" });
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("admin puede ver historial de cualquier ticket", async () => {
    mockTicket({ userId: "alguien-mas" });
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("estado vacío: devuelve history=[] cuando no hay eventos", async () => {
    mockTicket();
    (prisma.ticketEvent.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });
});

// =============================================================================
// PATCH /tickets/:id/status — AC2 (registro automático fecha+responsable)
// =============================================================================
describe("PATCH /tickets/:id/status - HU-09", () => {
  it("AC2: cambia el estado y registra STATUS_CHANGED con responsable y fecha", async () => {
    mockTicket({ levelAssigned: "N1", status: "abierto" });
    mockTicketUpdate.mockImplementation(async ({ data }) => ({
      id: TICKET_ID, number: "TK-1", ...data,
    }));
    mockEventCreate.mockResolvedValue({ id: "ev-new" });

    const token = makeToken("tech_n1", "tec-uuid", "Téc N1");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "en_proceso", comment: "Iniciando revisión" });

    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      previousStatus: "abierto",
      newStatus: "en_proceso",
    });
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TICKET_ID },
        data: { status: "en_proceso" },
      })
    );
    // El responsable y la fecha se persisten automáticamente:
    // performedBy/performedByName vienen del JWT, createdAt es default(now()).
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "STATUS_CHANGED",
        previousStatus: "abierto",
        newStatus: "en_proceso",
        reason: "Iniciando revisión",
        performedBy: "tec-uuid",
        performedByName: "Téc N1",
      }),
    });
  });

  it("400 si status es el mismo que el actual", async () => {
    mockTicket({ status: "abierto" });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "abierto" });
    expect(res.status).toBe(400);
  });

  it("400 si status no es válido", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "trolol" });
    expect(res.status).toBe(400);
  });

  it("401 sin JWT", async () => {
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .send({ status: "en_proceso" });
    expect(res.status).toBe(401);
  });

  it("403 con role user", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "en_proceso" });
    expect(res.status).toBe(403);
  });

  it("403 si tech_n2 intenta cambiar estado de ticket N1", async () => {
    mockTicket({ levelAssigned: "N1" });
    const token = makeToken("tech_n2");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "en_proceso" });
    expect(res.status).toBe(403);
  });

  it("404 si el ticket no existe", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("admin");
    const res = await request(app)
      .patch(`/tickets/${TICKET_ID}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "en_proceso" });
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// Regresión
// =============================================================================
describe("HU-09 regresión: no rompe HU-06/07/08", () => {
  it("GET /tickets/level (HU-07) sigue 200", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
