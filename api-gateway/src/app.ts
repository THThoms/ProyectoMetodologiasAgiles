import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { env } from "./config/env";
import { checkUpstream } from "./health/readiness";
import { redactUrl } from "./logging/redact";

class CorsRejectedError extends Error {}

export function createApp() {
  const app = express();

  // helmet con CSP relajada para no romper redirects de Microsoft.
  // crossOriginOpenerPolicy se DESACTIVA porque el flujo SSO usa window.opener
  // (popup -> postMessage al main window). Con COOP=same-origin el browser
  // corta opener al cruzar a localhost:8080 y el popup nunca puede notificar.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  // Sprint 4+ · CORS multi-origen para soportar:
  //   · Web SPA          → https://servicedesk-uta.site (env.frontendUrl)
  //   · APK Capacitor    → https://localhost (androidScheme=https)
  //   · iOS/otros        → capacitor://localhost, ionic://localhost (compat)
  // La app Android carga bundle offline, por eso el WebView usa https://localhost
  // como origen cuando hace fetch al backend público — sin este allowlist el
  // browser bloquea las respuestas con "Network Error" en Axios.
  const allowedOrigins = new Set<string>([
    env.frontendUrl,
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost",
  ]);

  app.use(
    cors({
      origin: (origin, cb) => {
        // Requests sin Origin (curl, health checks, same-origin) → permitidas.
        if (!origin) return cb(null, true);
        if (allowedOrigins.has(origin)) return cb(null, true);
        return cb(new CorsRejectedError());
      },
      credentials: true,
    })
  );

  // Origen no permitido → 403 JSON (antes: error genérico de Express, con la
  // traza de pila fuera de producción).
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof CorsRejectedError) return res.status(403).json({ error: "Origen no permitido" });
    return next(err);
  });

  // Los registros nunca guardan el valor de `code`, `state` ni `token` de la URL.
  morgan.token("safe-url", (req) => redactUrl((req as express.Request).originalUrl ?? req.url ?? ""));
  app.use(
    morgan(
      ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    )
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api-gateway" });
  });

  // Fase T — readiness (healthcheck de Docker): los 3 servicios responden y
  // tienen su base de datos disponible.
  app.get("/health/ready", async (_req, res) => {
    const [auth, catalog, ticket] = await Promise.all([
      checkUpstream(env.authServiceUrl),
      checkUpstream(env.catalogServiceUrl),
      checkUpstream(env.ticketServiceUrl),
    ]);
    const ready = auth && catalog && ticket;
    const s = (b: boolean) => (b ? "ok" : "fail");
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: "api-gateway",
      checks: { "auth-service": s(auth), "catalog-service": s(catalog), "ticket-service": s(ticket) },
    });
  });

  // ---------------------------------------------------------------------------
  // Proxies. NO añadimos express.json() ANTES de los proxies para no consumir
  // el body (lo necesitan los servicios destino, especialmente multipart en /tickets).
  // ---------------------------------------------------------------------------

  // El proxy hacia /api/auth quita el prefijo /api porque el auth-service expone /auth/*
  const baseProxyOpts: Partial<Options> = {
    changeOrigin: true,
    // Fase R: añade X-Forwarded-For/Proto para que auth-service conozca la IP
    // real del cliente (limitación de intentos). auth-service solo confía en
    // TRUST_PROXY_HOPS saltos, así que una cabecera falsificada no se acepta.
    xfwd: true,
    logger: console,
    on: {
      proxyReq: (_proxyReq, req) => {
        // log estructurado para debugging cross-service
        console.log(`[proxy] ${req.method} ${redactUrl(req.url ?? "")}`);
      },
      // El gateway es la ÚNICA autoridad CORS. Los microservicios internos
      // responden con `Access-Control-Allow-Origin: *` (cors() por defecto) y el
      // proxy copiaba esas cabeceras encima de las del gateway: el navegador
      // veía "*" junto a "Allow-Credentials: true" y la lista de orígenes
      // permitidos no se aplicaba a las respuestas sin preflight.
      proxyRes: (proxyRes) => {
        for (const name of Object.keys(proxyRes.headers)) {
          if (name.toLowerCase().startsWith("access-control-")) delete proxyRes.headers[name];
        }
      },
      error: (err, _req, res) => {
        // El detalle (host y puerto internos) queda en el log, no en la respuesta.
        console.error("[proxy] error:", err.message);
        if ("status" in res) {
          (res as express.Response).status(502).json({ error: "Servicio no disponible" });
        }
      },
    },
  };

  // Rutas internas entre microservicios (/auth/internal/*): nunca se publican.
  app.use(["/api/auth/internal", "/auth/internal"], (_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada en el gateway" });
  });

  app.use(
    "/api/auth",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.authServiceUrl,
      pathRewrite: { "^": "/auth" },
    })
  );

  // Proxy directo /auth/* -> auth-service (necesario para que el redirect URI
  // registrado en Azure AD apunte a http://localhost:8080/auth/callback).
  app.use(
    "/auth",
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

  // HU-10: Base de conocimiento. Vive en catalog-service (mismo origen lógico
  // que los servicios) bajo el path /knowledge.
  app.use(
    "/api/knowledge",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.catalogServiceUrl,
      pathRewrite: { "^": "/knowledge" },
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

  // HU-06: Motor de enrutamiento. Vive en ticket-service.
  app.use(
    "/api/routing",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/routing" },
    })
  );

  // Sprint 2 (rev): endpoints administrativos (asignación manual, estadísticas).
  app.use(
    "/api/admin",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/admin" },
    })
  );

  // Sprint 4+ · Registro/baja de tokens FCM para la app Android.
  app.use(
    "/api/notifications",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/notifications" },
    })
  );

  // 404 final
  app.use((_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada en el gateway" });
  });

  return app;
}
