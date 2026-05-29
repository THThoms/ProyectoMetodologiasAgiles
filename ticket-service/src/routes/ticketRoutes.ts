import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { uploadAttachments } from "../middleware/upload";
import { fetchService, fetchAllServices, ServiceNotFoundError } from "../services/catalogClient";
import { fetchUsersByIds } from "../services/authClient";
import { generateTicketNumber } from "../services/ticketNumber";
import {
  resolveLevel,
  NoRoutingRuleError,
  InvalidLevelError,
} from "../services/routingService";
import { recordTicketEvent, describeEvent } from "../services/historyService";
import { EventAction, Level, Prisma, Priority, TicketStatus } from "@prisma/client";
import { env } from "../config/env";

// HU-08: tabla de escalamiento secuencial entre niveles técnicos.
// N4 es nivel final; no escala a otro nivel "normal".
const NEXT_LEVEL: Record<Level, Level | null> = {
  N1: "N2",
  N2: "N3",
  N3: "N4",
  N4: null,
};

// HU-08: estados terminales que bloquean el escalamiento.
const TERMINAL_STATUSES = new Set<TicketStatus>([
  TicketStatus.resuelto,
  TicketStatus.cerrado,
]);

// HU-07: alias "pendiente" -> abierto en BD. La UI muestra "Pendiente" pero
// el enum raíz sigue siendo `abierto` para no romper datos de HU-06.
const STATUS_ALIASES: Record<string, TicketStatus> = {
  pendiente: TicketStatus.abierto,
  abierto: TicketStatus.abierto,
  en_proceso: TicketStatus.en_proceso,
  escalado: TicketStatus.escalado,
  resuelto: TicketStatus.resuelto,
  cerrado: TicketStatus.cerrado,
};

const router = Router();

const createSchema = z.object({
  serviceId: z.string().uuid({ message: "serviceId debe ser un UUID válido" }),
  detail: z.string().min(5, "El detalle debe tener al menos 5 caracteres").max(5000),
  location: z.string().max(255).optional(),
  // HU-06: prioridad opcional. Default `media` (en BD), el motor sube el nivel
  // cuando es `alta` o `critica`. Compat: clientes viejos no envían el campo.
  priority: z.nativeEnum(Priority).optional(),
});

// ---------------------------------------------------------------------------
// Limpieza de archivos en disco si la transacción posterior falla.
// ---------------------------------------------------------------------------
function cleanupFiles(files: Express.Multer.File[]) {
  for (const f of files) {
    fs.unlink(f.path, () => undefined);
  }
}

// Captura errores de multer (tamaño, conteo, mime) y los traduce a HTTP 4xx claros.
function handleUploadErrors(req: Request, res: Response, next: NextFunction) {
  uploadAttachments.array("attachments", env.upload.maxFiles)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `Archivo demasiado grande. Máximo ${env.upload.maxFileSizeBytes / 1024 / 1024} MB por imagen.`,
        });
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          error: `Máximo ${env.upload.maxFiles} archivos por ticket.`,
        });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// POST /tickets -> Crear ticket (multipart/form-data)
