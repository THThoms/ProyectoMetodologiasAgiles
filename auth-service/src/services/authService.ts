import { prisma } from "../db/client";
import { Role } from "@prisma/client";
import { signAuthToken, getExpiresAt } from "../utils/jwt";
import { env } from "../config/env";

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

export async function issueSession(user: {
  id: string;
  email: string;
  name: string;
  role: Role;
}) {
  const token = signAuthToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  const expiresAt = getExpiresAt(token);

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
