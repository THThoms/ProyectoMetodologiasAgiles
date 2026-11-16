import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { checkDatabase, checkUploadsWritable } from "./health/readiness";
import ticketRoutes from "./routes/ticketRoutes";
import routingRoutes from "./routes/routingRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";
import adminRoutes from "./routes/adminRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import { env } from "./config/env";
import { httpErrorHandler, wrapAsync } from "./utils/asyncRoutes";

export function createApp() {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }, // permite servir imágenes al frontend
    })
  );
  app.use(cors());
  app.use(express.json());
  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ticket-service" });
  });

  // Fase T — readiness (lo usa el healthcheck de Docker): base de datos real y
  // volumen de imágenes escribible.
  app.get("/health/ready", wrapAsync(async (_req, res) => {
    const [db, uploads] = await Promise.all([checkDatabase(), checkUploadsWritable(env.uploadDir)]);
    const ready = db && uploads;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: "ticket-service",
      checks: { database: db ? "ok" : "fail", uploads: uploads ? "ok" : "fail" },
    });
  }));

  // Sprint 2 (rev): los routers específicos (my/available/accept/accepted/escalate v2)
  // se montan ANTES del router genérico de tickets para que sus paths tengan
  // prioridad sobre `/:id`.
  app.use("/tickets", assignmentRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/routing", routingRoutes);
  app.use("/admin", adminRoutes);
  app.use("/notifications", notificationRoutes);

  // /uploads NO se sirve como carpeta estática. Bastaba un JWT de CUALQUIER
  // usuario y el nombre del archivo para leer la imagen de un ticket ajeno, sin
  // comprobar el acceso al ticket. Las imágenes solo salen por
  // GET /tickets/:id/attachments/:attachmentId, que aplica ticketAccess.

  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  app.use(httpErrorHandler);

  return app;
}
