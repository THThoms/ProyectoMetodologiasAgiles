// HU-06 - Tests de integración del endpoint /routing.
// Mockeamos Prisma (sin BD) y catalogClient (sin HTTP). JWT real firmado con
// el mismo secreto que carga env (definido en tests/setup-env.ts).

import jwt from "jsonwebtoken";

// -- Mocks antes de importar el app --
jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return {
    ...actual,
    fetchService: jest.fn(),
  };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchService } from "../src/services/catalogClient";

const app = createApp();

const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000001") {
  return jwt.sign(
    {
      userId,
      email: "test@uta.edu.ec",
      name: "Test User",
      role,
    },
    SECRET,
    { expiresIn: "1h" }
  );
}

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

const ROUTING_RULE_BASIC = {
  levelEntry: "N1",
  priorityHigh: "N2",
  priorityCritical: "N3",
  isCritical: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /routing/assign", () => {
  // -------------------------------------------------------------------------
  // Validación JWT
  // -------------------------------------------------------------------------
  it("responde 401 si no hay header Authorization", async () => {
    const res = await request(app).post("/routing/assign").send({ ticketId: TICKET_ID });
    expect(res.status).toBe(401);
  });

  it("responde 401 si el token está mal firmado", async () => {
    const badToken = jwt.sign({ userId: "x", role: "admin" }, "OTHER_SECRET");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${badToken}`)
      .send({ ticketId: TICKET_ID });
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Validación de permisos
  // -------------------------------------------------------------------------
  it("responde 403 si el rol no es admin ni tech_*", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // AC4: error si el ticket no existe
  // -------------------------------------------------------------------------
  it("responde 404 si el ticket no existe", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);

    const token = makeToken("admin");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no encontrado/i);
  });

  // -------------------------------------------------------------------------
  // AC3: error si no existe regla de enrutamiento
  // -------------------------------------------------------------------------
  it("responde 400 si el servicio no tiene routingRule configurada", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
      id: TICKET_ID,
      serviceId: SERVICE_ID,
      priority: "media",
      levelAssigned: "N1",
    });
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Servicio Sin Regla",
      isActive: true,
      levelEntry: "N2",
      routingRule: null,
    });

    const token = makeToken("admin");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/regla de enrutamiento/i);
  });

  // -------------------------------------------------------------------------
  // Validación de body
  // -------------------------------------------------------------------------
  it("responde 400 si ticketId no es UUID", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // AC1: Red e Internet (levelEntry N1) -> N1
  // -------------------------------------------------------------------------
  it("AC1: asigna N1 a un ticket con servicio 'Red e Internet' sin prioridad alta", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
      id: TICKET_ID,
      serviceId: SERVICE_ID,
      priority: "media",
      levelAssigned: "N3", // estado previo incorrecto, se debe corregir
    });
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Red e Internet",
      isActive: true,
      levelEntry: "N1",
      routingRule: ROUTING_RULE_BASIC,
    });
    (prisma.ticket.update as jest.Mock).mockImplementation(async ({ data }) => ({
      id: TICKET_ID,
      serviceId: SERVICE_ID,
      priority: "media",
      ...data,
    }));

    const token = makeToken("admin");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID });

    expect(res.status).toBe(200);
    expect(res.body.routing.levelAssigned).toBe("N1");
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TICKET_ID },
        data: expect.objectContaining({ levelAssigned: "N1" }),
      })
    );
  });

  // -------------------------------------------------------------------------
  // AC2: Categoría crítica + prioridad crítica -> escala a N4
  // -------------------------------------------------------------------------
  it("AC2: servicio crítico con prioridad crítica escala a N4", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
      id: TICKET_ID,
      serviceId: SERVICE_ID,
      priority: "media",
      levelAssigned: "N3",
    });
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Seguridad de la Información",
      isActive: true,
      levelEntry: "N3",
      routingRule: {
        levelEntry: "N3",
        priorityHigh: "N3",
        priorityCritical: "N4",
        isCritical: true,
      },
    });
    (prisma.ticket.update as jest.Mock).mockImplementation(async ({ data }) => ({
      id: TICKET_ID,
      serviceId: SERVICE_ID,
      ...data,
    }));

    const token = makeToken("tech_n3");
    const res = await request(app)
      .post("/routing/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: TICKET_ID, priority: "critica" });

    expect(res.status).toBe(200);
    expect(res.body.routing.levelAssigned).toBe("N4");
    expect(res.body.routing.priority).toBe("critica");
  });
});

describe("POST /routing/preview", () => {
  it("responde 401 sin token", async () => {
    const res = await request(app).post("/routing/preview").send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(401);
  });

  it("calcula el nivel sin persistir nada", async () => {
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Red e Internet",
      isActive: true,
      levelEntry: "N1",
      routingRule: ROUTING_RULE_BASIC,
    });

    const token = makeToken("user");
    const res = await request(app)
      .post("/routing/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ serviceId: SERVICE_ID, priority: "alta" });

    expect(res.status).toBe(200);
    expect(res.body.level).toBe("N2");
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});
