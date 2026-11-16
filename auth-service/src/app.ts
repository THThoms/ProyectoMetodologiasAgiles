import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { checkDatabase } from "./health/readiness";
import authRoutes from "./routes/authRoutes";
import { env } from "./config/env";
import { httpErrorHandler, wrapAsync } from "./utils/asyncRoutes";

export function createApp() {
  const app = express();

  // Fase R: req.ip = IP real del cliente para la limitación de intentos.
  // Saltos de proxy de confianza: gateway (1) + nginx del host (2) en el
  // servidor; en el laboratorio sin nginx basta 1. Nunca "true" (spoofing).
  app.set("trust proxy", env.trustProxyHops);

  // COOP off: el popup SSO necesita window.opener para postMessage al main window.
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );
  app.use(cors());
  // Los cuerpos de autenticación son pequeños: 32 kB basta y acota el abuso.
  app.use(express.json({ limit: "32kb" }));
  // El registro de accesos no guarda el código de autorización ni el `state`.
  morgan.token("safe-url", (req) =>
    ((req as express.Request).originalUrl ?? req.url ?? "").replace(
      /([?&](?:code|state|token|id_token|access_token|client_info|session_state|cc)=)[^&#\s]*/gi,
      "$1[REDACTADO]"
    )
  );
  app.use(
    morgan(
      ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    )
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth-service" });
  });

  // Fase T — readiness (lo usa el healthcheck de Docker): base de datos real.
  app.get("/health/ready", wrapAsync(async (_req, res) => {
    const db = await checkDatabase();
    res.status(db ? 200 : 503).json({
      status: db ? "ready" : "not_ready",
      service: "auth-service",
      checks: { database: db ? "ok" : "fail" },
    });
  }));

  app.use("/auth", authRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  app.use(httpErrorHandler);

  return app;
}
