import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { uploadAttachments } from "../middleware/upload";
import { fetchService, ServiceNotFoundError } from "../services/catalogClient";
import { generateTicketNumber } from "../services/ticketNumber";
import { Level, Prisma } from "@prisma/client";
import { env } from "../config/env";

const router = Router();

const createSchema = z.object({
  serviceId: z.string().uuid({ message: "serviceId debe ser un UUID válido" }),
  detail: z.string().min(5, "El detalle debe tener al menos 5 caracteres").max(5000),
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
    const { serviceId, detail } = parsed.data;

    // Obtener nivel del catálogo. El JWT del usuario se reenvía para que el
    // catalog-service pueda autorizar (aunque GET /services/:id es público).
    let level: Level;
    try {
      const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
      const service = await fetchService(serviceId, userToken);
      if (!service.isActive) {
        cleanupFiles(files);
        return res.status(400).json({ error: "El servicio seleccionado está deshabilitado" });
      }
      level = service.levelEntry as Level;
    } catch (err) {
      cleanupFiles(files);
      if (err instanceof ServiceNotFoundError) {
        return res.status(400).json({ error: err.message });
      }
      // axios error 404 del catálogo
      if (typeof err === "object" && err && "response" in err) {
        const ax = err as { response?: { status?: number } };
        if (ax.response?.status === 404) {
          return res.status(400).json({ error: "Servicio no encontrado en el catálogo" });
        }
      }
      console.error("Error consultando catalog-service:", err);
      return res.status(502).json({ error: "No se pudo validar el servicio en el catálogo" });
    }

    try {
      const number = await generateTicketNumber();
      const ticket = await prisma.ticket.create({
        data: {
          number,
          userId: req.user!.userId,
          serviceId,
          detail,
          levelAssigned: level,
          attachments: {
            create: files.map((f) => ({
              filePath: path.basename(f.path), // guardamos solo el nombre, no la ruta absoluta
              fileSize: f.size,
              mimeType: f.mimetype,
            })),
          },
        },
        include: { attachments: true },
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
// GET /tickets -> Tickets del usuario autenticado (orden desc por fecha)
// ---------------------------------------------------------------------------
router.get("/", verifyJwt, async (req: Request, res: Response) => {
  const tickets = await prisma.ticket.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    include: { attachments: true },
  });
  res.json({ tickets });
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
