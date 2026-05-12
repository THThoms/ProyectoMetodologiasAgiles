import { Request, Response, NextFunction } from "express";
import { verifyAuthToken, AuthTokenPayload } from "../utils/jwt";
import { prisma } from "../db/client";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthTokenPayload;
  }
}

// Middleware reutilizable. Otros microservicios reproducen esta lógica
// localmente (validan el JWT con el mismo JWT_SECRET) - ver shared no compartido.
export async function verifyJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyAuthToken(token);

    // Verificar que la sesión no esté revocada
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.revokedAt) {
      return res.status(401).json({ error: "Sesión inválida o revocada" });
    }
    if (session.expiresAt < new Date()) {
      return res.status(401).json({ error: "Sesión expirada" });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}
