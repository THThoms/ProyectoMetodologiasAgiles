import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

/** En producción el secreto que valida las sesiones debe tener al menos 32 caracteres. */
function jwtSecret(): string {
  const secret = required("JWT_SECRET", process.env.JWT_SECRET);
  if ((process.env.NODE_ENV ?? "development") === "production" && secret.length < 32) {
    throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción");
  }
  return secret;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3002),
  jwtSecret: jwtSecret(),
  // Fase R: introspección de sesión (logout/revocación efectivos también aquí).
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001",
};
