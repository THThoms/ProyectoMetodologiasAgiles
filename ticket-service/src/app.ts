import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import ticketRoutes from "./routes/ticketRoutes";
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

  app.use("/tickets", ticketRoutes);

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