// Campos: serviceId, detail, attachments[] (0..5 imágenes JPG/PNG hasta 5MB c/u)
// ---------------------------------------------------------------------------
router.post(
  "/",
  verifyJwt,
  handleUploadErrors,
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      cleanupFiles(files);
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
    }
    const { serviceId, detail, location, priority } = parsed.data;

    // Sprint 2 (rev): el flujo nuevo usa `responsibleArea`. El `levelAssigned`
    // sobrevive como columna NOT NULL del modelo legacy. Si el servicio trae
    // `routingRule`, calculamos el nivel como antes; si no, hacemos fallback
    // a `service.levelEntry` o, como último recurso, a `N1`. Esto evita que
    // un servicio nuevo creado sin regla legacy bloquee la creación.
    let level: Level;
    let serviceName: string;
    let responsibleArea: import("@prisma/client").ResponsibleArea = "GENERAL" as never;
    try {
      const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
      const service = await fetchService(serviceId, userToken);
      if (!service.isActive) {
        cleanupFiles(files);
        return res.status(400).json({ error: "El servicio seleccionado está deshabilitado" });
      }
      if (service.routingRule) {
        level = resolveLevel(service.routingRule, priority ?? null, serviceId);
      } else {
        const fallback = (service.levelEntry ?? "N1") as Level;
        console.warn(
          `[tickets] servicio ${serviceId} sin routingRule legacy; usando fallback ${fallback}`
        );
        level = fallback;
      }
      serviceName = service.name;
      responsibleArea = (service.responsibleArea ?? "GENERAL") as never;
    } catch (err) {
      cleanupFiles(files);
      if (err instanceof ServiceNotFoundError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof NoRoutingRuleError) {
        // Defensivo: resolveLevel también puede lanzar esto si la regla es null.
        // Con el fallback de arriba no debería pasar, pero por compat lo manejamos.
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof InvalidLevelError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Error consultando catalog-service:", err);
      return res.status(502).json({ error: "No se pudo validar el servicio en el catálogo" });
    }

    try {
      const number = await generateTicketNumber();
      // HU-09: la creación del ticket y el evento CREATED se hacen en una
      // sola transacción para garantizar trazabilidad atómica.
      const ticket = await prisma.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            number,
            userId: req.user!.userId,
            userName: req.user!.name,
            userEmail: req.user!.email,
            serviceId,
            serviceName,
            detail,
            location: location || null,
            levelAssigned: level,
            responsibleArea,
            assignmentStatus: "available",
            ...(priority !== undefined ? { priority } : {}),
            attachments: {
              create: files.map((f) => ({
                filePath: path.basename(f.path),
                fileSize: f.size,
                mimeType: f.mimetype,
              })),
            },
          },
          include: { attachments: true },
        });
        await recordTicketEvent(tx, {
          ticketId: created.id,
          action: "CREATED",
          title: "Ticket creado y disponible",
          newLevel: created.levelAssigned,
          newStatus: created.status,
          newArea: created.responsibleArea,
          performedBy: req.user!.userId,
          performedByName: req.user!.name,
        });
        return created;
      });
      return res.status(201).json({ ticket });
    } catch (err) {
      cleanupFiles(files);
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        return res.status(400).json({ error: "No se pudo crear el ticket", code: err.code });
      }
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// Mapea rol de técnico al nivel de ticket que le corresponde.
// tech_n1 -> N1, tech_n2 -> N2, tech_n3 -> N3, tech_n4 -> N4
// ---------------------------------------------------------------------------
function techRoleToLevel(role: string): Level | null {
  const map: Record<string, Level> = {
    tech_n1: "N1",
    tech_n2: "N2",
    tech_n3: "N3",
    tech_n4: "N4",
  };
  return map[role] ?? null;
}

// ---------------------------------------------------------------------------
// GET /tickets -> Tickets según rol:
//   - admin           -> TODOS los tickets
//   - tech_n*         -> solo tickets de su nivel (tech_n1 ve N1, etc.)
//   - user            -> solo sus propios tickets
// ---------------------------------------------------------------------------
router.get("/", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;

  let where: Prisma.TicketWhereInput = {};

  if (role === "admin") {
    // Admin ve todo
    where = {};
  } else if (role.startsWith("tech_")) {
    // Técnico ve solo tickets de su nivel
    const level = techRoleToLevel(role);
    if (level) {
      where = { levelAssigned: level };
    }
  } else {
    // Usuario normal ve solo sus propios tickets
    where = { userId: req.user!.userId };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { attachments: true },
  });
  res.json({ tickets });
});

