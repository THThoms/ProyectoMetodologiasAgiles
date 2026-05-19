// HU-06 - Endpoints del motor de enrutamiento.
//
//   POST /routing/assign  -> Resuelve y aplica el nivel a un ticket existente.
//                            Solo admin y técnicos pueden invocarlo.
//
//   POST /routing/preview -> Devuelve el nivel que se asignaría a un ticket
//                            con un servicio + prioridad dados, sin persistir.
//
// La decisión vive en `routingService.resolveLevel()` (función pura), y la
// regla se obtiene del catalog-service por HTTP (red interna Docker).

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Level, Prisma, Priority } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { fetchService, ServiceNotFoundError } from "../services/catalogClient";
import {
  resolveLevel,
  NoRoutingRuleError,
  InvalidLevelError,
} from "../services/routingService";

const router = Router();

const STAFF_ROLES = new Set(["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"]);

function isStaff(role: string | undefined): boolean {
  return Boolean(role && STAFF_ROLES.has(role));
}

const priorityEnum = z.nativeEnum(Priority);

const assignSchema = z.object({
  ticketId: z.string().uuid({ message: "ticketId debe ser un UUID válido" }),
  priority: priorityEnum.optional(),
});

const previewSchema = z.object({
  serviceId: z.string().uuid({ message: "serviceId debe ser un UUID válido" }),
  priority: priorityEnum.optional(),
});

function bearerToken(req: Request): string {
  return (req.headers.authorization ?? "").slice("Bearer ".length).trim();
}

// ---------------------------------------------------------------------------
// POST /routing/assign
// Recibe { ticketId, priority? } y aplica la regla:
//   - Carga el ticket de la BD.
//   - Consulta catalog-service para obtener la RoutingRule.
//   - Llama resolveLevel() y actualiza levelAssigned (y priority si vino en el body).
// ---------------------------------------------------------------------------
router.post("/assign", verifyJwt, async (req: Request, res: Response) => {
  if (!isStaff(req.user?.role)) {
    return res
      .status(403)
      .json({ error: "Solo personal autorizado (admin o técnico) puede asignar tickets" });
  }

  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { ticketId, priority } = parsed.data;

  // 1. Ticket debe existir.
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  // 2. Servicio y regla deben existir.
  let serviceData;
  try {
    serviceData = await fetchService(ticket.serviceId, bearerToken(req));
  } catch (err) {
    if (err instanceof ServiceNotFoundError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[routing] error consultando catálogo:", err);
    return res.status(502).json({ error: "No se pudo consultar el catálogo de servicios" });
  }

  if (!serviceData.routingRule) {
    return res
      .status(400)
      .json({ error: `No existe regla de enrutamiento para el servicio ${serviceData.name}` });
  }

  // 3. Aplicar motor.
  const effectivePriority = priority ?? ticket.priority;
  let level: Level;
  try {
    level = resolveLevel(serviceData.routingRule, effectivePriority, ticket.serviceId);
  } catch (err) {
    if (err instanceof NoRoutingRuleError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InvalidLevelError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  // 4. Persistir.
  try {
    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        levelAssigned: level,
        ...(priority !== undefined ? { priority } : {}),
      },
    });
    return res.json({
      ticket: updated,
      routing: {
        levelAssigned: level,
        priority: effectivePriority,
        serviceId: ticket.serviceId,
        ruleApplied: serviceData.routingRule,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /routing/preview
// Calcula el nivel sin persistir. Útil para el frontend al crear el ticket
// (mostrar el nivel destino antes de enviar). Solo requiere autenticación.
// ---------------------------------------------------------------------------
router.post("/preview", verifyJwt, async (req: Request, res: Response) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { serviceId, priority } = parsed.data;

  let serviceData;
  try {
    serviceData = await fetchService(serviceId, bearerToken(req));
  } catch (err) {
    if (err instanceof ServiceNotFoundError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[routing] error consultando catálogo:", err);
    return res.status(502).json({ error: "No se pudo consultar el catálogo de servicios" });
  }

  if (!serviceData.routingRule) {
    return res
      .status(400)
      .json({ error: `No existe regla de enrutamiento para el servicio ${serviceData.name}` });
  }

  try {
    const level = resolveLevel(serviceData.routingRule, priority, serviceId);
    return res.json({
      level,
      serviceId,
      priority: priority ?? null,
      ruleApplied: serviceData.routingRule,
    });
  } catch (err) {
    if (err instanceof NoRoutingRuleError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InvalidLevelError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
