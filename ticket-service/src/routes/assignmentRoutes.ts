// Sprint 2 (rev) - Endpoints del flujo categorización + aceptación + asignación.
//
//   GET  /tickets/my            -> usuario: tickets que él creó.
//   GET  /tickets/available     -> técnico: tickets disponibles para su(s) área(s).
//   POST /tickets/:id/accept    -> técnico: aceptar un ticket disponible.
//   GET  /tickets/accepted      -> técnico: tickets ya aceptados por él.
//   POST /tickets/:id/contributions -> técnico/admin: agregar aportación al ticket.
//   PUT  /tickets/:id/escalate  -> técnico/admin: escalamiento mejorado (workDone, targetArea).
//
// El registro en `ticket_events` se hace dentro de la misma transacción de cada
// acción para garantizar trazabilidad atómica.

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, ResponsibleArea, EventVisibility } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { recordTicketEvent } from "../services/historyService";
import { areasForRole, canHandleArea, isStaffRole } from "../services/areaService";

const router = Router();

// ---------------------------------------------------------------------------
// GET /tickets/my  -> Tickets del usuario autenticado (creador del ticket).
// Filtros opcionales: status, page, limit.
// ---------------------------------------------------------------------------
const myQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/my", verifyJwt, async (req: Request, res: Response) => {
  const parsed = myQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { status, page, limit } = parsed.data;
  const where: Prisma.TicketWhereInput = { userId: req.user!.userId };
  if (status) where.status = status as never;

  const effectivePage = page ?? 1;
  const effectiveLimit = limit ?? 20;

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { attachments: true },
      skip: (effectivePage - 1) * effectiveLimit,
      take: effectiveLimit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return res.json({
    tickets,
    total,
    filters: { status: status ?? null, page: effectivePage, limit: effectiveLimit },
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/available -> Tickets disponibles para que un técnico los acepte.
// Filtros: tickets sin asignar, no resueltos/cerrados, área compatible con el rol.
// ---------------------------------------------------------------------------
router.get("/available", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res
      .status(403)
      .json({ error: "Solo personal autorizado puede ver la bandeja de disponibles" });
  }
  const areas = areasForRole(role);
  if (areas.length === 0) {
    return res.json({ tickets: [], total: 0 });
  }

  const where: Prisma.TicketWhereInput = {
    assignedTechnicianId: null,
    responsibleArea: { in: areas },
    status: { notIn: ["resuelto", "cerrado"] },
  };

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { attachments: true },
    }),
    prisma.ticket.count({ where }),
  ]);

  return res.json({ tickets, total, areas });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/accept -> Técnico acepta un ticket disponible.
// ---------------------------------------------------------------------------
router.post("/:id/accept", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role) || role === "admin") {
    if (role === "admin") {
      // Admin debería usar /admin/tickets/:id/assign con un technicianId.
      return res
        .status(403)
        .json({ error: "Admin debe usar /admin/tickets/:id/assign para asignar técnicos" });
    }
    return res.status(403).json({ error: "Solo técnicos pueden aceptar tickets" });
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }
  if (ticket.assignedTechnicianId) {
    return res
      .status(409)
      .json({ error: "El ticket ya fue aceptado por otro técnico" });
  }
  if (ticket.status === "resuelto" || ticket.status === "cerrado") {
    return res
      .status(409)
      .json({ error: `El ticket está ${ticket.status} y no puede aceptarse` });
  }
  if (!canHandleArea(role, ticket.responsibleArea)) {
    return res.status(403).json({
      error: `Tu rol no puede atender tickets del área ${ticket.responsibleArea}`,
    });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: {
          assignedTechnicianId: req.user!.userId,
          assignedTechnicianName: req.user!.name,
          assignmentStatus: "accepted",
          acceptedAt: new Date(),
          status: "en_proceso",
        },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "ACCEPTED",
        title: `Ticket aceptado por ${req.user!.name}`,
        previousStatus: ticket.status,
        newStatus: "en_proceso",
        newTechnicianId: req.user!.userId,
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      return u;
    });
    return res.json({ message: "Ticket aceptado correctamente", ticket: updated });
  } catch (err) {
    console.error("[accept] error:", err);
    return res.status(500).json({ error: "Error interno al aceptar el ticket" });
  }
});

