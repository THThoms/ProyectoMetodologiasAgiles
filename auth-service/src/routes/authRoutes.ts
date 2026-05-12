import { Router, Request, Response } from "express";
import { getMsalClient, SCOPES } from "../msal/client";
import { env } from "../config/env";
import { verifyJwt } from "../middleware/verifyJwt";
import {
  upsertUserFromMicrosoft,
  issueSession,
  revokeSession,
  DomainNotAllowedError,
  MicrosoftClaims,
} from "../services/authService";
import { prisma } from "../db/client";

const router = Router();

// ---------------------------------------------------------------------------
// GET /auth/microsoft -> Redirige al login de Microsoft
// ---------------------------------------------------------------------------
router.get("/microsoft", async (_req: Request, res: Response) => {
  if (!env.ssoConfigured) {
    return res.status(503).json({
      error: "SSO no configurado",
      detail:
        "Faltan variables AZURE_AD_CLIENT_ID / AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_SECRET / AZURE_AD_REDIRECT_URI.",
    });
  }
  try {
    const url = await getMsalClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: env.azure.redirectUri,
      // Forzar selección de cuenta evita SSO transparente cuando se quiere cambiar de usuario;
      // si la sesión Microsoft está activa para una sola cuenta, igual entra sin pedir credenciales.
      prompt: "select_account",
    });
    return res.redirect(url);
  } catch (err) {
    console.error("Error generando URL de Microsoft:", err);
    return res.status(500).json({ error: "No se pudo iniciar el flujo SSO" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/microsoft/callback -> Recibe code, valida tenant, emite JWT
// ---------------------------------------------------------------------------
router.get("/microsoft/callback", async (req: Request, res: Response) => {
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
      redirectUri: env.azure.redirectUri,
    });

    const claims = (tokenResponse.idTokenClaims ?? {}) as MicrosoftClaims;
    const user = await upsertUserFromMicrosoft(claims);
    const { token } = await issueSession(user);

    // Pasamos el JWT al frontend por query string. El frontend lo guarda en localStorage
    // y limpia la URL para no dejar el token en el historial.
    return res.redirect(`${env.frontendUrl}/auth/callback?token=${token}`);
  } catch (err) {
    if (err instanceof DomainNotAllowedError) {
      return res.redirect(
        `${env.frontendUrl}/login?error=domain_not_allowed&domain=${env.allowedDomain}`
      );
    }
    console.error("Error en callback Microsoft:", err);
    return res.redirect(`${env.frontendUrl}/login?error=auth_failed`);
  }
});

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
  const { token } = await issueSession(user);
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

export default router;
