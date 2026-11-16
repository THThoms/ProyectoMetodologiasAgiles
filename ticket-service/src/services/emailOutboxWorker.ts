// =============================================================================
// Trabajador automático del Email Outbox.
//
// Antes, un correo que fallaba (SMTP caído, rechazo temporal) solo se reintentaba
// cuando un administrador llamaba a POST /admin/email-outbox/process. Ahora un
// temporizador lo hace solo:
//   · cada `intervalSec` segundos (EMAIL_OUTBOX_WORKER_INTERVAL_SEC, 60 por defecto;
//     0 desactiva el trabajador y deja solo el reintento manual);
//   · respeta el backoff progresivo (0 → 5 min → 30 min) y el tope de 3 intentos
//     de processPendingEmails: un SMTP caído no se martillea;
//   · nunca se solapa consigo mismo (si una pasada sigue en curso, la siguiente
//     se salta) y nunca lanza: un fallo se registra y se vuelve a intentar;
//   · no reenvía correos ya `sent` (dispatchEmail los ignora) ni los históricos
//     con 3 intentos agotados.
// Un error de correo jamás afecta a la operación del ticket que lo originó: el
// outbox se creó en su transacción y el envío ocurre aquí, fuera de ella.
// =============================================================================
import { env } from "../config/env";
import { processPendingEmails } from "./emailOutboxService";

export interface OutboxWorkerOptions {
  intervalSec: number;
  /** Máximo de correos por pasada. */
  batch?: number;
  /** Inyectable en pruebas. */
  run?: typeof processPendingEmails;
  log?: (msg: string) => void;
}

export interface OutboxWorkerHandle {
  /** Ejecuta una pasada ahora (la usan las pruebas y el arranque). */
  tick(): Promise<{ processed: number; sent: number; failed: number } | null>;
  stop(): void;
  readonly running: boolean;
}

export function startEmailOutboxWorker(opts: OutboxWorkerOptions): OutboxWorkerHandle | null {
  const run = opts.run ?? processPendingEmails;
  const log = opts.log ?? ((m: string) => console.log(m));
  if (!env.email.enabled) {
    log("[email/worker] notificaciones desactivadas: sin trabajador de outbox");
    return null;
  }
  if (!opts.intervalSec || opts.intervalSec <= 0) {
    log("[email/worker] desactivado (EMAIL_OUTBOX_WORKER_INTERVAL_SEC=0): solo reintento manual");
    return null;
  }
  let busy = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (busy) return null; // la pasada anterior sigue en curso: no se solapa
    busy = true;
    try {
      const summary = await run(opts.batch ?? 50, { respectBackoff: true });
      if (summary.processed > 0) {
        log(`[email/worker] procesados=${summary.processed} enviados=${summary.sent} fallidos=${summary.failed}`);
      }
      return summary;
    } catch (err) {
      console.warn("[email/worker] pasada fallida:", err instanceof Error ? err.message : err);
      return null;
    } finally {
      busy = false;
    }
  }

  timer = setInterval(() => void tick(), opts.intervalSec * 1000);
  timer.unref();
  log(`[email/worker] activo: reintentos cada ${opts.intervalSec}s con backoff (5 min, 30 min) y máximo 3 intentos`);
  return {
    tick,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return busy;
    },
  };
}