// ---------------------------------------------------------------------------
// GET /tickets/accepted -> Tickets aceptados por el técnico autenticado.
// ---------------------------------------------------------------------------
router.get("/accepted", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res.status(403).json({ error: "Solo personal autorizado" });
  }
  // admin ve todos los asignados; tech_* ve los suyos.
  const where: Prisma.TicketWhereInput =
    role === "admin"
      ? { assignedTechnicianId: { not: null } }
      : { assignedTechnicianId: req.user!.userId };

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { acceptedAt: "desc" },
    include: { attachments: true },
  });
  return res.json({ tickets, total: tickets.length });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/contributions -> Aportación del técnico al ticket.
//   body: { description (>=5 chars trim), visibility?: "public"|"internal" }
// ---------------------------------------------------------------------------
const contributionSchema = z.object({
  description: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 5, {
      message: "La aportación debe tener al menos 5 caracteres",
    }),
  visibility: z.nativeEnum(EventVisibility).optional(),
});

router.post("/:id/contributions", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res.status(403).json({ error: "Solo personal autorizado" });
  }
  const parsed = contributionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { description, visibility } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

  // Solo el técnico asignado o admin pueden aportar.
  if (role !== "admin" && ticket.assignedTechnicianId !== req.user!.userId) {
    return res
      .status(403)
      .json({ error: "Solo puedes aportar a tickets asignados a ti" });
  }

  await recordTicketEvent(prisma, {
    ticketId: req.params.id,
    action: "CONTRIBUTED",
    title: "Aportación del técnico",
    description,
    visibility: visibility ?? "public",
    performedBy: req.user!.userId,
    performedByName: req.user!.name,
  });

  return res.status(201).json({ message: "Aportación registrada" });
});

// ---------------------------------------------------------------------------
// PUT /tickets/:id/escalate -> Escalamiento mejorado.
//   body: { reason, workDone, targetArea?, description? }
// Reemplaza al PUT /tickets/escalate de HU-08 (que se mantiene en compat).
// ---------------------------------------------------------------------------
const escalateSchema = z.object({
  reason: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 5, {
      message: "El motivo debe tener al menos 5 caracteres",
    }),
  workDone: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 5, {
      message: "Debes describir qué se hizo antes de escalar (mínimo 5 caracteres)",
    }),
  targetArea: z.nativeEnum(ResponsibleArea).optional(),
  description: z.string().optional(),
});

router.put("/:id/escalate", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res
      .status(403)
      .json({ error: "Solo personal autorizado puede escalar tickets" });
  }
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { reason, workDone, targetArea, description } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  if (ticket.status === "resuelto" || ticket.status === "cerrado") {
    return res
      .status(409)
      .json({ error: `El ticket está ${ticket.status} y no puede escalarse` });
  }
  if (role !== "admin" && ticket.assignedTechnicianId !== req.user!.userId) {
    return res.status(403).json({
      error: "Solo puedes escalar tickets asignados a ti",
    });
  }

  const newArea = targetArea ?? ticket.responsibleArea;
  const areaChanged = newArea !== ticket.responsibleArea;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: {
          status: "escalado",
          responsibleArea: newArea,
          // Si cambia de área, el ticket vuelve a la bandeja sin asignar.
          ...(areaChanged
            ? {
                assignedTechnicianId: null,
                assignedTechnicianName: null,
                acceptedAt: null,
                assignmentStatus: "available",
              }
            : {}),
        },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "ESCALATED",
        title: areaChanged
          ? `Escalado de ${ticket.responsibleArea} a ${newArea}`
          : "Escalamiento dentro del área",
        previousStatus: ticket.status,
        newStatus: "escalado",
        previousArea: ticket.responsibleArea,
        newArea,
        previousTechnicianId: ticket.assignedTechnicianId,
        newTechnicianId: areaChanged ? null : ticket.assignedTechnicianId,
        reason,
        workDone,
        description: description ?? null,
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      return u;
    });
    return res.json({
      message: "Ticket escalado correctamente",
      ticket: {
        id: updated.id,
        number: updated.number,
        previousArea: ticket.responsibleArea,
        newArea,
        previousStatus: ticket.status,
        newStatus: updated.status,
        assignmentStatus: updated.assignmentStatus,
      },
    });
  } catch (err) {
    console.error("[escalate-v2] error:", err);
    return res.status(500).json({ error: "Error interno al escalar el ticket" });
  }
});

export default router;
