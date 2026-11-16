import { createApp } from "./app";
import { installProcessSafetyNet } from "./utils/asyncRoutes";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { ensureAcceptanceSchema } from "./services/acceptanceService";
import { startEmailOutboxWorker } from "./services/emailOutboxWorker";
import { startValidationReminderWorker } from "./services/validationReminderService";

// Un rechazo de promesa sin manejar se registra en vez de terminar el proceso.
installProcessSafetyNet("ticket-service");

const app = createApp();

app.listen(env.port, () => {
  console.log(`ticket-service escuchando en puerto ${env.port}`);
  console.log(`  uploads dir: ${env.uploadDir}`);
  // Fase T: términos de aceptación publicados + constancias inmutables.
  ensureAcceptanceSchema(prisma)
    .then(() => console.log("[acceptance] términos y triggers de inmutabilidad verificados"))
    .catch((err) => console.error("[acceptance] no se pudo preparar la aceptación digital:", err));
  // Trabajadores periódicos (best-effort, nunca tumban el servicio):
  //   · outbox de correo: reintentos automáticos con backoff;
  //   · recordatorios al solicitante con una solución sin validar.
  startEmailOutboxWorker({ intervalSec: env.email.workerIntervalSec });
  startValidationReminderWorker({ days: env.validationReminder.days, intervalMin: env.validationReminder.intervalMin });
});
