// Auditoría general — endurecimiento de ticket-service:
//   · errores asíncronos e identificadores inválidos (antes tumbaban el proceso);
//   · /uploads ya no se sirve como carpeta estática;
//   · JWT: solo HS256 y solo tokens de usuario;
//   · una solución pendiente de validación no se puede escalar;
//   · un ticket cerrado no admite aportaciones;
//   · numeración de tickets ante creaciones simultáneas;
//   · avisos push con consulta de servicio (no con el rol de quien actúa);
//   · los listados devuelven los adjuntos con la URL autenticada.
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";

const mockTicketCreate = jest.fn();
const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockOutboxCreate = jest.fn();
const mockSendPush = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    ticketEvent: { create: jest.fn(), findMany: jest.fn() },
    attachment: { findUnique: jest.fn() },
    deviceToken: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    emailOutbox: {
      create: (...a: unknown[]) => mockOutboxCreate(...a),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: jest.fn(),
  fetchTechnicianDirectory: jest.fn(),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchService: jest.fn() };
});
jest.mock("../src/services/ticketNumber", () => ({ generateTicketNumber: jest.fn() }));
jest.mock("../src/services/fcmService", () => ({
  dispatchPushInBackground: (...a: unknown[]) => mockSendPush(...a),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchTechnicians, fetchTechnicianDirectory } from "../src/services/authClient";
import { fetchService } from "../src/services/catalogClient";
import { generateTicketNumber } from "../src/services/ticketNumber";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "55555555-5555-4555-8555-555555555555";
const ATT_ID = "66666666-6666-4666-8666-666666666666";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const TECH_ID = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const DTIC_ID = "44444444-4444-4444-8444-dddddddddddd";

const sign = (payload: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
  jwt.sign(payload, SECRET, { expiresIn: "1h", ...opts });
const tokenFor = (role: string, userId = USER_ID) => sign({ userId, email: "u@uta.edu.ec", name: "Persona", role });
const auth = (role: string, userId = USER_ID) => `Bearer ${tokenFor(role, userId)}`;

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    number: "TK-20261112-001",
    userId: USER_ID,
    userName: "Persona",
    userEmail: "u@uta.edu.ec",
    serviceId: SERVICE_ID,
    serviceName: "Red e Internet",
    detail: "No hay red",
    status: "en_proceso",
    priority: "media",
    responsibleArea: "TECHNICIANS",
    assignmentStatus: "accepted",
    assignedTechnicianId: TECH_ID,
    assignedTechnicianName: "Técnico",
    ...over,
  };
}
const flush = () => new Promise((r) => setImmediate(r));

let errorLog: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockOutboxCreate.mockResolvedValue({ id: "outbox-1" });
  mockEventCreate.mockResolvedValue({ id: "ev" });
  mockTicketUpdate.mockImplementation(async ({ data }) => ({ ...ticket(), ...data }));
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({
      ticket: { create: mockTicketCreate, update: mockTicketUpdate },
      ticketEvent: { create: mockEventCreate },
      emailOutbox: { create: mockOutboxCreate },
    })
  );
});
afterEach(() => errorLog.mockRestore());

