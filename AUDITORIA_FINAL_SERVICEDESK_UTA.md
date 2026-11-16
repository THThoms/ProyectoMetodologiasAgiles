# Auditoría final — ServiceDesk UTA

**Fecha:** 2026-11-15 · **Rama:** `consolidacion/fases-q-r-s-t` (7593bbb) + cambios locales **sin commitear** (12, 14 y 15 de noviembre).
**Alcance:** código local, laboratorio Docker local y simulaciones. **No** se tocó el VPS anterior, no hubo despliegue, migración en producción, commit ni push; no se borró ninguna base ni volumen.

Informes de detalle: `INFORME_FINAL_SEGURIDAD.md`, `INFORME_FINAL_PRUEBAS.md`, `INFORME_FINAL_ANDROID.md`, `INFORME_FINAL_SERVIDOR.md`, `INFORME_FINAL_BACKUPS.md`, `PLAN_FINALIZACION_SERVICEDESK.md`; manuales `docs/installation/MANUAL_INSTALACION_NUEVO_SERVIDOR.md` y `docs/operations/MANUAL_RECUPERACION.md`; auditoría anterior `AUDITORIA_GENERAL_SERVICEDESK_UTA.md`.

## 1. Diagnóstico de partida (toma de control)

- Git: `consolidacion/fases-q-r-s-t` es la rama con el código más completo (incluye las fases Q–Y y la auditoría del 12/14-nov sin commitear). `microservicios` (3cebd1c, en `servicedesk-fisei`) y `consolidacion/limpia` son la versión saneada **anterior** a la auditoría; `Develop`/`main` son antiguas. Remoto `origin` = `ProyectoMetodologiasAgiles` (público). No se modificó el historial.
- Documentación: coherente tras la auditoría del 14-nov; el marcador `__DR_RESULT__` ya estaba resuelto con la evidencia real (DR 59/60 explicado + 60/60); hoy se repitieron las simulaciones con el código final.
- Inventario: 5 componentes, 3 esquemas Prisma (`sqlserver`, idénticos en sus dos copias), Dockerfiles, compose de laboratorio y de servidor, instalador, scripts de backup/restauración/pruebas, proyecto Android, `.env.example`.

## 2. Cambios realizados hoy (además de los del 12/14-nov)

| # | Área | Cambio | Verificación |
|---|---|---|---|
| 1 | Sesiones | Caché de introspección en ticket/catalog: válida 5 s (antes 30 s), rechazo 60 s; ≤ 1 consulta/5 s por token activo | test de ventana de revocación |
| 2 | Correo | Trabajador automático del outbox (`emailOutboxWorker.ts`): cada 60 s, backoff 0 → 5 min → 30 min, máximo 3 intentos, sin solape, nunca lanza; el reintento manual del admin no espera | 6 tests; activo en el laboratorio |
| 3 | Tickets | Recordatorios al solicitante con solución sin validar (`validationReminderService.ts`): tras 3 días (configurable), correo + push + evento interno, repetido cada 3 días, **sin cierre automático** | 4 tests; plantilla nueva |
| 4 | Catálogo | `includeInactive=true` en `/services` y `/locations` exige administrador (401/403) | 8 tests |
| 5 | SQL Server | `tickets.location` → `NVarChar(255)`; índice `tickets_resolved_by_id_idx` (ambas copias del esquema) | `db push` sobre base existente (laboratorio) y en instalación limpia/restaurada (simulación) |
| 6 | Dependencias | nodemailer 8 → 10.5, msal-node 2 → 7.2, react-router-dom 6 → 7.18, vite 5 → 7.3 (+ plugin-react 5.2), zod → 3.25.76 | regresión completa 558 tests, build, E2E |
| 7 | Config | `EMAIL_OUTBOX_WORKER_INTERVAL_SEC`, `VALIDATION_REMINDER_DAYS`, `VALIDATION_REMINDER_INTERVAL_MIN` en `.env.example` y compose del servidor | compose config |
| 8 | Entrega | Paquete `release/servicedesk-uta-server-1.0.0-rc6.tar.gz`; informes y manuales; nota en el contexto maestro | ver §5 |

Los cambios del 12/14-nov (rutas asíncronas, `/uploads`, PKCE Android, tenant, CSP, token de servicio, CORS del gateway, contenedores sin root, resolución/asignación condicionadas, etiquetas, caché de `index.html`, APK versionCode 2) siguen en el árbol y se verificaron de nuevo hoy.

## 3. Estado por criterio de aceptación

