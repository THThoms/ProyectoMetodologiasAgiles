import { prisma } from "../db/client";
import { Role } from "@prisma/client";
import { signAuthToken, getExpiresAt } from "../utils/jwt";
import { env } from "../config/env";
import crypto from "crypto";

export interface MicrosoftClaims {
  oid?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  upn?: string;
}

export class DomainNotAllowedError extends Error {
  constructor(email: string) {
    super(`El email ${email} no pertenece al dominio institucional @${env.allowedDomain}`);
    this.name = "DomainNotAllowedError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Correo o contraseña incorrectos");
    this.name = "InvalidCredentialsError";
  }
}

// Hash simple para contraseñas de desarrollo (SHA-256).
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Extrae el email del payload de Microsoft (los claims varían según tipo de cuenta).
function extractEmail(claims: MicrosoftClaims): string | undefined {
  return claims.email ?? claims.preferred_username ?? claims.upn;
}

function isAllowedDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${env.allowedDomain.toLowerCase()}`);
}

// Provisión automática: si el usuario no existe en la BD local, lo crea con rol `user`.
// Los roles administrativos se asignan manualmente desde /admin.
export async function upsertUserFromMicrosoft(claims: MicrosoftClaims) {
  const email = extractEmail(claims);
  if (!email) {
    throw new Error("Microsoft no devolvió un email válido");
  }
  if (!isAllowedDomain(email)) {
    throw new DomainNotAllowedError(email);
  }

  return prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      msOid: claims.oid,
      name: claims.name ?? email,
    },
    create: {
      email: email.toLowerCase(),
      name: claims.name ?? email,
      msOid: claims.oid,
      role: Role.user,
    },
  });
}

// ---------------------------------------------------------------------------
// Login local con correo + contraseña
// ---------------------------------------------------------------------------
export async function loginWithPassword(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();

  if (!isAllowedDomain(normalizedEmail)) {
    throw new DomainNotAllowedError(normalizedEmail);
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const inputHash = hashPassword(password);
  if (inputHash !== user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  return user;
}

// ---------------------------------------------------------------------------
// Login simulado Microsoft Office 365
// Devuelve un usuario de la BD según el email. Si no existe, lo crea como "user".
// ---------------------------------------------------------------------------
export async function microsoftSimulatedLogin(email?: string) {
  const normalizedEmail = (email ?? "docente@uta.edu.ec").toLowerCase().trim();

  if (!isAllowedDomain(normalizedEmail)) {
    throw new DomainNotAllowedError(normalizedEmail);
  }

  // Buscar usuario existente o crear uno nuevo
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {},
    create: {
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0].replace(".", " "),
      role: Role.user,
    },
  });

  return user;
}

// ---------------------------------------------------------------------------
// Emitir sesión JWT con authProvider
// ---------------------------------------------------------------------------
export type AuthProvider = "local" | "microsoft" | "microsoft-simulated";

export async function issueSession(
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
  },
  authProvider: AuthProvider = "local"
) {
  const token = signAuthToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider,
  });
  const expiresAt = getExpiresAt(token);

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      authProvider,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Registrar log de acceso
// ---------------------------------------------------------------------------
export async function logAccess(params: {
  userId?: string;
  userEmail: string;
  userName: string;
  endpoint: string;
  authProvider: string;
}) {
  await prisma.authLog.create({
    data: {
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      endpoint: params.endpoint,
      authProvider: params.authProvider,
    },
  });
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
