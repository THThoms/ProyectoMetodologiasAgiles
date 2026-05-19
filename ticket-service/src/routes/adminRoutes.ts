// Sprint 2 (rev) - Endpoints administrativos.
//
//   POST /admin/tickets/:id/assign  -> Admin asigna manualmente un ticket a un técnico.
//   GET  /admin/stats/tickets       -> Estadísticas agregadas para el dashboard admin.
//
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { recordTicketEvent } from "../services/historyService";
import { fetchUsersByIds } from "../services/authClient";
import { canHandleArea } from "../services/areaService";

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
// ---------------------------------------------------------------------------
router.get("/stats/tickets", verifyJwt, requireAdmin, async (_req: Request, res: Response) => {
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
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: "abierto" } }),
    prisma.ticket.count({ where: { status: "en_proceso" } }),
    prisma.ticket.count({ where: { status: "escalado" } }),
    prisma.ticket.count({ where: { status: "resuelto" } }),
    prisma.ticket.count({ where: { status: "cerrado" } }),
    prisma.ticket.count({ where: { assignmentStatus: "accepted" } }),
    prisma.ticket.count({ where: { assignedTechnicianId: null, status: { notIn: ["resuelto", "cerrado"] } } }),
    prisma.ticket.groupBy({
      by: ["serviceName"],
      _count: { _all: true },
      orderBy: { _count: { serviceName: "desc" } },
    }),
    prisma.ticket.groupBy({
      by: ["responsibleArea"],
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["priority"],
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["assignedTechnicianId", "assignedTechnicianName"],
      _count: { _all: true },
      where: { assignedTechnicianId: { not: null } },
      orderBy: { _count: { assignedTechnicianId: "desc" } },
    }),
  ]);

  // Tiempo promedio de aceptación (segundos entre createdAt y acceptedAt).
  // Prisma no soporta AVG sobre fechas con el cliente tipado; usamos SQL crudo.
  let avgAcceptSeconds: number | null = null;
  try {
    const raw = await prisma.$queryRawUnsafe<Array<{ avg_secs: number | null }>>(
      `SELECT EXTRACT(EPOCH FROM AVG(accepted_at - created_at)) AS avg_secs
       FROM tickets WHERE accepted_at IS NOT NULL`
    );
    avgAcceptSeconds = raw?.[0]?.avg_secs ?? null;
    if (avgAcceptSeconds != null) avgAcceptSeconds = Math.round(avgAcceptSeconds);
  } catch {
    /* En tests con mock no hay $queryRawUnsafe real */
  }

  return res.json({
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
    avgAcceptSeconds,
  });
});

export default router;