// ---------------------------------------------------------------------------
// HU-08 - PUT /tickets/escalate
// Escala un ticket al siguiente nivel técnico de forma manual.
//   Body: { ticketId: UUID, reason: string (>=5 chars no whitespace) }
// Reglas:
//   - Solo admin o tech_* pueden escalar.
//   - tech_n* solo escala tickets de su propio nivel (admin puede cualquier nivel).
//   - reason es obligatorio y debe tener texto real (no solo espacios).
//   - No se puede escalar tickets en estado resuelto/cerrado (409).
//   - No se puede escalar tickets en N4 (400).
//   - El motor de routing automático (HU-06) NO se invoca: escalamiento es manual.
//   - Se registra un evento TicketEvent.ESCALATED dentro de la misma transacción.
// ---------------------------------------------------------------------------
const escalateSchema = z.object({
  ticketId: z.string().uuid({ message: "ticketId debe ser un UUID válido" }),
  reason: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 5, {
      message: "El motivo del escalamiento debe tener al menos 5 caracteres",
    }),
});

router.put("/escalate", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  const isAdmin = role === "admin";
  const isTech = role.startsWith("tech_");

  if (!isAdmin && !isTech) {
    return res.status(403).json({
      error: "Solo personal técnico o administrador puede escalar tickets",
    });
  }

  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { ticketId, reason } = parsed.data;

  // Cargar ticket fuera de la transacción para devolver 404 limpio.
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  // Técnico solo puede escalar tickets de su propio nivel.
  if (!isAdmin) {
    const myLevel = techRoleToLevel(role);
    if (!myLevel || ticket.levelAssigned !== myLevel) {
      return res.status(403).json({
        error: "Solo puedes escalar tickets asignados a tu propio nivel",
      });
    }
  }

  // No escalar tickets ya resueltos o cerrados.
  if (TERMINAL_STATUSES.has(ticket.status)) {
    return res.status(409).json({
      error: `El ticket está en estado ${ticket.status} y no puede escalarse`,
    });
  }

  // N4 es el nivel final.
  const nextLevel = NEXT_LEVEL[ticket.levelAssigned];
  if (!nextLevel) {
    return res.status(400).json({
      error: "El ticket está en N4: no existe un nivel técnico superior al cual escalar",
    });
  }

  // Transacción: actualizar ticket + crear evento. Si una falla, rollback.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          levelAssigned: nextLevel,
          status: TicketStatus.escalado,
        },
      });
      await recordTicketEvent(tx, {
        ticketId,
        action: EventAction.ESCALATED,
        previousLevel: ticket.levelAssigned,
        newLevel: nextLevel,
        previousStatus: ticket.status,
        newStatus: TicketStatus.escalado,
        reason,
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      return updated;
    });

    return res.json({
      message: "Ticket escalado correctamente",
      ticket: {
        id: result.id,
        number: result.number,
        previousLevel: ticket.levelAssigned,
        newLevel: nextLevel,
        status: result.status,
        reason,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    console.error("[escalate] error:", err);
    return res.status(500).json({ error: "Error interno al escalar el ticket" });
  }
});

// ---------------------------------------------------------------------------
// HU-07 - GET /tickets/level
// Panel técnico filtrado por el nivel del técnico autenticado.
//   - tech_n*: nivel deducido del rol. NO acepta `level` por query.
//   - admin:   ve todos los niveles; puede opcionalmente filtrar por `level=N1..N4`.
//   - otros:   403.
//
// Filtros opcionales (query string):
//   status   : abierto|pendiente|en_proceso|escalado|resuelto|cerrado
//   priority : baja|media|alta|critica
//   search   : busca en `number` y `detail` (contains, case-insensitive)
//   page     : >=1   (default 1)
//   limit    : 1..100 (default 20)
//
// Respuesta: { tickets, total, filters: { level, status, priority, search, page, limit } }
// ---------------------------------------------------------------------------
const levelLiteralEnum = z.enum(["N1", "N2", "N3", "N4"]);
const priorityLiteralEnum = z.nativeEnum(Priority);

const levelQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : v))
    .refine((v) => v === undefined || v in STATUS_ALIASES, {
      message: "status inválido. Use abierto|pendiente|en_proceso|escalado|resuelto|cerrado",
    }),
  priority: priorityLiteralEnum.optional(),
  level: levelLiteralEnum.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/level", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  const isAdmin = role === "admin";
  const isTech = role.startsWith("tech_");

  if (!isAdmin && !isTech) {
    return res.status(403).json({
      error: "Solo personal técnico o administrador puede acceder al panel técnico",
    });
  }

  const parsed = levelQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { status, priority, search, page, limit, level: levelQuery } = parsed.data;

  // Determinar el nivel a filtrar. La regla de negocio dice que el técnico
  // NUNCA puede ver tickets de otro nivel: si manda `level`, lo ignoramos.
  let level: Level | null = null;
  if (isAdmin) {
    level = levelQuery ?? null; // admin sin filtro -> todos los niveles
  } else {
    level = techRoleToLevel(role);
    if (!level) {
      return res.status(403).json({ error: "Rol técnico no reconocido" });
    }
  }

  const where: Prisma.TicketWhereInput = {};
  if (level) where.levelAssigned = level;
  if (status) where.status = STATUS_ALIASES[status];
  if (priority) where.priority = priority;
  if (search) {
    where.OR = [
      { number: { contains: search, mode: "insensitive" } },
      { detail: { contains: search, mode: "insensitive" } },
    ];
  }

  const effectivePage = page ?? 1;
  const effectiveLimit = limit ?? 20;
  const skip = (effectivePage - 1) * effectiveLimit;

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { attachments: true },
      skip,
      take: effectiveLimit,
    }),
    prisma.ticket.count({ where }),
  ]);

  // HU-07 - Enriquecimiento: resolver nombre del solicitante (auth-service)
  // y nombre del servicio (catalog-service) para que el panel técnico no
  // muestre IDs crudos. Hacemos las dos llamadas en paralelo; si alguna falla,
  // dejamos los campos en null y el frontend cae al fallback visual.
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  const userIds = [...new Set(tickets.map((t) => t.userId))];
  const serviceIds = new Set(tickets.map((t) => t.serviceId));

  const [usersResult, servicesResult] = await Promise.allSettled([
    userIds.length > 0 ? fetchUsersByIds(userIds, userToken) : Promise.resolve([]),
    serviceIds.size > 0 ? fetchAllServices(userToken) : Promise.resolve([]),
  ]);

  const userMap = new Map<string, { name: string; email: string }>();
  if (usersResult.status === "fulfilled") {
    for (const u of usersResult.value) {
      userMap.set(u.id, { name: u.name, email: u.email });
    }
  } else {
    console.warn("[tickets/level] lookup usuarios falló:", usersResult.reason);
  }

  const serviceMap = new Map<string, string>();
  if (servicesResult.status === "fulfilled") {
    for (const s of servicesResult.value) {
      serviceMap.set(s.id, s.name);
    }
  } else {
    console.warn("[tickets/level] lookup servicios falló:", servicesResult.reason);
  }

  const enrichedTickets = tickets.map((t) => ({
    ...t,
    userName: userMap.get(t.userId)?.name ?? null,
    userEmail: userMap.get(t.userId)?.email ?? null,
    serviceName: serviceMap.get(t.serviceId) ?? null,
  }));

  return res.json({
    tickets: enrichedTickets,
    total,
    filters: {
      level: level ?? "todos",
      status: status ?? null,
      priority: priority ?? null,
      search: search ?? null,
      page: effectivePage,
      limit: effectiveLimit,
    },
  });
});

// ---------------------------------------------------------------------------
// HU-09 - PATCH /tickets/:id/status
// Cambio mínimo de estado de un ticket. Registra evento STATUS_CHANGED en
// la bitácora.
//   Body: { status, comment? }
//   Permisos:
//     - admin: cualquier ticket.
//     - tech_n*: solo tickets de su propio nivel.
//     - user: rechazado (403). Los usuarios normales no cambian estados.
//   Reglas:
//     - status debe ser distinto del actual.
//     - comment opcional, si viene debe tener al menos 3 chars trim.
// ---------------------------------------------------------------------------
const statusChangeSchema = z.object({
  status: z.nativeEnum(TicketStatus),
  comment: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || s.length >= 3, {
      message: "El comentario debe tener al menos 3 caracteres",
    })
    .optional(),
});

