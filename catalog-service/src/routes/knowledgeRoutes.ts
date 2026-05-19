// HU-10 - Endpoints de la base de conocimiento institucional.
//
//   GET /knowledge/search?q=<term>[&serviceId=<uuid>][&page=N][&limit=N]
//     - Solo admin o tech_n*.
//     - q obligatorio (>=2 chars trim).
//     - Busca case-insensitive en title / problemDescription / solution / keywords.
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

export default router;
