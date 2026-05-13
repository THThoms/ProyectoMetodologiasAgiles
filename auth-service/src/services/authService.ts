import { prisma } from "../db/client";
import { Role } from "@prisma/client";
import { signAuthToken, getExpiresAt } from "../utils/jwt";
import { env } from "../config/env";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const BCRYPT_ROUNDS = 12;

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

// bcrypt con salt para contraseñas nuevas. Hashes legacy SHA-256 (64 chars hex)
// se detectan por verifyPassword() y se re-hashean a bcrypt en el siguiente login.
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

// SHA-256 legacy: usado solo para verificar hashes viejos antes de migrarlos a bcrypt.
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Detecta el formato del hash y compara contra la contraseña en claro.
// Devuelve { ok, legacy } — legacy=true significa que hay que re-hashear con bcrypt.
function verifyPassword(plain: string, stored: string): { ok: boolean; legacy: boolean } {
  if (stored.startsWith("$2")) {
    return { ok: bcrypt.compareSync(plain, stored), legacy: false };
  }
  // Hash legacy SHA-256 (sin salt, 64 chars hex). Comparación constant-time
  // para evitar timing attacks aunque sea código en deprecación.
  const candidate = sha256Hex(plain);
  if (candidate.length !== stored.length) return { ok: false, legacy: true };
  const ok = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
  return { ok, legacy: true };
}

// Extrae el email del payload de Microsoft (los claims varían según tipo de cuenta).
function extractEmail(claims: MicrosoftClaims): string | undefined {
  return claims.email ?? claims.preferred_username ?? claims.upn;
}

function isAllowedDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${env.allowedDomain.toLowerCase()}`);
}

function isAdminEmail(email: string): boolean {
  return env.adminEmails.includes(email.toLowerCase());
}

// Provisión automática: si el usuario no existe en la BD local, lo crea con su rol.
// Los correos listados en ADMIN_EMAILS reciben siempre rol admin (incluso si ya
// existían con otro rol). El resto se crea como `user` y se puede promover desde /admin.
export async function upsertUserFromMicrosoft(claims: MicrosoftClaims) {
  const email = extractEmail(claims);
  if (!email) {
    throw new Error("Microsoft no devolvió un email válido");
  }
  if (!isAllowedDomain(email)) {
    throw new DomainNotAllowedError(email);
  }

  const normalizedEmail = email.toLowerCase();
  const shouldBeAdmin = isAdminEmail(normalizedEmail);

  return prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      microsoftId: claims.oid,
      name: claims.name ?? email,
      ...(shouldBeAdmin ? { role: Role.admin } : {}),
    },
    create: {
      email: normalizedEmail,
      name: claims.name ?? email,
      microsoftId: claims.oid,
      role: shouldBeAdmin ? Role.admin : Role.user,
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

  const { ok, legacy } = verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new InvalidCredentialsError();
  }

  // Migración silenciosa: si el hash era SHA-256 legacy, lo re-hasheamos con bcrypt.
  if (legacy) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password) },
    });
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

  const shouldBeAdmin = isAdminEmail(normalizedEmail);

  // Buscar usuario existente o crear uno nuevo
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: shouldBeAdmin ? { role: Role.admin } : {},
    create: {
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0].replace(".", " "),
      role: shouldBeAdmin ? Role.admin : Role.user,
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
