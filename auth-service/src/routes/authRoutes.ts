import { Router, Request, Response } from "express";
import { getMsalClient, SCOPES } from "../config/msal.config";
import { env } from "../config/env";
import { verifyJwt } from "../middleware/verifyJwt";
import {
  upsertUserFromMicrosoft,
  issueSession,
  revokeSession,
  loginWithPassword,
  microsoftSimulatedLogin,
  logAccess,
  DomainNotAllowedError,
  InvalidCredentialsError,
  MicrosoftClaims,
} from "../services/authService";
import { prisma } from "../db/client";

const router = Router();

// ---------------------------------------------------------------------------
// POST /auth/login -> Login local con correo y contraseña
// ---------------------------------------------------------------------------
router.post("/login", async (req: Request, res: Response) => {
  const correo = String(req.body?.correo ?? req.body?.email ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña son requeridos" });
  }

  try {
    const user = await loginWithPassword(correo, password);
    const { token } = await issueSession(user, "local");

    // Registrar log de acceso
    await logAccess({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      endpoint: "/auth/login",
      authProvider: "local",
    });

    return res.json({
      token,
      authProvider: "local",
      user: {
        idUsuario: user.id,
        nombres: user.name.split(" ")[0] || user.name,
        apellidos: user.name.split(" ").slice(1).join(" ") || "",
        correo: user.email,
        rol: user.role,
      },
    });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return res.status(401).json({ error: err.message });
    }
    if (err instanceof DomainNotAllowedError) {
      return res.status(403).json({ error: err.message });
    }
    console.error("Error en login local:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/microsoft-simulate -> Login simulado Microsoft Office 365
// No se conecta a Microsoft real. Devuelve un usuario institucional simulado.
// ---------------------------------------------------------------------------
router.post("/microsoft-simulate", async (req: Request, res: Response) => {
  const email = String(req.body?.email ?? req.body?.correo ?? "docente@uta.edu.ec").trim();

  try {
    const user = await microsoftSimulatedLogin(email);
    const { token } = await issueSession(user, "microsoft-simulated");

    // Registrar log de acceso
    await logAccess({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      endpoint: "/auth/microsoft-simulate",
      authProvider: "microsoft-simulated",
    });

    return res.json({
      token,
      authProvider: "microsoft-simulated",
      user: {
        idUsuario: user.id,
        nombres: user.name.split(" ")[0] || user.name,
        apellidos: user.name.split(" ").slice(1).join(" ") || "Microsoft",
        correo: user.email,
        rol: user.role,
      },
    });
  } catch (err) {
    if (err instanceof DomainNotAllowedError) {
      return res.status(403).json({ error: err.message });
    }
    console.error("Error en login Microsoft simulado:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/microsoft -> Redirige al login de Microsoft
// ---------------------------------------------------------------------------
router.get("/microsoft", async (req: Request, res: Response) => {
  if (!env.ssoConfigured) {
    return res.status(503).json({
      error: "SSO no configurado",
      detail:
        "Faltan variables MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI.",
    });
  }
  try {
    // El frontend puede pasar ?login_hint=usuario@uta.edu.ec para pre-rellenar
    // el formulario de Microsoft y saltar la pantalla "elige una cuenta".
    const loginHint =
      typeof req.query.login_hint === "string" && req.query.login_hint.trim() !== ""
        ? req.query.login_hint.trim()
        : undefined;

    const url = await getMsalClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: env.microsoft.redirectUri,
      loginHint,
      // Si NO hay hint, forzamos selección de cuenta. Con hint, Microsoft usa el hint.
      prompt: loginHint ? undefined : "select_account",
    });
    return res.redirect(url);
  } catch (err) {
    console.error("Error generando URL de Microsoft:", err);
    return res.status(500).json({ error: "No se pudo iniciar el flujo SSO" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/callback -> Recibe code, valida tenant, emite JWT y redirige al frontend.
// (También expuesto como /auth/microsoft/callback para retrocompatibilidad.)
// ---------------------------------------------------------------------------
async function microsoftCallbackHandler(req: Request, res: Response) {
  if (!env.ssoConfigured) {
    return res.redirect(`${env.frontendUrl}/login?error=sso_not_configured`);
  }
  const code = req.query.code as string | undefined;
  const errorParam = req.query.error as string | undefined;

  if (errorParam) {
    return res.redirect(
      `${env.frontendUrl}/login?error=${encodeURIComponent(errorParam)}`
    );
  }
  if (!code) {
    return res.redirect(`${env.frontendUrl}/login?error=missing_code`);
  }

  try {
    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: env.microsoft.redirectUri,
    });

    const claims = (tokenResponse.idTokenClaims ?? {}) as MicrosoftClaims;
    const user = await upsertUserFromMicrosoft(claims);
    const { token } = await issueSession(user, "microsoft");

    await logAccess({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      endpoint: "/auth/callback",
      authProvider: "microsoft",
    });

    // El frontend lee el token desde el query y lo guarda en localStorage.
    return res.redirect(`${env.frontendUrl}/auth/success?token=${token}`);
  } catch (err) {
    if (err instanceof DomainNotAllowedError) {
      return res.redirect(
        `${env.frontendUrl}/login?error=domain_not_allowed&domain=${env.allowedDomain}`
      );
    }
    console.error("Error en callback Microsoft:", err);
    return res.redirect(`${env.frontendUrl}/login?error=auth_failed`);
  }
}

router.get("/callback", microsoftCallbackHandler);
router.get("/microsoft/callback", microsoftCallbackHandler);

// ---------------------------------------------------------------------------
// POST /auth/dev-login -> Solo desarrollo (AUTH_DEV_LOGIN=true)
// Permite emitir un JWT sin pasar por Microsoft. Útil para desbloquear al
// equipo (HU-03/04/05 + frontend) mientras se configura Azure AD.
// Body: { "email": "admin@uta.edu.ec" }
// ---------------------------------------------------------------------------
router.post("/dev-login", async (req: Request, res: Response) => {
  if (!env.devLoginEnabled) {
    return res.status(404).json({ error: "Endpoint no disponible" });
  }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "email requerido" });
  }
  if (!email.endsWith(`@${env.allowedDomain.toLowerCase()}`)) {
    return res.status(403).json({
      error: `Solo se aceptan cuentas del dominio @${env.allowedDomain}`,
    });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({
      error: "Usuario no encontrado. Ejecuta el seed o crea el usuario primero.",
    });
  }
  const { token } = await issueSession(user, "local");

  // Registrar log de acceso
  await logAccess({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    endpoint: "/auth/dev-login",
    authProvider: "local",
  });

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// ---------------------------------------------------------------------------
// GET /auth/config -> Info pública para el frontend (qué métodos están habilitados)
// ---------------------------------------------------------------------------
router.get("/config", (_req: Request, res: Response) => {
  res.json({
    ssoConfigured: env.ssoConfigured,
    devLoginEnabled: env.devLoginEnabled,
    allowedDomain: env.allowedDomain,
    microsoftSimulateEnabled: true, // Siempre habilitado en Sprint 1
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me -> Datos del usuario autenticado
// ---------------------------------------------------------------------------
router.get("/me", verifyJwt, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  return res.json({ user });
});

// ---------------------------------------------------------------------------
// POST /auth/logout -> Revoca la sesión actual
// ---------------------------------------------------------------------------
router.post("/logout", verifyJwt, async (req: Request, res: Response) => {
  const header = req.headers.authorization!;
  const token = header.slice("Bearer ".length).trim();
  await revokeSession(token);
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /auth/verify -> Endpoint interno para que otros microservicios
// validen un JWT consultando al auth-service (defensa en profundidad).
// Los demás servicios además validan el JWT localmente con el mismo secreto.
// ---------------------------------------------------------------------------
router.post("/verify", verifyJwt, (req: Request, res: Response) => {
  return res.json({ valid: true, user: req.user });
});

// ---------------------------------------------------------------------------
// POST /auth/users/lookup -> Resolución masiva de usuarios por id.
// HU-07: ticket-service lo usa para enriquecer el panel técnico con nombre y
// email del solicitante (la integridad referencial entre microservicios es
// lógica vía userId, no FK).
// Body: { ids: string[] }   máx. 200 ids por llamada.
// Solo personal autorizado (admin / tech_*) puede invocarlo: protege PII.
// ---------------------------------------------------------------------------
const STAFF_ROLES = new Set(["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"]);

router.post("/users/lookup", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return res.status(403).json({ error: "No tienes permisos para consultar usuarios" });
  }
  const rawIds: unknown = req.body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return res.json({ users: [] });
  }
  if (rawIds.length > 200) {
    return res.status(400).json({ error: "Máximo 200 ids por llamada" });
  }
  const stringIds = rawIds.filter((x): x is string => typeof x === "string");
  const uniqueIds: string[] = Array.from(new Set<string>(stringIds));

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, email: true, name: true, role: true },
  });
  return res.json({ users });
});

// ---------------------------------------------------------------------------
// GET /auth/technicians -> Listado de técnicos para que el admin pueda
// seleccionarlos al asignar manualmente. Solo admin (los técnicos no necesitan
// ver la planilla de pares).
// Modelo `User` no tiene flag `isActive` por ahora; se considera vigente a
// todo usuario con rol tech_*. Devolvemos `isActive=true` en todos para que
// el frontend tenga un esquema estable cuando ese flag se agregue.
// ---------------------------------------------------------------------------
router.get("/technicians", verifyJwt, async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Solo el administrador puede listar técnicos" });
  }
  const technicians = await prisma.user.findMany({
    where: { role: { in: ["tech_n1", "tech_n2", "tech_n3", "tech_n4"] } },
    select: { id: true, email: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return res.json({
    technicians: technicians.map((t) => ({
      id: t.id,
      email: t.email,
      name: t.name,
      role: t.role,
      isActive: true,
    })),
  });
});

export default router;
