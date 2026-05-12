import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type Role = "admin" | "tech_n1" | "tech_n2" | "tech_n3" | "tech_n4" | "user";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

// Validación local del JWT con el mismo secreto del auth-service.
// No hacemos round-trip al auth-service por performance — confiamos en el secreto compartido.
export function verifyJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "No tienes permisos para esta acción" });
    }
    next();
  };
}
