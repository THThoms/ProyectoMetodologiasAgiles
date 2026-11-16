// =============================================================================
// Errores asíncronos en rutas Express 4.
//
// Express 4 NO captura las promesas rechazadas de un handler `async`. Si una
// consulta falla fuera de un try/catch (base de datos caída, un id que no es un
// GUID válido para SQL Server, etc.), el rechazo queda sin manejar y Node
// termina el proceso: una sola petición tumbaba el servicio entero.
//
//   asyncSafe(Router())  → todo handler registrado en ese router entrega sus
//                          errores (síncronos o asíncronos) a next(err), que
//                          llega al middleware de error de app.ts (HTTP 500).
//   wrapAsync(handler)   → lo mismo para un handler suelto (rutas de app.ts).
//   requireUuidParams()  → rechaza con 400 un parámetro de ruta que no es UUID
//                          antes de llegar a la base de datos.
//   installProcessSafetyNet() → última barrera: registra el rechazo y mantiene
//                          vivo el proceso.
//
// Este archivo es idéntico en auth-service, catalog-service y ticket-service.
// =============================================================================
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function wrapAsync(handler: RequestHandler): RequestHandler {
  return function asyncSafeHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const result = handler(req, res, next) as unknown;
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((err) => next(err ?? new Error("Promesa rechazada sin motivo")));
      }
    } catch (err) {
      next(err);
    }
  };
}

const METHODS = ["get", "post", "put", "patch", "delete", "all", "use"] as const;

/** Devuelve el mismo router con sus métodos de registro protegidos. */
export function asyncSafe<T extends Router>(router: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = router as any;
  for (const method of METHODS) {
    const original = target[method].bind(router);
    target[method] = (...args: unknown[]) =>
      original(
        ...args.map((arg) =>
          // Los middlewares de error (4 argumentos) y los sub-routers no se tocan.
          typeof arg === "function" && arg.length <= 3 && !("stack" in arg) ? wrapAsync(arg as RequestHandler) : arg
        )
      );
  }
  return router;
}

/** Los parámetros indicados deben ser UUID; si no, responde 400 sin consultar la base. */
export function requireUuidParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, res, next, value) => {
      if (isUuid(value)) return next();
      res.status(400).json({ error: "Identificador inválido" });
    });
  }
}

let installed = false;
/** Un rechazo que escape a todo lo anterior se registra; el proceso sigue vivo. */
export function installProcessSafetyNet(service: string): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error(`[${service}] promesa rechazada sin manejar:`, message);
  });
}

/**
 * Middleware de error final. Un error del cliente (JSON mal formado, cuerpo
 * demasiado grande…) conserva su código 4xx; antes todo acababa en 500 y con
 * la traza en el log. El resto responde 500 sin detalles internos.
 */
export function httpErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  const e = err as { status?: unknown; statusCode?: unknown };
  const status = Number(e?.status ?? e?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? "La petición es demasiado grande" : "Petición inválida" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
}
