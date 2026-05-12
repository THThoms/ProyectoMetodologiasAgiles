import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { env } from "./config/env";

export function createApp() {
  const app = express();

  // helmet con CSP relajada para no romper redirects de Microsoft
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
    })
  );

  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api-gateway" });
  });

  // ---------------------------------------------------------------------------
  // Proxies. NO añadimos express.json() ANTES de los proxies para no consumir
  // el body (lo necesitan los servicios destino, especialmente multipart en /tickets).
  // ---------------------------------------------------------------------------

  // El proxy hacia /api/auth quita el prefijo /api porque el auth-service expone /auth/*
  const baseProxyOpts: Partial<Options> = {
    changeOrigin: true,
    logger: console,
    on: {
      proxyReq: (_proxyReq, req) => {
        // log estructurado para debugging cross-service
        console.log(`[proxy] ${req.method} ${req.url}`);
      },
      error: (err, _req, res) => {
        console.error("[proxy] error:", err.message);
        if ("status" in res) {
          (res as express.Response).status(502).json({
            error: "Servicio no disponible",
            detail: err.message,
          });
        }
      },
    },
  };

  app.use(
    "/api/auth",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.authServiceUrl,
      pathRewrite: { "^": "/auth" },
    })
  );

  app.use(
    "/api/catalog",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.catalogServiceUrl,
      pathRewrite: { "^/api/catalog": "" },
    })
  );

  app.use(
    "/api/tickets",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/tickets" },
    })
  );

  // 404 final
  app.use((_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada en el gateway" });
  });

  return app;
}
