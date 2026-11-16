// Auditoría final — recordatorios al solicitante con una solución sin validar.
//   · tras N días en pendiente_validacion: evento interno + correo + push;
//   · no se repite antes de otros N días;
//   · nunca cambia el estado del ticket ni crea constancias;
//   · N = 0 desactiva.
process.env.EMAIL_SEND_MODE = "mock";
process.env.EMAIL_NOTIFICATIONS_ENABLED = "true";

const mockTicketFindMany = jest.fn();
const mockTicketUpdate = jest.fn();
const mockEventFindMany = jest.fn();
const mockEventCreate = jest.fn();
const mockOutboxCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findMany: (...a: unknown[]) => mockTicketFindMany(...a), update: (...a: unknown[]) => mockTicketUpdate(...a) },
    ticketEvent: { findMany: (...a: unknown[]) => mockEventFindMany(...a), create: (...a: unknown[]) => mockEventCreate(...a) },
    emailOutbox: {
      create: (...a: unknown[]) => mockOutboxCreate(...a),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    solutionAcceptance: { create: jest.fn() },
  },
}));

import { prisma } from "../src/db/client";
import { REMINDER_ACTION, runValidationReminders, startValidationReminderWorker } from "../src/services/validationReminderService";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-15T12:00:00Z");
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ticket = (id: string, resolvedDaysAgo: number) => ({
  id,
  number: `TK-${id.slice(-1)}`,
  userId: "11111111-1111-4111-8111-aaaaaaaaaaaa",
  userName: "Persona",
  userEmail: "persona@uta.edu.ec",
  serviceName: "Red",
  status: "pendiente_validacion",
  resolvedAt: new Date(NOW.getTime() - resolvedDaysAgo * DAY),
  resolvedByName: "Téc",
  assignedTechnicianName: "Téc",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEventFindMany.mockResolvedValue([]);
  mockEventCreate.mockResolvedValue({ id: "ev" });
  mockOutboxCreate.mockResolvedValue({ id: "outbox-1" });
});

it("N=0 → desactivado: no consulta nada", async () => {
  expect(await runValidationReminders({ days: 0, now: NOW })).toEqual({ candidates: 0, reminded: 0, skipped: 0 });
  expect(mockTicketFindMany).not.toHaveBeenCalled();
  expect(startValidationReminderWorker({ days: 0, intervalMin: 60, log: () => undefined })).toBeNull();
});

it("busca solo pendiente_validacion resueltos hace ≥ N días y envía correo + push + evento interno", async () => {
  mockTicketFindMany.mockResolvedValue([ticket(T1, 5)]);
  const push = jest.fn();
  const s = await runValidationReminders({ days: 3, now: NOW, push });
  expect(s).toEqual({ candidates: 1, reminded: 1, skipped: 0 });
  const where = mockTicketFindMany.mock.calls[0][0].where;
  expect(where.status).toBe("pendiente_validacion");
  expect(where.resolvedAt.lte).toEqual(new Date(NOW.getTime() - 3 * DAY));
  // Evento interno (no lo ve el solicitante en su historial) y sin cambio de estado.
  expect(mockEventCreate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ ticketId: T1, action: REMINDER_ACTION, visibility: "internal" }) })
  );
  expect(mockTicketUpdate).not.toHaveBeenCalled();
  expect((prisma.solutionAcceptance.create as jest.Mock)).not.toHaveBeenCalled();
  // Correo por el outbox con la plantilla de recordatorio.
  expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
  const mail = mockOutboxCreate.mock.calls[0][0].data;
  expect(mail.eventType).toBe("TICKET_VALIDATION_REMINDER");
  expect(mail.to).toBe("persona@uta.edu.ec");
  expect(mail.subject).toMatch(/Recordatorio/);
  expect(mail.htmlBody).not.toContain("pendiente_validacion");
  // Push al solicitante con enlace interno.
  expect(push).toHaveBeenCalledWith([ticket(T1, 5).userId], expect.objectContaining({ deepLink: `/tickets/${T1}` }));
});

it("no repite un recordatorio reciente, pero sí uno antiguo", async () => {
  mockTicketFindMany.mockResolvedValue([ticket(T1, 10), ticket(T2, 10)]);
  mockEventFindMany.mockResolvedValue([
    { ticketId: T1, createdAt: new Date(NOW.getTime() - 1 * DAY) }, // hace 1 día → se omite
    { ticketId: T2.toUpperCase(), createdAt: new Date(NOW.getTime() - 4 * DAY) }, // hace 4 días → se repite
  ]);
  const push = jest.fn();
  const s = await runValidationReminders({ days: 3, now: NOW, push });
  expect(s).toEqual({ candidates: 2, reminded: 1, skipped: 1 });
  expect(mockEventCreate).toHaveBeenCalledTimes(1);
  expect(mockEventCreate.mock.calls[0][0].data.ticketId).toBe(T2);
  expect(mockEventCreate.mock.calls[0][0].data.title).toMatch(/repetido/);
});

it("un fallo en un ticket no detiene a los demás ni lanza", async () => {
  mockTicketFindMany.mockResolvedValue([ticket(T1, 5), ticket(T2, 5)]);
  mockEventCreate.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce({ id: "ev2" });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const s = await runValidationReminders({ days: 3, now: NOW, push: jest.fn() });
  warn.mockRestore();
  expect(s).toEqual({ candidates: 2, reminded: 1, skipped: 1 });
});
