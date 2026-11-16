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

/**
 * ¿Exigir STARTTLS? Por defecto sí cuando hay usuario y contraseña (nunca se
 * envían credenciales en claro). No aplica con TLS implícito (SMTP_SECURE=true).
 * SMTP_REQUIRE_TLS=true|false lo fija; vacío = valor por defecto.
 */
function smtpRequireTls(): boolean {
  if ((process.env.SMTP_SECURE ?? "false").trim().toLowerCase() === "true") return false;
  const explicit = (process.env.SMTP_REQUIRE_TLS ?? "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return Boolean((process.env.SMTP_USER ?? "").trim() && (process.env.SMTP_PASS ?? "").trim());
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
  port: Number(process.env.PORT ?? 3003),
  jwtSecret: jwtSecret(),
  catalogServiceUrl: required("CATALOG_SERVICE_URL", process.env.CATALOG_SERVICE_URL),
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001",
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",

  upload: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxFiles: 5,
    // Fase R: el tipo real se valida por bytes (services/imageType.ts). Esta lista
    // solo filtra el MIME declarado; los navegadores/Android a veces envían octet-stream.
    allowedMimeTypes: ["image/jpeg", "image/png", "image/jpg", "image/webp", "application/octet-stream"],
  },

  email: {
    enabled: emailNotificationsEnabled,
    // "log" | "mock" | "smtp"
    sendMode: emailSendMode as "log" | "mock" | "smtp",
    // Trabajador automático del outbox: cada N segundos reintenta pending/failed
    // con backoff (5 min, 30 min) y como mucho 3 intentos. 0 = desactivado
    // (solo el reintento manual del administrador).
    workerIntervalSec: Math.max(0, Number(process.env.EMAIL_OUTBOX_WORKER_INTERVAL_SEC ?? 60) || 0),
    from: process.env.SMTP_FROM ?? "ServiceDesk UTA <no-reply@uta.edu.ec>",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      // Por defecto se exige TLS siempre que haya credenciales y no se use ya
      // TLS implícito (SMTP_SECURE=true, puerto 465).
      requireTls: smtpRequireTls(),
    },
  },

  // Recordatorios al solicitante con una solución pendiente de validar.
  //   VALIDATION_REMINDER_DAYS: días desde la resolución (y entre recordatorios)
  //   antes de volver a avisar; 0 = desactivado. Nunca se cierra nada solo.
  //   VALIDATION_REMINDER_INTERVAL_MIN: cada cuánto se revisa (por defecto 60).
  validationReminder: {
    days: Math.max(0, Number(process.env.VALIDATION_REMINDER_DAYS ?? 3) || 0),
    intervalMin: Math.max(1, Number(process.env.VALIDATION_REMINDER_INTERVAL_MIN ?? 60) || 60),
  },

  // Almacenamiento de imágenes adjuntas.
  // STORAGE_MODE:
  //   - "local" (default): disco montado en el contenedor. La URL devuelta es
  //     relativa (/uploads/<file>) y se sirve por express.static con JWT.
  //   - "cloudinary": sube al CDN de Cloudinary y devuelve URL absoluta HTTPS.
  //     Requiere `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  //     `CLOUDINARY_API_SECRET` y tener la librería `cloudinary` instalada.
  //     Si falta la lib, cae a modo `local` con warning.
  storage: {
    mode: (process.env.STORAGE_MODE ?? "local").toLowerCase() as "local" | "cloudinary",
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
      apiKey: process.env.CLOUDINARY_API_KEY ?? "",
      apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
      folder: process.env.CLOUDINARY_FOLDER ?? "servicedesk-uta",
    },
  },

  // Sprint 4+ · Firebase Cloud Messaging (push a la app Android).
  // FCM_MODE:
  //   - "off"      (default): no envía, no toca la BD para outbox de push.
  //   - "log"      : imprime un resumen (sin secretos) por consola.
  //   - "firebase" : envía real vía firebase-admin. Requiere las 3 credenciales
  //                  del service account. La librería `firebase-admin` se carga
  //                  con lazy require: si falta o las credenciales están vacías,
  //                  el adapter cae a "log" con warning y no rompe el sistema.
  fcm: {
    mode: (process.env.FCM_MODE ?? "off").toLowerCase() as "off" | "log" | "firebase",
    projectId: process.env.FCM_PROJECT_ID ?? "",
    clientEmail: process.env.FCM_CLIENT_EMAIL ?? "",
    // Las claves privadas de service account llegan con `\n` literales cuando
    // se pasan por variable de entorno; los convertimos a saltos reales.
    privateKey: (process.env.FCM_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
};
