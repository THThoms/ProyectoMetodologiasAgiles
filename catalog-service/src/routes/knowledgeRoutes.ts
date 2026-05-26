// HU-10 - Endpoints de la base de conocimiento institucional.
//
//   GET  /knowledge/search?q=<term>[&serviceId=<uuid>][&page=N][&limit=N]
//   GET  /knowledge/:id        -> Detalle. Usado por ticket-service para validar
//                                 que `knowledgeArticleId` existe al resolver.
//   POST /knowledge            -> Crear artículo (admin/tech_*). Permite que el
//                                 técnico registre una solución nueva al cerrar
//                                 un ticket (Sprint 2 rev).
//
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt, requireRole } from "../middleware/verifyJwt";

const router = Router();

const STAFF_ROLES = ["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"] as const;

const searchQuerySchema = z.object({
  q: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, {
      message: "La búsqueda debe tener al menos 2 caracteres",
    }),
  serviceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get(
  "/search",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Búsqueda inválida", details: parsed.error.issues });
    }
    const { q, serviceId, page, limit } = parsed.data;
    const effectivePage = page ?? 1;
    const effectiveLimit = limit ?? 20;
    const skip = (effectivePage - 1) * effectiveLimit;

    // Construcción del filtro. Buscamos `q` (case-insensitive) en los textos
    // principales y en el array `keywords` (almacenado en lowercase).
    const lower = q.toLowerCase();
    const textConditions: Prisma.KnowledgeArticleWhereInput[] = [
      { title:              { contains: q, mode: "insensitive" } },
      { problemDescription: { contains: q, mode: "insensitive" } },
      { solution:           { contains: q, mode: "insensitive" } },
      { keywords:           { hasSome: [lower] } },
      // También intentamos matchear contra el nombre del servicio relacionado
      { service: { name: { contains: q, mode: "insensitive" } } },
    ];

    const where: Prisma.KnowledgeArticleWhereInput = {
      isActive: true,
      AND: [{ OR: textConditions }],
    };
    if (serviceId) {
      // AND adicional para limitar a un servicio
      (where.AND as Prisma.KnowledgeArticleWhereInput[]).push({ serviceId });
    }

    const [results, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { service: { select: { id: true, name: true } } },
        skip,
        take: effectiveLimit,
      }),
      prisma.knowledgeArticle.count({ where }),
    ]);

    return res.json({
      query: q,
      total,
      page: effectivePage,
      limit: effectiveLimit,
      results: results.map((a) => ({
        id: a.id,
        title: a.title,
        problemDescription: a.problemDescription,
        solution: a.solution,
        keywords: a.keywords,
        service: a.service ? { id: a.service.id, name: a.service.name } : null,
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
      })),
    });
  }
);

// ---------------------------------------------------------------------------
// GET /knowledge/:id  -> Detalle de un artículo.
// Sprint 2 (rev): ticket-service lo consume para verificar que la solución que
// referencia un ticket resuelto existe realmente en catalog_db.
// ---------------------------------------------------------------------------
const uuidParam = z.string().uuid({ message: "id debe ser un UUID válido" });

router.get(
  "/:id",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsedId = uuidParam.safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ error: "id inválido" });
    }
    const article = await prisma.knowledgeArticle.findUnique({
      where: { id: parsedId.data },
      include: { service: { select: { id: true, name: true } } },
    });
    if (!article || !article.isActive) {
      return res.status(404).json({ error: "Artículo no encontrado" });
    }
    return res.json({
      article: {
        id: article.id,
        title: article.title,
        problemDescription: article.problemDescription,
        solution: article.solution,
        keywords: article.keywords,
        service: article.service ? { id: article.service.id, name: article.service.name } : null,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  }
);

// ---------------------------------------------------------------------------
// POST /knowledge  -> Crear artículo de la base de conocimiento.
// Sprint 2 (rev): habilitado para admin y técnicos. Lo usa el flujo de
// resolución de ticket cuando el técnico elige "Crear nueva solución".
//   body: { title, problemDescription, solution, keywords[>=1], serviceId? }
// ---------------------------------------------------------------------------
const createSchema = z.object({
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
});

router.post(
  "/",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Datos inválidos", details: parsed.error.issues });
    }
    const { title, problemDescription, solution, keywords, serviceId } = parsed.data;

    // Si viene serviceId, validar que exista (FK física dentro de catalog_db).
    if (serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) {
        return res.status(400).json({ error: "El servicio referenciado no existe" });
      }
    }

    const article = await prisma.knowledgeArticle.create({
      data: {
        title,
        problemDescription,
        solution,
        keywords: keywords.map((k) => k.toLowerCase()),
        serviceId: serviceId ?? null,
        createdByUserId: req.user!.userId,
      },
      include: { service: { select: { id: true, name: true } } },
    });

    return res.status(201).json({
      article: {
        id: article.id,
        title: article.title,
        problemDescription: article.problemDescription,
        solution: article.solution,
        keywords: article.keywords,
        service: article.service ? { id: article.service.id, name: article.service.name } : null,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  }
);

export default router;
