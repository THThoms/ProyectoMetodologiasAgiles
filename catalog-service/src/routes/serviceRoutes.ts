import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { Level, Prisma } from "@prisma/client";
import { verifyJwt, requireRole } from "../middleware/verifyJwt";

const router = Router();

const levelEnum = z.nativeEnum(Level);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  levelEntry: levelEnum,
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  levelEntry: levelEnum.optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// GET /services -> Lista pública (combobox del formulario de tickets).
// Solo devuelve servicios activos a no ser que ?includeInactive=true (admin).
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  const where: Prisma.ServiceWhereInput = includeInactive ? {} : { isActive: true };
  const services = await prisma.service.findMany({
    where,
    orderBy: { name: "asc" },
    include: { routingRule: true },
  });
  res.json({ services });
});

// ---------------------------------------------------------------------------
// GET /services/:id -> Detalle. Usado por ticket-service para obtener level_entry.
// ---------------------------------------------------------------------------
router.get("/:id", async (req: Request, res: Response) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: { routingRule: true },
  });
  if (!service) return res.status(404).json({ error: "Servicio no encontrado" });
  res.json({ service });
});

// ---------------------------------------------------------------------------
// POST /services -> Solo admin
// ---------------------------------------------------------------------------
router.post("/", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  try {
    const service = await prisma.service.create({
      data: {
        ...parsed.data,
        routingRule: { create: { levelEntry: parsed.data.levelEntry } },
      },
      include: { routingRule: true },
    });
    res.status(201).json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un servicio con ese nombre" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PATCH /services/:id -> Solo admin
// ---------------------------------------------------------------------------
router.patch("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  try {
    const data: Prisma.ServiceUpdateInput = { ...parsed.data };
    if (parsed.data.levelEntry) {
      data.routingRule = { update: { levelEntry: parsed.data.levelEntry } };
    }
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data,
      include: { routingRule: true },
    });
    res.json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// DELETE /services/:id -> Soft delete (is_active = false). Solo admin.
// ---------------------------------------------------------------------------
router.delete("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    throw err;
  }
});

export default router;
