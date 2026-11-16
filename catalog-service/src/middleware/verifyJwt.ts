import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

// Fase R — roles oficiales. Los heredados (tech_n1..n4) solo se normalizan.
export type Role = "admin" | "technician" | "dtic" | "user";
const LEGACY: Record<string, Role> = { tech_n1: "technician", tech_n2: "technician", tech_n3: "dtic", tech_n4: "dtic" };
const OFFICIAL = new Set<string>(["admin", "technician", "dtic", "user"]);
export function normalizeRole(role: string | null | undefined): Role {
  if (!role) return "user";
  if (OFFICIAL.has(role)) return role as Role;
  return LEGACY[role] ?? "user";
}
export const STAFF_ROLES: Role[] = ["admin", "technician", "dtic"];

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  pwdChange?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

// Introspección de sesión contra auth-service (ver ticket-service/verifyJwt).
// Ventana de revocación: una sesión VÁLIDA se recuerda solo 5 s (antes 30 s):
// tras un logout, un token robado deja de servir aquí en ≤ 5 s. Con un usuario
// activo esto supone como mucho una consulta a auth-service cada 5 s por token
// (una búsqueda por hash indexada), no una por petición. Una sesión RECHAZADA
// se recuerda 60 s: un token revocado nunca vuelve a ser válido.
const positiveTtlMs = () => Number(process.env.SESSION_CACHE_TTL_MS ?? 5_000);
const negativeTtlMs = () => Number(process.env.SESSION_CACHE_NEGATIVE_TTL_MS ?? 60_000);
const cache = new Map<string, { ok: boolean; until: number }>();
const introspectionEnabled = () =>
  (process.env.AUTH_INTROSPECTION ?? (env.nodeEnv === "production" ? "true" : "false")).toLowerCase() === "true";

async function sessionIsActive(token: string): Promise<boolean | "unavailable"> {
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.ok;
  try {
    const r = await fetch(`${env.authServiceUrl}/auth/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (r.status >= 500) return "unavailable";
    const ok = r.status === 200;
    if (cache.size > 5000) cache.clear();
    cache.set(key, { ok, until: now + (ok ? positiveTtlMs() : negativeTtlMs()) });
    return ok;
  } catch {
    return "unavailable";
  }
}

export async function verifyJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: AuthUser;
  try {
    // Algoritmo fijado: el secreto compartido solo firma HS256.
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as AuthUser;
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  // Solo tokens de USUARIO: los tokens internos entre servicios (audiencia
  // propia, sin userId) nunca sirven como sesión de una persona.
  if (typeof payload.userId !== "string" || payload.userId === "" || (payload as { aud?: unknown }).aud !== undefined) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  if (payload.pwdChange) {
    return res.status(403).json({ error: "password_change_required" });
  }
  if (introspectionEnabled()) {
    const active = await sessionIsActive(token);
    if (active === "unavailable") return res.status(503).json({ error: "Servicio de autenticación no disponible" });
    if (!active) return res.status(401).json({ error: "Sesión inválida o revocada" });
  }
  payload.role = normalizeRole(payload.role);
  req.user = payload;
  next();
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
