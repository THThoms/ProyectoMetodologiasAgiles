// =============================================================================
// Recordatorios al solicitante con una solución pendiente de validar.
//
// Un ticket en `pendiente_validacion` solo lo cierra el propio solicitante
// (aceptar) o lo devuelve a atención (rechazar). Si no responde, el ticket
// quedaba así indefinidamente sin ningún aviso más que el correo inicial.
//
// Política (configurable, sin cierre automático):
//   · VALIDATION_REMINDER_DAYS (3 por defecto; 0 desactiva): tras N días desde la
//     resolución sin decisión se envía un recordatorio (correo por el outbox +
//     push al solicitante) y se registra un evento interno VALIDATION_REMINDER;
//     el siguiente recordatorio espera otros N días desde el último.
//   · Nunca cambia el estado del ticket ni crea constancias: cerrar sin la
//     decisión del usuario exige una política institucional aprobada.
//   · Idempotente: la decisión de enviar se toma con el último evento de
//     recordatorio registrado en ticket_events, no con memoria del proceso.
// =============================================================================
import { prisma } from "../db/client";
import { TicketStatus } from "../domain/enums";
import { dispatchPushInBackground } from "./fcmService";
import { dispatchInBackground, notifyTicketValidationReminder } from "./emailOutboxService";
import { recordTicketEvent } from "./historyService";

export const REMINDER_ACTION = "VALIDATION_REMINDER";
const SYSTEM_ACTOR = { id: "00000000-0000-0000-0000-000000000000", name: "ServiceDesk (recordatorio automático)" };
const MAX_PER_RUN = 200;

export interface ReminderRunOptions {
  days: number;
  now?: Date;
  /** Inyectables en pruebas. */
  push?: typeof dispatchPushInBackground;
  email?: typeof notifyTicketValidationReminder;
}

export interface ReminderRunSummary {
  candidates: number;
  reminded: number;
  skipped: number;
}

/**
 * Una pasada: busca tickets `pendiente_validacion` resueltos hace ≥ N días y
 * sin recordatorio en los últimos N días; envía y registra. Nunca lanza.
 */
export async function runValidationReminders(opts: ReminderRunOptions): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { candidates: 0, reminded: 0, skipped: 0 };
  if (!opts.days || opts.days <= 0) return summary;
  const now = opts.now ?? new Date();
  const threshold = new Date(now.getTime() - opts.days * 24 * 60 * 60 * 1000);
  const push = opts.push ?? dispatchPushInBackground;
  const email = opts.email ?? notifyTicketValidationReminder;

  try {
    const tickets = await prisma.ticket.findMany({
      where: { status: TicketStatus.pendiente_validacion, resolvedAt: { lte: threshold } },
      orderBy: { resolvedAt: "asc" },
      take: MAX_PER_RUN,
    });
    summary.candidates = tickets.length;
    if (tickets.length === 0) return summary;

    // Último recordatorio por ticket (una sola consulta).
    const reminders = await prisma.ticketEvent.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) }, action: REMINDER_ACTION },
      orderBy: { createdAt: "desc" },
      select: { ticketId: true, createdAt: true },
    });
    const lastReminder = new Map<string, Date>();
    for (const r of reminders) {
      const k = r.ticketId.toLowerCase();
      if (!lastReminder.has(k)) lastReminder.set(k, r.createdAt);
    }

    for (const t of tickets) {
      const last = lastReminder.get(t.id.toLowerCase());
      if (last && last > threshold) {
        summary.skipped++;
        continue;
      }
      try {
        // Evento interno primero: si se registra, el recordatorio cuenta como
        // enviado aunque el correo o el push fallen (se reintentan solos).
        await recordTicketEvent(prisma, {
          ticketId: t.id,
          action: REMINDER_ACTION,
          title: `Recordatorio ${last ? "repetido" : "enviado"}: solución pendiente de validación desde hace ${opts.days}+ días`,
          visibility: "internal",
          performedBy: SYSTEM_ACTOR.id,
          performedByName: SYSTEM_ACTOR.name,
        });
        const outboxId = await email({
          client: prisma,
          ticketId: t.id,
          to: t.userEmail,
          ctx: {
            number: t.number,
            userName: t.userName,
            serviceName: t.serviceName,
            status: t.status,
            technicianName: t.resolvedByName ?? t.assignedTechnicianName,
            eventDate: t.resolvedAt,
          },
        });
        dispatchInBackground(outboxId);
        push([t.userId], {
          title: `Ticket ${t.number}: tu validación sigue pendiente`,
          body: "Revisa la solución registrada y acéptala o recházala desde Mis tickets.",
          data: { ticketId: t.id, eventType: "TICKET_VALIDATION_REMINDER" },
          deepLink: `/tickets/${t.id}`,
        });
        summary.reminded++;
      } catch (err) {
        console.warn(`[reminders] no se pudo recordar el ticket ${t.number}:`, err instanceof Error ? err.message : err);
        summary.skipped++;
      }
    }
  } catch (err) {
    console.warn("[reminders] pasada fallida:", err instanceof Error ? err.message : err);
  }
  return summary;
}

export interface ReminderWorkerOptions {
  days: number;
  intervalMin: number;
  log?: (msg: string) => void;
}

export function startValidationReminderWorker(opts: ReminderWorkerOptions): { stop(): void } | null {
  const log = opts.log ?? ((m: string) => console.log(m));
  if (!opts.days || opts.days <= 0) {
    log("[reminders] desactivados (VALIDATION_REMINDER_DAYS=0)");
    return null;
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s = await runValidationReminders({ days: opts.days });
      if (s.reminded > 0) log(`[reminders] recordatorios enviados=${s.reminded} (candidatos=${s.candidates}, omitidos=${s.skipped})`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMin * 60_000);
  timer.unref();
  // Primera pasada poco después del arranque (sin bloquear el arranque).
  const first = setTimeout(() => void tick(), 30_000);
  first.unref();
  log(`[reminders] activos: solución sin validar durante ${opts.days} días → recordatorio (revisión cada ${opts.intervalMin} min)`);
  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
