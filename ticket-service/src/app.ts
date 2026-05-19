import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import ticketRoutes from "./routes/ticketRoutes";
import routingRoutes from "./routes/routingRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";
import adminRoutes from "./routes/adminRoutes";
import { env } from "./config/env";
import { verifyJwt } from "./middleware/verifyJwt";

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

  // Sprint 2 (rev): los routers específicos (my/available/accept/accepted/escalate v2)
  // se montan ANTES del router genérico de tickets para que sus paths tengan
  // prioridad sobre `/:id`.
  app.use("/tickets", assignmentRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/routing", routingRoutes);
  app.use("/admin", adminRoutes);

  // Servir archivos adjuntos. Requiere JWT para no exponer imágenes públicamente.
  app.use(
    "/uploads",
    verifyJwt,
    express.static(path.resolve(env.uploadDir), {
      fallthrough: false,
      maxAge: "1h",
    })
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  );

  return app;
}
