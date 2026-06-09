// Sprint 2 (rev) - Endpoints del flujo categorización + aceptación + asignación.
//
//   GET  /tickets/my            -> usuario: tickets que él creó.
//   GET  /tickets/available     -> técnico: tickets disponibles para su(s) área(s).
//   POST /tickets/:id/accept    -> técnico: aceptar un ticket disponible.
//   GET  /tickets/accepted      -> técnico: tickets ya aceptados por él.
//   GET  /tickets/my-assigned   -> técnico: vista "Mis Tickets aceptados".
//   POST /tickets/:id/contributions -> técnico/admin: agregar aportación al ticket.
//   PUT  /tickets/:id/escalate  -> técnico/admin: escalamiento mejorado (workDone, targetArea).
//   POST /tickets/:id/resolve   -> técnico/admin: resolver con solución existente o nueva.
//
// El registro en `ticket_events` se hace dentro de la misma transacción de cada
// acción para garantizar trazabilidad atómica.

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, ResponsibleArea, EventVisibility, TicketStatus } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { recordTicketEvent } from "../services/historyService";
import { areasForRole, canHandleArea, isStaffRole } from "../services/areaService";
import {
  fetchKnowledgeById,
  createKnowledgeArticle,
  KnowledgeNotFoundError,
  KnowledgeServiceError,
} from "../services/knowledgeClient";
// HU-15: notificaciones por correo (best-effort, no rompen la acción del ticket).
import {
  notifyTicketAccepted,
  notifyTicketContribution,
  notifyTicketEscalated,
  notifyTicketResolved,
  dispatchInBackground,
} from "../services/emailOutboxService";

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
    assignmentStatus: "available",
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
  if (ticket.assignmentStatus !== "available") {
    return res.status(409).json({ error: "El ticket no está disponible para aceptación" });
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
  const allowedAreas = areasForRole(role);

  try {
    const { updated, outboxId } = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: {
          id: req.params.id,
          assignmentStatus: "available",
          assignedTechnicianId: null,
          status: { notIn: ["resuelto", "cerrado"] },
          responsibleArea: { in: allowedAreas },
        },
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
      // HU-15: outbox best-effort dentro de la transacción.
      const outboxId = await notifyTicketAccepted({
        client: tx,
        ticketId: u.id,
        to: ticket.userEmail,
        ctx: {
          number: u.number,
          userName: ticket.userName,
          serviceName: ticket.serviceName,
          status: u.status,
          technicianName: u.assignedTechnicianName,
          eventDate: u.acceptedAt,
        },
      });
      return { updated: u, outboxId };
    });
    // HU-15: dispatch FUERA de la transacción; no bloquea ni revierte.
    dispatchInBackground(outboxId);
    return res.json({ message: "Ticket aceptado correctamente", ticket: updated });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2025"
    ) {
      return res.status(409).json({ error: "El ticket ya no está disponible para aceptación" });
    }
    console.error("[accept] error:", err);
    return res.status(500).json({ error: "Error interno al aceptar el ticket" });
  }
});

// ---------------------------------------------------------------------------
// GET /tickets/accepted -> Tickets aceptados por el técnico autenticado.
// Por defecto excluye `resuelto` y `cerrado` (bandeja activa). Pasar
// `?includeResolved=true` para incluir también resueltos; `?includeClosed=true`
// para incluir cerrados.
// ---------------------------------------------------------------------------
router.get("/accepted", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res.status(403).json({ error: "Solo personal autorizado" });
  }
  const includeResolved = req.query.includeResolved === "true";
  const includeClosed = req.query.includeClosed === "true";
  const excludedStatuses: TicketStatus[] = [];
  if (!includeResolved) excludedStatuses.push("resuelto");
  if (!includeClosed) excludedStatuses.push("cerrado");

  // admin ve todos los asignados; tech_* ve los suyos.
  const base: Prisma.TicketWhereInput =
    role === "admin"
      ? { assignedTechnicianId: { not: null } }
      : { assignedTechnicianId: req.user!.userId };
  const where: Prisma.TicketWhereInput =
    excludedStatuses.length > 0 ? { ...base, status: { notIn: excludedStatuses } } : base;

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { acceptedAt: "desc" },
    include: { attachments: true },
  });
  return res.json({ tickets, total: tickets.length });
});

// ---------------------------------------------------------------------------
// GET /tickets/my-assigned -> Vista "Mis Tickets Activos" del técnico.
// Devuelve los tickets activos asignados al técnico del JWT.
//
//   - 401 sin JWT (lo aplica verifyJwt).
//   - 403 si el rol no es admin ni tech_*.
//   - Por defecto excluye `resuelto` y `cerrado` (panel de trabajo activo).
//     `?includeClosed=true` los incluye (compat con UI vieja).
//   - `?history=true` invierte el filtro: devuelve SOLO tickets resueltos o
//     cerrados donde `assignedTechnicianId = me` o `resolvedById = me`. Es la
//     fuente del "Historial del técnico".
//   - Admin puede pasar `?technicianId=<uuid>` para auditar a otro.
// ---------------------------------------------------------------------------
const myAssignedQuerySchema = z.object({
  includeClosed: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  history: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  technicianId: z.string().uuid().optional(),
});

