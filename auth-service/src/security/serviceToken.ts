// =============================================================================
// Tokens INTERNOS entre microservicios.
//
// ticket-service necesita saber qué técnicos atienden un área para avisarles
// (push) cuando un solicitante crea un ticket o un técnico lo escala. Antes
// reenviaba el JWT de quien hacía la acción a GET /auth/technicians, que es solo
// para administradores: con un solicitante o un técnico respondía 403 y el aviso
// nunca se enviaba. La consulta la hace el SERVICIO, no la persona, así que se
// autentica como servicio:
//
//   · JWT HS256 firmado con el secreto compartido (JWT_SECRET), de vida muy
//     corta (60 s), con audiencia propia y sin `userId`.
//   · Solo abre las rutas /auth/internal/*, que devuelven lo mínimo (sin
//     nombres ni correos) y que el API Gateway no publica.
//   · Nunca vale como sesión de usuario: verifyJwt exige `userId`, ausencia de
//     audiencia y una sesión registrada.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

export const SERVICE_TOKEN_AUDIENCE = "servicedesk-internal";
export const ALLOWED_SERVICES: readonly string[] = ["ticket-service"];

export function verifyServiceToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  try {
    const payload = jwt.verify(header.slice("Bearer ".length).trim(), env.jwt.secret, {
      algorithms: ["HS256"],
      audience: SERVICE_TOKEN_AUDIENCE,
    }) as JwtPayload;
    if (
      payload.typ !== "service" ||
      typeof payload.svc !== "string" ||
      !ALLOWED_SERVICES.includes(payload.svc) ||
      payload.userId !== undefined
    ) {
      return res.status(401).json({ error: "Token inválido" });
    }
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}