// ---------------------------------------------------------------------------
describe("identificadores inválidos y errores asíncronos", () => {
  it.each([
    ["get", "/tickets/no-es-uuid"],
    ["get", "/tickets/history/123"],
    ["get", `/tickets/${TICKET_ID}/attachments/..%2F..%2Fetc%2Fpasswd`],
    ["get", "/tickets/abc/acceptances"],
    ["post", "/tickets/abc/accept"],
    ["post", "/tickets/abc/resolve"],
    ["post", "/tickets/abc/user-accept"],
    ["put", "/tickets/abc/escalate"],
    ["post", "/admin/tickets/abc/assign"],
  ])("%s %s → 400 sin llegar a la base", async (method, url) => {
    const role = url.startsWith("/admin") ? "admin" : "technician";
    const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url)
      .set("Authorization", auth(role, TECH_ID))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Identificador inválido" });
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("los endpoints retirados siguen respondiendo 410", async () => {
    expect((await request(app).get("/tickets/level").set("Authorization", auth("technician"))).status).toBe(410);
    expect((await request(app).put("/tickets/escalate").set("Authorization", auth("technician"))).status).toBe(410);
    expect((await request(app).patch(`/tickets/${TICKET_ID}/status`).set("Authorization", auth("technician"))).status).toBe(410);
  });

  it("si la base falla, la ruta responde 500 JSON (antes el rechazo terminaba el proceso)", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockRejectedValue(new Error("conexión perdida con SQL Server"));
    for (const [method, url] of [
      ["get", `/tickets/${TICKET_ID}`],
      ["get", `/tickets/history/${TICKET_ID}`],
      ["post", `/tickets/${TICKET_ID}/accept`],
    ] as const) {
      const res = await request(app)[method](url).set("Authorization", auth("technician", TECH_ID));
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Error interno del servidor" });
    }
    (prisma.ticket.findMany as jest.Mock).mockRejectedValue(new Error("db"));
    (prisma.ticket.count as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await request(app).get("/tickets/my").set("Authorization", auth("user"))).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe("acceso a las imágenes", () => {
  it("/uploads ya no existe como carpeta estática: ni con un JWT válido", async () => {
    const res = await request(app).get("/uploads/1700000000000-abcdef123456.png").set("Authorization", auth("user"));
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("los listados devuelven la URL autenticada del adjunto, no la ruta interna", async () => {
    const withAttachment = ticket({
      attachments: [
        { id: ATT_ID, ticketId: TICKET_ID, filePath: "foto.png", imageUrl: "/uploads/foto.png", storageProvider: "local", mimeType: "image/png", fileSize: 10 },
      ],
    });
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([withAttachment]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(1);
    for (const [url, role, id] of [
      ["/tickets/my", "user", USER_ID],
      ["/tickets/available", "technician", TECH_ID],
      ["/tickets/accepted", "technician", TECH_ID],
      ["/tickets/my-assigned", "technician", TECH_ID],
    ]) {
      const res = await request(app).get(url).set("Authorization", auth(role, id));
      expect(res.status).toBe(200);
      expect(res.body.tickets[0].attachments[0].imageUrl).toBe(`/api/tickets/${TICKET_ID}/attachments/${ATT_ID}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("JWT", () => {
  const get = (t: string) => request(app).get("/tickets/my").set("Authorization", `Bearer ${t}`);

  it("un token interno de servicio no sirve como sesión de usuario", async () => {
    const service = sign({ typ: "service", svc: "ticket-service", role: "admin" }, { audience: "servicedesk-internal" });
    expect((await get(service)).status).toBe(401);
    expect((await get(sign({ role: "admin" }))).status).toBe(401);
  });

  it("solo se acepta HS256 (ni alg none ni HS512)", async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: USER_ID, role: "admin" })}.`;
    expect((await get(unsigned)).status).toBe(401);
    expect((await get(sign({ userId: USER_ID, role: "admin" }, { algorithm: "HS512" }))).status).toBe(401);
  });

  it("el token de servicio que firma ticket-service no lleva identidad de usuario", () => {
    const { signServiceToken } = jest.requireActual("../src/services/authClient");
    const payload = jwt.verify(signServiceToken(), SECRET, { audience: "servicedesk-internal" }) as jwt.JwtPayload;
    expect(payload).toMatchObject({ typ: "service", svc: "ticket-service" });
    expect(payload.userId).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
describe("flujo de validación del solicitante", () => {
  const escalate = () =>
    request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", auth("technician", TECH_ID))
      .send({ reason: "Requiere otra área", workDone: "Se revisó el equipo", targetArea: "DTIC" });

  it("una solución pendiente de validación NO se puede escalar (decide el solicitante)", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket({ status: "pendiente_validacion" }));
    const res = await escalate();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pendiente de validación/);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it("tampoco el administrador la escala por encima del solicitante", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket({ status: "pendiente_validacion" }));
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", auth("admin"))
      .send({ reason: "Requiere otra área", workDone: "Se revisó el equipo" });
    expect(res.status).toBe(409);
  });

  it("el escalado es condicional: si el ticket cambió entre la lectura y la escritura → 409", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket());
    mockTicketUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record to update not found", { code: "P2025", clientVersion: "5" })
    );
    const res = await escalate();
    expect(res.status).toBe(409);
    expect(mockTicketUpdate.mock.calls[0][0].where).toEqual({
      id: TICKET_ID,
      status: { notIn: ["resuelto", "cerrado", "pendiente_validacion"] },
      assignedTechnicianId: TECH_ID,
    });
  });

  it.each(["cerrado", "resuelto"])("un ticket %s no admite nuevas aportaciones", async (status) => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket({ status }));
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", auth("technician", TECH_ID))
      .send({ description: "Nota añadida después del cierre" });
    expect(res.status).toBe(409);
    expect(prisma.ticketEvent.create).not.toHaveBeenCalled();
  });

  it("los textos libres tienen tope (aportación, motivo de escalado, motivo de rechazo)", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket());
    const big = "x".repeat(5001);
    const tech = auth("technician", TECH_ID);
    expect((await request(app).post(`/tickets/${TICKET_ID}/contributions`).set("Authorization", tech).send({ description: big })).status).toBe(400);
    expect((await request(app).put(`/tickets/${TICKET_ID}/escalate`).set("Authorization", tech).send({ reason: big, workDone: "trabajo previo" })).status).toBe(400);
    expect(
      (await request(app).post(`/tickets/${TICKET_ID}/user-reject`).set("Authorization", auth("user")).send({ termsAccepted: true, termsVersion: "1.0", reason: big })).status
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("creación de tickets", () => {
  const create = (role = "user") =>
    request(app).post("/tickets").set("Authorization", auth(role)).field("serviceId", SERVICE_ID).field("detail", "No hay red en el laboratorio");

  beforeEach(() => {
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID, name: "Red e Internet", isActive: true, levelEntry: "N1", responsibleArea: "TECHNICIANS",
      routingRule: { levelEntry: "N1", priorityHigh: null, priorityCritical: null, isCritical: false },
    });
    mockTicketCreate.mockImplementation(async ({ data }) => ({
      id: TICKET_ID, status: "abierto", priority: "media", ...data, attachments: [],
    }));
    (fetchTechnicianDirectory as jest.Mock).mockResolvedValue([
      { id: TECH_ID, role: "technician", block: "BLOQUE_1", isActive: true },
      { id: DTIC_ID, role: "dtic", block: null, isActive: true },
    ]);
  });

  it("dos creaciones simultáneas con el mismo número: la segunda reintenta con el siguiente", async () => {
    (generateTicketNumber as jest.Mock).mockResolvedValueOnce("TK-20261112-007").mockResolvedValueOnce("TK-20261112-008");
    mockTicketCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5" })
    );
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.ticket.number).toBe("TK-20261112-008");
    expect(generateTicketNumber).toHaveBeenCalledTimes(2);
  });

  it("si el número choca siempre, se rinde tras 5 intentos con un error controlado", async () => {
    (generateTicketNumber as jest.Mock).mockResolvedValue("TK-20261112-007");
    mockTicketCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5" })
    );
    const res = await create();
    expect(res.status).toBe(400);
    expect(generateTicketNumber).toHaveBeenCalledTimes(5);
  });

  it("un SOLICITANTE crea el ticket y los técnicos del área reciben el aviso push", async () => {
    (generateTicketNumber as jest.Mock).mockResolvedValue("TK-20261112-001");
    const res = await create("user");
    expect(res.status).toBe(201);
    await flush();
    // La consulta es de servicio a servicio: no se usa el JWT del solicitante
    // contra el endpoint de administradores (que respondía 403).
    expect(fetchTechnicianDirectory).toHaveBeenCalledTimes(1);
    expect(fetchTechnicians).not.toHaveBeenCalled();
    expect(mockSendPush).toHaveBeenCalledWith([TECH_ID], expect.objectContaining({ title: "Nuevo ticket TK-20261112-001" }));
  });

  it("si el directorio de técnicos falla, el ticket se crea igual", async () => {
    (generateTicketNumber as jest.Mock).mockResolvedValue("TK-20261112-002");
    (fetchTechnicianDirectory as jest.Mock).mockRejectedValue(new Error("auth-service caído"));
    expect((await create()).status).toBe(201);
    await flush();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("al escalar, un TÉCNICO avisa a la nueva área (DTIC), sin incluirse a sí mismo", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(ticket());
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", auth("technician", TECH_ID))
      .send({ reason: "Requiere plataforma", workDone: "Se revisó la red", targetArea: "DTIC" });
    expect(res.status).toBe(200);
    await flush();
    expect(fetchTechnicians).not.toHaveBeenCalled();
    expect(mockSendPush).toHaveBeenCalledWith([DTIC_ID], expect.objectContaining({ data: expect.objectContaining({ eventType: "TICKET_ESCALATED" }) }));
  });
});

// ---------------------------------------------------------------------------
describe("registro de dispositivos", () => {
  it("un token FCM que no cabe en la columna (512) se rechaza con 400, no con 500", async () => {
    const res = await request(app)
      .post("/notifications/register")
      .set("Authorization", auth("user"))
      .send({ token: "t".repeat(513), platform: "android" });
    expect(res.status).toBe(400);
    expect(prisma.deviceToken.upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("correo saliente: las credenciales SMTP no viajan sin TLS", () => {
  const load = (vars: Record<string, string | undefined>) => {
    let requireTls = false;
    const saved = { ...process.env };
    for (const k of ["SMTP_USER", "SMTP_PASS", "SMTP_SECURE", "SMTP_REQUIRE_TLS"]) delete process.env[k];
    Object.assign(process.env, vars);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      requireTls = require("../src/config/env").env.email.smtp.requireTls;
    });
    process.env = saved;
    return requireTls;
  };

  it("con usuario y contraseña se exige STARTTLS por defecto (también si la variable llega vacía)", () => {
    expect(load({ SMTP_USER: "u", SMTP_PASS: "p" })).toBe(true);
    expect(load({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_REQUIRE_TLS: "" })).toBe(true);
  });

  it("sin credenciales no se exige; SMTP_REQUIRE_TLS lo fija en ambos sentidos", () => {
    expect(load({})).toBe(false);
    expect(load({ SMTP_REQUIRE_TLS: "true" })).toBe(true);
    expect(load({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_REQUIRE_TLS: "false" })).toBe(false);
  });

  it("con TLS implícito (SMTP_SECURE=true) no hace falta STARTTLS", () => {
    expect(load({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_SECURE: "true" })).toBe(false);
  });
});