router.get("/my-assigned", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res
      .status(403)
      .json({ error: "Solo personal autorizado puede consultar tickets asignados" });
  }

  const parsed = myAssignedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { includeClosed, history, technicianId } = parsed.data;

  // El técnico SIEMPRE ve los suyos (ignora technicianId del query).
  // El admin puede pedir los de otro técnico; sin parámetro ve los propios.
  const targetTechnicianId =
    role === "admin" ? technicianId ?? req.user!.userId : req.user!.userId;

  let where: Prisma.TicketWhereInput;
  if (history) {
    // Historial del técnico: resueltos o cerrados que aceptó o resolvió.
    where = {
      status: { in: ["resuelto", "cerrado"] },
      OR: [
        { assignedTechnicianId: targetTechnicianId },
        { resolvedById: targetTechnicianId },
      ],
    };
  } else {
    // Activos: asignados al técnico, sin resueltos ni cerrados (a menos que se pidan).
    const excluded: TicketStatus[] = ["resuelto"];
    if (!includeClosed) excluded.push("cerrado");
    where = {
      assignedTechnicianId: targetTechnicianId,
      status: { notIn: excluded },
    };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: history ? { resolvedAt: "desc" } : { acceptedAt: "desc" },
    include: { attachments: true },
  });

  return res.json({
    tickets,
    total: tickets.length,
    filters: {
      technicianId: targetTechnicianId,
      includeClosed: Boolean(includeClosed),
      history: Boolean(history),
    },
  });
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

  const effectiveVisibility = visibility ?? "public";
  await recordTicketEvent(prisma, {
    ticketId: req.params.id,
    action: "CONTRIBUTED",
    title: "Aportación del técnico",
    description,
    visibility: effectiveVisibility,
    performedBy: req.user!.userId,
    performedByName: req.user!.name,
  });

  // HU-15: solo aportaciones públicas notifican al solicitante.
  const contribOutbox = await notifyTicketContribution({
    client: prisma,
    ticketId: req.params.id,
    to: ticket.userEmail,
    visibility: effectiveVisibility,
    ctx: {
      number: ticket.number,
      userName: ticket.userName,
      serviceName: ticket.serviceName,
      contributionDescription: description,
      eventDate: new Date(),
    },
  });
  dispatchInBackground(contribOutbox);

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
    const { updated, outboxId } = await prisma.$transaction(async (tx) => {
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
      // HU-15: notificar al solicitante (motivo público).
      const outboxId = await notifyTicketEscalated({
        client: tx,
        ticketId: u.id,
        to: ticket.userEmail,
        ctx: {
          number: u.number,
          userName: ticket.userName,
          serviceName: ticket.serviceName,
          status: u.status,
          newArea,
          note: reason,
          eventDate: new Date(),
        },
      });
      return { updated: u, outboxId };
    });
    dispatchInBackground(outboxId);
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

// ---------------------------------------------------------------------------
// POST /tickets/:id/resolve -> Cierra el ticket y lo vincula a una solución
// de la base de conocimiento (existente o nueva).
//
//   body = { mode: "existingKnowledge", knowledgeArticleId, finalNote? }
//        | { mode: "newKnowledge", title, problemDescription, solution,
//                    keywords[>=1], serviceId?, finalNote? }
//
// Reglas:
//   - Solo el técnico asignado o admin.
//   - El ticket debe existir (404), estar aceptado/asignado (409 si no), y no
//     estar resuelto/cerrado (409).
//   - `existingKnowledge`: knowledgeArticleId obligatorio y debe existir en catalog.
//   - `newKnowledge`: crea artículo en catalog y usa su id como vínculo.
//   - Persiste `resolvedAt`, `resolvedById`, `resolvedByName`, `knowledgeArticleId`,
//     `resolutionSummary`, `status="resuelto"`, `assignmentStatus="accepted"`.
//   - Emite evento `RESOLVED` (visibility=public) con el id de la solución y
//     `workDone` con la solución aplicada, `description` con la nota final.
// ---------------------------------------------------------------------------
const existingKnowledgeSchema = z.object({
  mode: z.literal("existingKnowledge"),
  knowledgeArticleId: z
    .string()
    .uuid({ message: "knowledgeArticleId debe ser un UUID válido" }),
  finalNote: z.string().trim().max(1000).optional(),
});

