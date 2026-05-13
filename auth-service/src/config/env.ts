import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Falta variable de entorno requerida: ${name}`);
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

// Soporta los nombres nuevos MICROSOFT_* y los anteriores AZURE_AD_* como fallback.
const azureClientId =
  optional(process.env.MICROSOFT_CLIENT_ID) ?? optional(process.env.AZURE_AD_CLIENT_ID);
const azureTenantId =
  optional(process.env.MICROSOFT_TENANT_ID) ?? optional(process.env.AZURE_AD_TENANT_ID);
const azureClientSecret =
  optional(process.env.MICROSOFT_CLIENT_SECRET) ?? optional(process.env.AZURE_AD_CLIENT_SECRET);
const azureRedirectUri =
  optional(process.env.MICROSOFT_REDIRECT_URI) ?? optional(process.env.AZURE_AD_REDIRECT_URI);

const ssoConfigured = Boolean(
  azureClientId && azureTenantId && azureClientSecret && azureRedirectUri
);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),

  jwt: {
    secret: required("JWT_SECRET", process.env.JWT_SECRET),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },

  // Microsoft Azure AD opcional: si las 4 variables están configuradas, /auth/microsoft funciona.
  // Si faltan, el endpoint responde 503 y el equipo puede usar /auth/dev-login.
  ssoConfigured,
  microsoft: {
    clientId: azureClientId ?? "",
    tenantId: azureTenantId ?? "",
    clientSecret: azureClientSecret ?? "",
    redirectUri: azureRedirectUri ?? "",
  },

  // dev-login: solo se habilita con AUTH_DEV_LOGIN=true (off por defecto en producción real).
  devLoginEnabled: (process.env.AUTH_DEV_LOGIN ?? "false").toLowerCase() === "true",

  allowedDomain: process.env.ALLOWED_DOMAIN ?? "uta.edu.ec",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",

  // Lista de correos que deben recibir rol "admin" cuando inician sesión
  // por Microsoft (real o simulado). Coma-separados en ADMIN_EMAILS.
  adminEmails: (process.env.ADMIN_EMAILS ?? "msolis5357@uta.edu.ec,admin@uta.edu.ec")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0),
};
