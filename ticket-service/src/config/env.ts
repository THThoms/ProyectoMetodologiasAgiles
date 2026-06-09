import dotenv from "dotenv";
import path from "path";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

// HU-15 - Configuración de notificaciones por correo.
// EMAIL_SEND_MODE:
//   - "log"  (default): no envía, imprime un resumen seguro a consola.
//   - "mock": no envía, no imprime (para tests).
//   - "smtp": envía vía nodemailer (lazy require; instalar `nodemailer` si se usa).
// EMAIL_NOTIFICATIONS_ENABLED: bandera global. Si "false", el dispatch se salta
//   por completo (el outbox tampoco se crea).
const emailSendMode = (process.env.EMAIL_SEND_MODE ?? "log").toLowerCase();
const emailNotificationsEnabled =
  (process.env.EMAIL_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3003),
  jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
  catalogServiceUrl: required("CATALOG_SERVICE_URL", process.env.CATALOG_SERVICE_URL),
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001",
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",

  upload: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxFiles: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/jpg"],
  },

  email: {
    enabled: emailNotificationsEnabled,
    // "log" | "mock" | "smtp"
    sendMode: emailSendMode as "log" | "mock" | "smtp",
    from: process.env.SMTP_FROM ?? "ServiceDesk UTA <no-reply@uta.edu.ec>",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  },
};
