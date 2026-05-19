// HU-09 - Servicio reutilizable para registrar eventos en la bitácora del ticket.
// Centraliza la inserción en `ticket_events` para que cualquier endpoint que
// muta un ticket (crear, escalar, cambiar estado, asignar, comentar, cerrar)
// pueda invocarlo de forma consistente sin duplicar lógica.

import {
  EventAction,
  EventVisibility,
  Level,
  Prisma,
  ResponsibleArea,
  TicketStatus,
} from "@prisma/client";

export interface RecordEventInput {
  ticketId: string;
  action: EventAction;
  performedBy: string;
  performedByName: string;
  title?: string | null;
  previousLevel?: Level | null;
  newLevel?: Level | null;
  previousStatus?: TicketStatus | null;
  newStatus?: TicketStatus | null;
  // Sprint 2 (rev) - cambios de área/técnico para escalamiento y asignaciones.
  previousArea?: ResponsibleArea | null;
  newArea?: ResponsibleArea | null;
  previousTechnicianId?: string | null;
  newTechnicianId?: string | null;
  reason?: string | null;
  workDone?: string | null;
  description?: string | null;
  visibility?: EventVisibility;
}

// Tipo del cliente Prisma "extendido" — admite tanto el `prisma` global como
// el `tx` interno de prisma.$transaction(...).
type PrismaLike =
  | Prisma.TransactionClient
  | {
      ticketEvent: { create: (args: Prisma.TicketEventCreateArgs) => Promise<unknown> };
    };

/**
 * Persiste un evento de historial.
 * Diseñado para usarse tanto en transacciones como fuera de ellas: pasar `tx`
 * cuando se quiere atomicidad con otras operaciones (ej. update ticket + event).
 */
export async function recordTicketEvent(
  client: PrismaLike,
  input: RecordEventInput
): Promise<void> {
  await client.ticketEvent.create({
    data: {
      ticketId: input.ticketId,
      action: input.action,
      performedBy: input.performedBy,
      performedByName: input.performedByName,
      title: input.title ?? null,
      previousLevel: input.previousLevel ?? null,
      newLevel: input.newLevel ?? null,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      previousArea: input.previousArea ?? null,
      newArea: input.newArea ?? null,
      previousTechnicianId: input.previousTechnicianId ?? null,
      newTechnicianId: input.newTechnicianId ?? null,
      reason: input.reason ?? null,
      workDone: input.workDone ?? null,
      description: input.description ?? null,
      visibility: input.visibility ?? "public",
    },
  });
}

// ---------------------------------------------------------------------------
// Descripción legible de un evento. Vive en backend para que el frontend
// pueda pintar la timeline sin tener que reimplementar reglas.
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

export function describeEvent(event: {
  action: EventAction;
  previousLevel: Level | null;
  newLevel: Level | null;
  previousStatus: TicketStatus | null;
  newStatus: TicketStatus | null;
  previousArea?: ResponsibleArea | null;
  newArea?: ResponsibleArea | null;
  reason: string | null;
  performedByName: string;
}): string {
  switch (event.action) {
    case "CREATED":
      return `${event.performedByName} creó el ticket`;
    case "CATEGORIZED":
      return `Ticket categorizado para el área ${event.newArea ?? "responsable"}`;
    case "AVAILABLE":
      return `Ticket disponible en la bandeja del área ${event.newArea ?? "responsable"}`;
    case "ACCEPTED":
      return `${event.performedByName} aceptó el ticket`;
    case "ASSIGNED":
      return `${event.performedByName} asignó el ticket`;
    case "REASSIGNED":
      return `${event.performedByName} reasignó el ticket`;
    case "CONTRIBUTED":
      return `${event.performedByName} agregó una aportación al ticket`;
    case "ESCALATED":
      if (event.previousArea && event.newArea && event.previousArea !== event.newArea) {
        return `${event.performedByName} escaló el ticket de ${event.previousArea} a ${event.newArea}`;
      }
      return `${event.performedByName} escaló el ticket`;
    case "STATUS_CHANGED":
      return `${event.performedByName} cambió el estado de ${STATUS_LABEL[event.previousStatus ?? "abierto"]} a ${STATUS_LABEL[event.newStatus ?? "abierto"]}`;
    case "COMMENTED":
      return `${event.performedByName} agregó un comentario`;
    case "RESOLVED":
      return `${event.performedByName} marcó el ticket como resuelto`;
    case "CLOSED":
      return `${event.performedByName} cerró el ticket`;
    default:
      return `${event.performedByName} realizó una acción sobre el ticket`;
  }
}
