// HU-08 - Tests de integración para PUT /tickets/escalate.
// prisma + auth/catalog clients mockeados; JWT real firmado con el secret de tests/setup-env.ts.

import jwt from "jsonwebtoken";

const mockTransaction = jest.fn();
const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ticketEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn({
      ticket: { update: mockTicketUpdate },
      ticketEvent: { create: mockEventCreate },
    })),
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
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function makeToken(role: string, userId = USER_ID, name = "Test User") {
  return jwt.sign({ userId, email: "u@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

function mockTicket(overrides: Partial<{ levelAssigned: string; status: string }> = {}) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID,
    number: "TK-1",
    userId: USER_ID,
    serviceId: "ss",
    detail: "x",
    levelAssigned: "N1",
    status: "abierto",
    priority: "media",
    ...overrides,
  });
  mockTicketUpdate.mockImplementation(async ({ data }) => ({
    id: TICKET_ID,
    number: "TK-1",
    ...data,
  }));
  mockEventCreate.mockResolvedValue({ id: "ev1" });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTicketUpdate.mockReset();
  mockEventCreate.mockReset();
  // re-implementar $transaction tras clearAllMocks
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({ ticket: { update: mockTicketUpdate }, ticketEvent: { create: mockEventCreate } })
  );
});

describe("PUT /tickets/escalate - HU-08", () => {
  // ---------------- ACs 1-3: técnicos escalan su nivel correctamente ----------------
  it.each([
    ["tech_n1", "N1", "N2"],
    ["tech_n2", "N2", "N3"],
    ["tech_n3", "N3", "N4"],
  ])("AC: %s escala ticket %s a %s con motivo válido", async (role, currentLevel, expectedNext) => {
    mockTicket({ levelAssigned: currentLevel });
    const token = makeToken(role);
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "Caso complejo, no es de mi alcance técnico" });

    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      previousLevel: currentLevel,
      newLevel: expectedNext,
      status: "escalado",
    });
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TICKET_ID },
        data: expect.objectContaining({ levelAssigned: expectedNext, status: "escalado" }),
      })
    );
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ESCALATED",
          previousLevel: currentLevel,
          newLevel: expectedNext,
          reason: "Caso complejo, no es de mi alcance técnico",
        }),
      })
    );
  });

  // ---------------- AC 4: N4 no puede escalar ----------------
  it("AC4: tech_n4 no puede escalar ticket N4 (400)", async () => {
    mockTicket({ levelAssigned: "N4" });
    const token = makeToken("tech_n4");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "Necesita escalar pero ya es N4" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/N4/);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  // ---------------- AC 5: motivo ausente ----------------
  it("AC5: 400 si falta reason", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID });
    expect(res.status).toBe(400);
  });

  // ---------------- AC 6: motivo solo espacios o muy corto ----------------
  it("AC6: 400 si reason es solo espacios", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "      " });
    expect(res.status).toBe(400);
  });

  it("AC6b: 400 si reason tiene menos de 5 caracteres tras trim", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "no" });
    expect(res.status).toBe(400);
  });

  // ---------------- AC 7: sin JWT ----------------
  it("AC7: 401 sin Authorization", async () => {
    const res = await request(app)
      .put("/tickets/escalate")
      .send({ ticketId: TICKET_ID, reason: "motivo valido" });
    expect(res.status).toBe(401);
  });

  // ---------------- AC 8: usuario normal ----------------
  it("AC8: 403 si role es 'user'", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });
    expect(res.status).toBe(403);
  });

  // ---------------- AC 9: técnico de otro nivel ----------------
  it("AC9: tech_n1 no puede escalar ticket N2 (403)", async () => {
    mockTicket({ levelAssigned: "N2" });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });

    expect(res.status).toBe(403);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  // ---------------- AC 10: ticket inexistente ----------------
  it("AC10: 404 si el ticket no existe", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });
    expect(res.status).toBe(404);
  });

  // ---------------- AC 11: ticket cerrado/resuelto ----------------
  it("AC11: 409 si el ticket está resuelto", async () => {
    mockTicket({ status: "resuelto" });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });
    expect(res.status).toBe(409);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("AC11b: 409 si el ticket está cerrado", async () => {
    mockTicket({ status: "cerrado" });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });
    expect(res.status).toBe(409);
  });

  // ---------------- AC 12: el escalamiento registra evento ----------------
  it("AC12: registra TicketEvent.ESCALATED con datos correctos", async () => {
    mockTicket({ levelAssigned: "N2", status: "en_proceso" });
    const token = makeToken("tech_n2", "uuu-uuid", "María García");
    await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "Requiere DITIC, fuera de mi alcance" });

    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: TICKET_ID,
        action: "ESCALATED",
        previousLevel: "N2",
        newLevel: "N3",
        previousStatus: "en_proceso",
        newStatus: "escalado",
        reason: "Requiere DITIC, fuera de mi alcance",
        performedBy: "uuu-uuid",
        performedByName: "María García",
      }),
    });
  });

  // ---------------- AC 13: levelAssigned cambia ----------------
  it("AC13: el ticket update incluye levelAssigned + status=escalado", async () => {
    mockTicket({ levelAssigned: "N1" });
    const token = makeToken("tech_n1");
    await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "motivo valido aqui" });

    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { levelAssigned: "N2", status: "escalado" },
      })
    );
  });

  // ---------------- Admin escala libremente ----------------
  it("admin puede escalar tickets de cualquier nivel", async () => {
    mockTicket({ levelAssigned: "N3" });
    const token = makeToken("admin");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, reason: "Decisión administrativa" });

    expect(res.status).toBe(200);
    expect(res.body.ticket.newLevel).toBe("N4");
  });

  // ---------------- Validación de ticketId ----------------
  it("400 si ticketId no es UUID", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put("/tickets/escalate")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: "abc", reason: "motivo valido" });
    expect(res.status).toBe(400);
  });
});

// ---------------- AC 14/15: regresión ----------------
describe("HU-08 regresión: no rompe HU-06/07", () => {
  it("GET /tickets/level (HU-07) sigue respondiendo 200", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/level")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("GET /tickets (HU-06) sigue respondiendo 200", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
