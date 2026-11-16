// Auditoría final — trabajador automático del Email Outbox:
//   · backoff progresivo (0 → 5 min → 30 min) y tope de 3 intentos;
//   · el reintento manual del administrador no espera el backoff;
//   · el trabajador no se solapa consigo mismo y nunca lanza;
//   · desactivable (intervalo 0).
process.env.EMAIL_SEND_MODE = "mock";
process.env.EMAIL_NOTIFICATIONS_ENABLED = "true";

const mockOutboxFindMany = jest.fn();
const mockOutboxFindUnique = jest.fn();
const mockOutboxUpdate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    emailOutbox: {
      findMany: (...a: unknown[]) => mockOutboxFindMany(...a),
      findUnique: (...a: unknown[]) => mockOutboxFindUnique(...a),
      update: (...a: unknown[]) => mockOutboxUpdate(...a),
      create: jest.fn(),
    },
  },
}));

import {
  MAX_EMAIL_ATTEMPTS,
  RETRY_BACKOFF_MS,
  processPendingEmails,
  retryBackoffMs,
} from "../src/services/emailOutboxService";
import { startEmailOutboxWorker } from "../src/services/emailOutboxWorker";

beforeEach(() => {
  jest.clearAllMocks();
  mockOutboxFindMany.mockResolvedValue([]);
});

describe("backoff del outbox", () => {
  it("0 intentos → inmediato, 1 → 5 min, 2 → 30 min, y nunca más de 3 intentos", () => {
    expect(retryBackoffMs(0)).toBe(0);
    expect(retryBackoffMs(1)).toBe(5 * 60_000);
    expect(retryBackoffMs(2)).toBe(30 * 60_000);
    expect(retryBackoffMs(99)).toBe(30 * 60_000);
    expect(MAX_EMAIL_ATTEMPTS).toBe(3);
    expect(RETRY_BACKOFF_MS).toHaveLength(MAX_EMAIL_ATTEMPTS);
  });

  it("el trabajador solo toma correos cuyo backoff ya venció", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    await processPendingEmails(50, { respectBackoff: true, now });
    const where = mockOutboxFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["pending", "failed"] });
    expect(where.attempts).toEqual({ lt: MAX_EMAIL_ATTEMPTS });
    expect(where.OR).toEqual([
      { attempts: 0, updatedAt: { lte: now } },
      { attempts: 1, updatedAt: { lte: new Date(now.getTime() - 5 * 60_000) } },
      { attempts: 2, updatedAt: { lte: new Date(now.getTime() - 30 * 60_000) } },
    ]);
  });

  it("el reintento manual del administrador no aplica backoff", async () => {
    await processPendingEmails(50);
    const where = mockOutboxFindMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.attempts).toEqual({ lt: MAX_EMAIL_ATTEMPTS });
  });
});

describe("trabajador periódico", () => {
  it("intervalo 0 → no arranca (solo reintento manual)", () => {
    const log = jest.fn();
    expect(startEmailOutboxWorker({ intervalSec: 0, log })).toBeNull();
    expect(log.mock.calls[0][0]).toMatch(/desactivado/);
  });

  it("procesa con backoff, no se solapa y no lanza si la pasada falla", async () => {
    const run = jest.fn();
    const log = jest.fn();
    const w = startEmailOutboxWorker({ intervalSec: 3600, batch: 7, run, log })!;
    expect(w).not.toBeNull();

    // 1) pasada normal: llama con el lote y respectBackoff.
    run.mockResolvedValueOnce({ processed: 2, sent: 1, failed: 1 });
    expect(await w.tick()).toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(run).toHaveBeenCalledWith(7, { respectBackoff: true });
    expect(log.mock.calls.some((c) => String(c[0]).includes("procesados=2"))).toBe(true);

    // 2) sin solape: mientras una pasada sigue en curso, la siguiente devuelve null.
    let release!: (v: { processed: number; sent: number; failed: number }) => void;
    run.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const slow = w.tick();
    expect(w.running).toBe(true);
    expect(await w.tick()).toBeNull();
    release({ processed: 0, sent: 0, failed: 0 });
    await slow;
    expect(w.running).toBe(false);

    // 3) un fallo (SMTP caído, base inaccesible) se registra y no se propaga.
    run.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await w.tick()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(run).toHaveBeenCalledTimes(3);
    w.stop();
  });
});
