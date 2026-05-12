import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./routes/authRoutes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth-service" });
  });

  app.use("/auth", authRoutes);

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
