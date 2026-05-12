import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type Role = "admin" | "tech_n1" | "tech_n2" | "tech_n3" | "tech_n4" | "user";

export interface AuthTokenPayload extends JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
  authProvider?: string;
}

export function signAuthToken(payload: Omit<AuthTokenPayload, "iat" | "exp">): string {
  const options: SignOptions = { expiresIn: env.jwt.expiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwt.secret, options);
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwt.secret) as AuthTokenPayload;
}

// Calcula la fecha de expiración exacta del token recién firmado.
export function getExpiresAt(token: string): Date {
  const decoded = jwt.decode(token) as JwtPayload | null;
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000);
  }
  // fallback: 8h
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