router.patch("/:id/status", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  const isAdmin = role === "admin";
  const isTech = role.startsWith("tech_");

  if (!isAdmin && !isTech) {
    return res
      .status(403)
      .json({ error: "Solo personal técnico o administrador puede cambiar el estado del ticket" });
  }

  const parsed = statusChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { status, comment } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  if (!isAdmin) {
    const myLevel = techRoleToLevel(role);
    if (!myLevel || ticket.levelAssigned !== myLevel) {
      return res
        .status(403)
        .json({ error: "Solo puedes cambiar el estado de tickets asignados a tu propio nivel" });
    }
  }

  if (status === ticket.status) {
    return res
      .status(400)
      .json({ error: `El ticket ya está en estado ${ticket.status}` });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: { status },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "STATUS_CHANGED",
        previousStatus: ticket.status,
        newStatus: status,
        reason: comment && comment.length > 0 ? comment : null,
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      return u;
    });

    return res.json({
      message: "Estado actualizado correctamente",
      ticket: {
        id: updated.id,
        number: updated.number,
        previousStatus: ticket.status,
        newStatus: updated.status,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    console.error("[status] error:", err);
    return res.status(500).json({ error: "Error interno al cambiar el estado" });
  }
});

// ---------------------------------------------------------------------------
// HU-09 - GET /tickets/history/:id
// Devuelve la bitácora completa del ticket en orden cronológico ascendente.
// Cada evento incluye una descripción computada legible.
//
// Permisos:
//   - admin: cualquier ticket.
//   - tech_n*: cualquier ticket (la trazabilidad debe sobrevivir al
//     escalamiento; restringir por nivel actual ocultaría historial real).
//   - user: solo el historial de los tickets que él mismo reportó.
// ---------------------------------------------------------------------------
router.get("/history/:id", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user!.role;
  const isAdmin = role === "admin";
  const isTech = role.startsWith("tech_");

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  if (!isAdmin && !isTech && ticket.userId !== req.user!.userId) {
    return res
      .status(403)
      .json({ error: "No tienes permisos para ver el historial de este ticket" });
  }

  // El solicitante nunca debe ver eventos `internal` (defensa en backend,
  // independiente del filtro adicional que aplique el frontend).
  const isRequesterOnly = !isAdmin && !isTech && ticket.userId === req.user!.userId;

  const events = await prisma.ticketEvent.findMany({
    where: {
      ticketId: req.params.id,
      ...(isRequesterOnly ? { visibility: "public" } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return res.json({
    ticketId: ticket.id,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      serviceId: ticket.serviceId,
      serviceName: ticket.serviceName,
      userName: ticket.userName,
      responsibleArea: ticket.responsibleArea,
      status: ticket.status,
      priority: ticket.priority,
      assignmentStatus: ticket.assignmentStatus,
      assignedTechnicianName: ticket.assignedTechnicianName,
      acceptedAt: ticket.acceptedAt,
      resolvedAt: ticket.resolvedAt,
      resolvedByName: ticket.resolvedByName,
      resolutionSummary: ticket.resolutionSummary,
      levelAssigned: ticket.levelAssigned,
      createdAt: ticket.createdAt,
    },
    history: events.map((e) => ({
      id: e.id,
      actionType: e.action,
      description: describeEvent(e),
      previousStatus: e.previousStatus,
      newStatus: e.newStatus,
      previousLevel: e.previousLevel,
      newLevel: e.newLevel,
      previousArea: e.previousArea,
      newArea: e.newArea,
      reason: e.reason,
      workDone: e.workDone,
      eventDescription: e.description,
      visibility: e.visibility,
      performedBy: { id: e.performedBy, name: e.performedByName },
      createdAt: e.createdAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/:id -> Detalle. Solo el dueño o un admin/tech puede verlo.
// ---------------------------------------------------------------------------
router.get("/:id", verifyJwt, async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { attachments: true },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

  const role = req.user!.role;
  const isStaff = role === "admin" || role.startsWith("tech_");
  if (ticket.userId !== req.user!.userId && !isStaff) {
    return res.status(403).json({ error: "No tienes permisos para ver este ticket" });
  }
  res.json({ ticket });
});

export default router;
