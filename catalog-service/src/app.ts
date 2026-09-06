import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import serviceRoutes from "./routes/serviceRoutes";
import knowledgeRoutes from "./routes/knowledgeRoutes";
import locationRoutes from "./routes/locationRoutes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "catalog-service" });
  });

  app.use("/services", serviceRoutes);
  app.use("/knowledge", knowledgeRoutes);
  app.use("/locations", locationRoutes);

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
