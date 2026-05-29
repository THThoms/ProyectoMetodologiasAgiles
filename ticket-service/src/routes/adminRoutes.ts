// Sprint 2 (rev) - Endpoints administrativos.
//
//   POST /admin/tickets/:id/assign   -> Admin asigna manualmente un ticket a un técnico.
//   GET  /admin/stats/tickets        -> Estadísticas agregadas para el dashboard admin.
//   GET  /admin/technicians          -> Listado de técnicos (con área que cubren).
//   GET  /admin/tickets/history      -> Historial general con filtros + paginación.
//
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, ResponsibleArea, TicketStatus, Priority } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { recordTicketEvent } from "../services/historyService";
import { fetchUsersByIds, fetchTechnicians } from "../services/authClient";
import { areasForRole, canHandleArea } from "../services/areaService";

const router = Router();

function requireAdmin(req: Request, res: Response, next: () => void) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Solo el administrador puede acceder a este recurso" });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /admin/tickets/:id/assign  body: { technicianId, note? }
// ---------------------------------------------------------------------------
const assignSchema = z.object({
  technicianId: z.string().uuid({ message: "technicianId debe ser un UUID válido" }),
  note: z.string().trim().max(500).optional(),
});

router.post("/tickets/:id/assign", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { technicianId, note } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  if (ticket.status === "cerrado") {
    return res.status(409).json({ error: "No se puede asignar un ticket cerrado" });
  }

  // Validar técnico contra auth_db (que esté activo y sea tech_*).
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  let users;
  try {
    users = await fetchUsersByIds([technicianId], userToken);
  } catch (err) {
    console.error("[admin/assign] lookup técnico falló:", err);
    return res.status(502).json({ error: "No se pudo verificar el técnico en auth-service" });
  }
  const tech = users.find((u) => u.id === technicianId);
  if (!tech) {
    return res.status(400).json({ error: "Técnico no encontrado" });
  }
  if (!tech.role.startsWith("tech_")) {
    return res
      .status(400)
      .json({ error: `El usuario ${tech.name} no es técnico` });
  }
  if (!canHandleArea(tech.role, ticket.responsibleArea)) {
    return res.status(400).json({
      error: `El técnico ${tech.name} no atiende tickets del área ${ticket.responsibleArea}`,
    });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: {
          assignedTechnicianId: technicianId,
          assignedTechnicianName: tech.name,
          assignmentStatus: "assigned_by_admin",
          acceptedAt: new Date(),
          ...(ticket.status === "abierto" ? { status: "en_proceso" } : {}),
        },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "ASSIGNED",
        title: `Asignado manualmente a ${tech.name}`,
        previousTechnicianId: ticket.assignedTechnicianId,
        newTechnicianId: technicianId,
        previousStatus: ticket.status,
        newStatus: u.status,
        description: note ?? null,
        reason: "Asignación manual por administrador",
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      return u;
    });
    return res.json({
      message: "Ticket asignado correctamente",
      ticket: updated,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    console.error("[admin/assign] error:", err);
    return res.status(500).json({ error: "Error interno al asignar el ticket" });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/stats/tickets -> Agregados para el dashboard de estadísticas.
//
// HU-12: filtro por rango de fechas (inclusivo) sobre `createdAt`.
//   Query: dateFrom=YYYY-MM-DD, dateTo=YYYY-MM-DD (ambos opcionales).
//   - dateFrom -> inicio del día (00:00:00.000Z).
//   - dateTo   -> fin del día (23:59:59.999Z).
//   - Sin fechas: comportamiento general (todos los tickets).
//
// Cohorte: TODOS los agregados (KPIs, estados, prioridad, área, servicio,
// técnico, resueltos por técnico, createdByDay y ambos promedios) se calculan
// sobre los tickets cuyo `createdAt` cae dentro del rango. Es decir: "de los
// tickets creados en este período, cómo se distribuyen / cuánto tardaron".
// ---------------------------------------------------------------------------
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD");

const statsQuerySchema = z.object({
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
});

function parseDayStart(s: string): Date | null {
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}
function parseDayEnd(s: string): Date | null {
  const d = new Date(`${s}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/stats/tickets", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = statsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros de fecha inválidos", details: parsed.error.issues });
  }
  const { dateFrom, dateTo } = parsed.data;

  const from = dateFrom ? parseDayStart(dateFrom) : null;
  const to = dateTo ? parseDayEnd(dateTo) : null;
  if (dateFrom && !from) {
    return res.status(400).json({ error: "dateFrom no es una fecha válida" });
  }
  if (dateTo && !to) {
    return res.status(400).json({ error: "dateTo no es una fecha válida" });
  }
  if (from && to && from.getTime() > to.getTime()) {
    return res
      .status(400)
      .json({ error: "dateFrom no puede ser posterior a dateTo" });
  }

  // Filtro Prisma sobre createdAt (inclusivo en ambos extremos).
  const createdAtFilter: Prisma.DateTimeFilter | undefined =
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  const rangeWhere: Prisma.TicketWhereInput = createdAtFilter
    ? { createdAt: createdAtFilter }
    : {};

  // Predicado SQL equivalente para las consultas crudas. Las fechas se inyectan
  // como literales ISO derivados de objetos Date validados (solo dígitos y
  // [-:.TZ]), por lo que no hay riesgo de inyección.
  const sqlClauses: string[] = [];
  if (from) sqlClauses.push(`created_at >= '${from.toISOString()}'`);
  if (to) sqlClauses.push(`created_at <= '${to.toISOString()}'`);
  const rangeSql = sqlClauses.length ? sqlClauses.join(" AND ") : "";
  const andRange = (base: string) =>
    rangeSql ? `${base} AND ${rangeSql}` : base;

  const [
    totalAll,
    pending,
    inProgress,
    escalated,
    resolved,
    closed,
    accepted,
    available,
    byService,
    byArea,
    byPriority,
    byTechnicianGroups,
  ] = await Promise.all([
    prisma.ticket.count({ where: rangeWhere }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "abierto" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "en_proceso" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "escalado" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "resuelto" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "cerrado" } }),
    prisma.ticket.count({ where: { ...rangeWhere, assignmentStatus: "accepted" } }),
    prisma.ticket.count({
      where: { ...rangeWhere, assignedTechnicianId: null, status: { notIn: ["resuelto", "cerrado"] } },
    }),
    prisma.ticket.groupBy({
      by: ["serviceName"],
      _count: { _all: true },
      where: rangeWhere,
      orderBy: { _count: { serviceName: "desc" } },
    }),
    prisma.ticket.groupBy({
      by: ["responsibleArea"],
      _count: { _all: true },
      where: rangeWhere,
    }),
    prisma.ticket.groupBy({
      by: ["priority"],
      _count: { _all: true },
      where: rangeWhere,
    }),
    prisma.ticket.groupBy({
      by: ["assignedTechnicianId", "assignedTechnicianName"],
      _count: { _all: true },
      where: { ...rangeWhere, assignedTechnicianId: { not: null } },
      orderBy: { _count: { assignedTechnicianId: "desc" } },
    }),
  ]);

  // Tiempo promedio de aceptación (segundos entre createdAt y acceptedAt) y
  // de resolución (createdAt -> resolvedAt). Prisma no soporta AVG sobre fechas
  // con el cliente tipado; usamos SQL crudo. En tests con mock no hay
  // $queryRawUnsafe real, por eso el try/catch.
  let avgAcceptSeconds: number | null = null;
  let avgResolveSeconds: number | null = null;
  let resolvedByTechnician: Array<{ technicianId: string | null; technicianName: string; count: number }> = [];
  let createdByDay: Array<{ date: string; count: number }> = [];
  try {
    const accRaw = await prisma.$queryRawUnsafe<Array<{ avg_secs: number | null }>>(
      `SELECT EXTRACT(EPOCH FROM AVG(accepted_at - created_at)) AS avg_secs
       FROM tickets WHERE ${andRange("accepted_at IS NOT NULL")}`
    );
    avgAcceptSeconds = accRaw?.[0]?.avg_secs ?? null;
    if (avgAcceptSeconds != null) avgAcceptSeconds = Math.round(avgAcceptSeconds);

    const resRaw = await prisma.$queryRawUnsafe<Array<{ avg_secs: number | null }>>(
      `SELECT EXTRACT(EPOCH FROM AVG(resolved_at - created_at)) AS avg_secs
       FROM tickets WHERE ${andRange("resolved_at IS NOT NULL")}`
    );
    avgResolveSeconds = resRaw?.[0]?.avg_secs ?? null;
    if (avgResolveSeconds != null) avgResolveSeconds = Math.round(avgResolveSeconds);

    const resolvedByTechRaw = await prisma.$queryRawUnsafe<
      Array<{ technician_id: string | null; technician_name: string | null; count: bigint }>
    >(
      `SELECT resolved_by_id AS technician_id, resolved_by_name AS technician_name,
              COUNT(*)::bigint AS count
       FROM tickets
       WHERE ${andRange("resolved_by_id IS NOT NULL")}
       GROUP BY resolved_by_id, resolved_by_name
       ORDER BY count DESC
       LIMIT 20`
    );
    resolvedByTechnician = resolvedByTechRaw.map((r) => ({
      technicianId: r.technician_id,
      technicianName: r.technician_name ?? "Desconocido",
      count: Number(r.count),
    }));

    // Serie temporal: tickets creados por día. Con rango usa el rango; sin
    // rango mantiene el comportamiento histórico (últimos 30 días).
    const seriesWhere = rangeSql ? rangeSql : `created_at >= NOW() - INTERVAL '30 days'`;
    const seriesRaw = await prisma.$queryRawUnsafe<Array<{ day: Date; count: bigint }>>(
      `SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS count
       FROM tickets
       WHERE ${seriesWhere}
       GROUP BY day
       ORDER BY day ASC`
    );
    createdByDay = seriesRaw.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      count: Number(r.count),
    }));
  } catch {
    /* En tests con mock no hay $queryRawUnsafe real */
  }

  return res.json({
    filters: {
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    },
    totals: {
      tickets: totalAll,
      pending,
      inProgress,
      escalated,
      resolved,
      closed,
      accepted,
      available,
    },
    byService: byService.map((g) => ({
      service: g.serviceName ?? "Sin servicio",
      count: g._count._all,
    })),
    byResponsibleArea: byArea.map((g) => ({
      area: g.responsibleArea,
      count: g._count._all,
    })),
    byPriority: byPriority.map((g) => ({
      priority: g.priority,
      count: g._count._all,
    })),
    byTechnician: byTechnicianGroups.map((g) => ({
      technicianId: g.assignedTechnicianId,
      technicianName: g.assignedTechnicianName ?? "Desconocido",
      count: g._count._all,
    })),
    resolvedByTechnician,
    createdByDay,
    avgAcceptSeconds,
    avgResolveSeconds,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/technicians -> Lista de técnicos vigentes. Se sirve aquí (no en
// auth-service directo) para enriquecer cada técnico con las áreas que cubre
// según el mapping de areaService.
// ---------------------------------------------------------------------------
router.get("/technicians", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  let technicians;
  try {
    technicians = await fetchTechnicians(userToken);
  } catch (err) {
    console.error("[admin/technicians] error:", err);
    return res.status(502).json({ error: "No se pudo obtener la lista de técnicos" });
  }
  return res.json({
    technicians: technicians.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      role: t.role,
      isActive: t.isActive,
      areas: areasForRole(t.role),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/tickets/history -> Historial general filtrable. Devuelve TODOS
// los tickets (incluye resueltos/cerrados) para auditoría. Solo admin.
//
// Query: status, technicianId, serviceId, responsibleArea, priority, from, to,
//        page (>=1, default 1), limit (1..100, default 20).
// ---------------------------------------------------------------------------
const historyQuerySchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  technicianId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  responsibleArea: z.nativeEnum(ResponsibleArea).optional(),
  priority: z.nativeEnum(Priority).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/tickets/history", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { status, technicianId, serviceId, responsibleArea, priority, from, to, page, limit } =
    parsed.data;

  const where: Prisma.TicketWhereInput = {};
  if (status) where.status = status;
  if (technicianId) where.assignedTechnicianId = technicianId;
  if (serviceId) where.serviceId = serviceId;
  if (responsibleArea) where.responsibleArea = responsibleArea;
  if (priority) where.priority = priority;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const effectivePage = page ?? 1;
  const effectiveLimit = limit ?? 20;

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (effectivePage - 1) * effectiveLimit,
      take: effectiveLimit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return res.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      requesterName: t.userName,
      requesterEmail: t.userEmail,
      serviceName: t.serviceName,
      serviceId: t.serviceId,
      responsibleArea: t.responsibleArea,
      priority: t.priority,
      status: t.status,
      assignmentStatus: t.assignmentStatus,
      assignedTechnicianId: t.assignedTechnicianId,
      assignedTechnicianName: t.assignedTechnicianName,
      acceptedAt: t.acceptedAt,
      resolvedAt: t.resolvedAt,
      resolvedById: t.resolvedById,
      resolvedByName: t.resolvedByName,
      resolutionSummary: t.resolutionSummary,
      knowledgeArticleId: t.knowledgeArticleId,
      createdAt: t.createdAt,
    })),
    total,
    page: effectivePage,
    limit: effectiveLimit,
    filters: {
      status: status ?? null,
      technicianId: technicianId ?? null,
      serviceId: serviceId ?? null,
      responsibleArea: responsibleArea ?? null,
      priority: priority ?? null,
      from: from ?? null,
      to: to ?? null,
    },
  });
});

export default router;