const newKnowledgeSchema = z.object({
  mode: z.literal("newKnowledge"),
  title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres").max(200),
  problemDescription: z
    .string()
    .trim()
    .min(10, "La descripción del problema debe tener al menos 10 caracteres"),
  solution: z.string().trim().min(10, "La solución debe tener al menos 10 caracteres"),
  keywords: z
    .array(z.string().trim().min(1))
    .min(1, "Debes proporcionar al menos una palabra clave")
    .max(20),
  serviceId: z.string().uuid().optional(),
  finalNote: z.string().trim().max(1000).optional(),
});

const resolveSchema = z.discriminatedUnion("mode", [
  existingKnowledgeSchema,
  newKnowledgeSchema,
]);

router.post("/:id/resolve", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!isStaffRole(role)) {
    return res
      .status(403)
      .json({ error: "Solo personal autorizado puede resolver tickets" });
  }

  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const data = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

  // El técnico solo puede resolver tickets asignados a él. Admin puede cualquier
  // ticket que esté asignado (no permitimos resolver tickets sin técnico).
  if (role !== "admin" && ticket.assignedTechnicianId !== req.user!.userId) {
    return res
      .status(403)
      .json({ error: "Solo puedes resolver tickets asignados a ti" });
  }
  if (!ticket.assignedTechnicianId) {
    return res.status(409).json({
      error: "El ticket no está aceptado/asignado y no puede resolverse",
    });
  }
  if (ticket.status === TicketStatus.resuelto || ticket.status === TicketStatus.cerrado) {
    return res
      .status(409)
      .json({ error: `El ticket ya está ${ticket.status} y no puede resolverse de nuevo` });
  }

  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();

  // 1) Determinar knowledgeArticleId (existente o nuevo).
  let knowledgeArticleId: string;
  let knowledgeTitle: string;
  try {
    if (data.mode === "existingKnowledge") {
      const article = await fetchKnowledgeById(data.knowledgeArticleId, userToken);
      knowledgeArticleId = article.id;
      knowledgeTitle = article.title;
    } else {
      const article = await createKnowledgeArticle(
        {
          title: data.title,
          problemDescription: data.problemDescription,
          solution: data.solution,
          keywords: data.keywords,
          serviceId: data.serviceId ?? ticket.serviceId,
        },
        userToken
      );
      knowledgeArticleId = article.id;
      knowledgeTitle = article.title;
    }
  } catch (err) {
    if (err instanceof KnowledgeNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof KnowledgeServiceError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
      return res.status(status).json({
        error:
          status === 502
            ? "No se pudo contactar la base de conocimiento"
            : err.message,
      });
    }
    console.error("[resolve] knowledge client error:", err);
    return res
      .status(502)
      .json({ error: "No se pudo contactar la base de conocimiento" });
  }

  // 2) Actualizar el ticket y registrar evento en una transacción atómica.
  try {
    const { updated, outboxId } = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: {
          status: TicketStatus.resuelto,
          resolvedAt: new Date(),
          resolvedById: req.user!.userId,
          resolvedByName: req.user!.name,
          knowledgeArticleId,
          resolutionSummary: data.finalNote?.trim() || null,
        },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "RESOLVED",
        title: `Ticket resuelto con solución "${knowledgeTitle}"`,
        previousStatus: ticket.status,
        newStatus: TicketStatus.resuelto,
        reason:
          data.mode === "existingKnowledge"
            ? `Solución existente aplicada (${knowledgeArticleId})`
            : `Nueva solución registrada (${knowledgeArticleId})`,
        workDone: knowledgeTitle,
        description: data.finalNote?.trim() || null,
        visibility: EventVisibility.public,
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      // HU-15: notificar al solicitante. knowledgeTitle es público (viene de KB).
      const outboxId = await notifyTicketResolved({
        client: tx,
        ticketId: u.id,
        to: ticket.userEmail,
        ctx: {
          number: u.number,
          userName: ticket.userName,
          serviceName: ticket.serviceName,
          status: u.status,
          eventDate: u.resolvedAt,
          knowledgeTitle,
          note: u.resolutionSummary,
        },
      });
      return { updated: u, outboxId };
    });
    dispatchInBackground(outboxId);
    return res.json({
      message: "Ticket resuelto correctamente",
      ticket: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        resolvedAt: updated.resolvedAt,
        resolvedById: updated.resolvedById,
        resolvedByName: updated.resolvedByName,
        knowledgeArticleId: updated.knowledgeArticleId,
        resolutionSummary: updated.resolutionSummary,
      },
      knowledge: { id: knowledgeArticleId, title: knowledgeTitle, mode: data.mode },
    });
  } catch (err) {
    console.error("[resolve] error:", err);
    return res.status(500).json({ error: "Error interno al resolver el ticket" });
  }
});

export default router;