| Grupo | Criterio | Estado |
|---|---|---|
| Código | 5 componentes compilan; tests aprobados (558); Prisma válido; sin PostgreSQL en runtime; sin errores críticos conocidos; autorizaciones protegidas | PASS |
| Código | Commits reproducibles | **pendiente de autorización** (todo sin commitear) |
| Funcionalidad | Usuarios, administradores, técnicos, DTIC, Bloque 1/2, tickets, reescalamiento, resolución, aceptación digital, rechazo con motivo, historial, imágenes, conocimiento, estadísticas, reportes, correos (outbox), push (FCM) | PASS en local (unit + smoke + E2E); correo y push reales NOT TESTED |
| Seguridad | Azure real preservado; sin login simulado en producción; sin contraseñas demo; sesiones seguras; revocación comprobada (≤ 5 s); CORS; CSP (probada con backend real); SQL Server privado; nginx única entrada; Docker seguro; secretos excluidos | PASS |
| Recuperación | 3 bases + attachments respaldados, cifrado, drill, integridad, procedimiento | PASS (laboratorio) |
| Recuperación | Copia externa real, dos custodios | **BLOCKED** (B2 y designación) |
| Instalación | Docker, SQL Server, nginx, HTTPS, healthchecks, logs, clean y restore | PASS (simulación 61/61) |
| Instalación | Ubuntu real, firewall, SSH, systemd | **BLOCKED** (sin VM/servidor) |
| Android | APK actualizado | PASS (debug, versionCode 2) |
| Android | SSO, imágenes, push, deep links probados físicamente; release firmada | **NOT TESTED / BLOCKED** (dispositivo, keystore) |

## 4. Hallazgos nuevos y su clasificación

| Sev. | Hallazgo | Estado |
|---|---|---|
| MEDIO | Ventana de 30 s de sesión revocada en ticket/catalog | Corregido (5 s) |
| MEDIO | Outbox sin procesamiento automático: un fallo SMTP dejaba correos sin reenviar hasta que un administrador lo pidiera | Corregido (worker con backoff) |
| MEDIO | Tickets `pendiente_validacion` sin respuesta del usuario quedaban sin aviso indefinidamente | Corregido (recordatorios; sin cierre automático) |
| BAJO | Servicios/ubicaciones inactivos visibles sin autenticación (`includeInactive`) | Corregido (admin) |
| BAJO | `tickets.location` sin Unicode; `resolved_by_id` sin índice | Corregido (esquema; aplicado por `db push`) |
| MEDIO | 5 dependencias con versión mayor pendiente | 4 actualizadas; zod 4 queda como tarea controlada con mitigación |
| — | `resuelto` (final heredado) vs `cerrado` (final actual) | Sin cambio retroactivo: reportes y filtros tratan ambos como finales; documentado |
| — | Estadísticas DTIC/Técnicos | Verificado: `byResponsibleArea` separa; reporte de bloque excluye DTIC; `/admin/technicians/summary` por área |

## 5. Entregables

| Entregable | Ubicación |
|---|---|
| Paquete RC6 (596 KB, 236 archivos, incluye los manuales y la guía con Azure, correo, Firebase y el inventario de secretos; SHA-256 `e4c53216fe4e81af…`, completo en `release/servicedesk-uta-server-1.0.0-rc6.tar.gz.sha256`) | `release/` (ignorado por Git; RC5 y RC4 no deben distribuirse) |
| APK debug versionCode 2 (MD5 `5e3b5d68…`, compilado contra `servicedesk-uta.site`) | `frontend/android/app/build/outputs/apk/debug/app-debug.apk` |
| Informes finales y plan | raíz del repositorio |
| Manuales de instalación y recuperación | `docs/installation/`, `docs/operations/` (incluidos en el paquete) |
| Manual técnico | `docs/manual-tecnico/` (LaTeX/PDF de fases anteriores; sin cambios hoy) |

## 6. Bloqueos (requieren a la institución o al propietario)

1. Autorizar commit/push de los cambios locales y la visibilidad del repositorio público.
2. Servidor Ubuntu 24.04, dominio, licencia de SQL Server.
3. Azure: tenant GUID, Redirect URI del dominio nuevo. SMTP y Firebase institucionales. B2 y custodios. Decisión de RPO.
4. Logotipos oficiales; texto aprobado de los términos (nueva versión, nunca editar la 1.0).
5. Dispositivo Android y keystore de release.
6. Ventana de corte y autorización para intervenir el VPS anterior (procedimiento en `INFORME_FINAL_SEGURIDAD.md` §4 y `MANUAL_RECUPERACION.md` §5).

## 7. Nota sobre el entorno de pruebas

Durante la sesión Docker Desktop se cerró dos veces de forma externa; al volver, el laboratorio se recuperó solo. Si quedaran proyectos de prueba (`sdsimclean`, `sdsimrestore`, `sddrsim`, `sdbackuplab`), se eliminan con `scripts/testing/new-server-simulation.sh --cleanup` y `scripts/testing/backup-dr-simulation.sh --cleanup`; nunca afectan al laboratorio ni a producción.
