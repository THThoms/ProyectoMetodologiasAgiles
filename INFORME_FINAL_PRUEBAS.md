# Informe final — Pruebas (ServiceDesk UTA)

**Fecha:** 2026-11-15 · Todas las pruebas se ejecutaron sobre el estado actual del repositorio (cambios locales sin commitear sobre 7593bbb). Los resultados históricos (451 → 539 del 14-nov) no se copian: estos son los de hoy. Categoría: **local** (este equipo, Docker Desktop). Nada en producción ni en dispositivo.

## 1. Pruebas unitarias e integración (jest / node --test)

| Componente | Suites | Tests | Resultado |
|---|---|---|---|
| auth-service | 10 | 97 | PASS |
| catalog-service | 7 | 92 | PASS (+8: `includeInactive` solo admin) |
| ticket-service | 22 | 318 | PASS (+11: worker de correo, backoff, recordatorios, ventana de revocación) |
| api-gateway | 3 | 13 | PASS |
| frontend | — | 38 | PASS |
| **Total** | **42** | **558** | **PASS** (ejecución secuencial final tras actualizar dependencias) |

Cobertura funcional de las suites: roles y áreas (`areaIsolation`, `rolesCatalog`), bloques (`technicianBlocks`, `blockReport`), aceptación digital (`digitalAcceptance`), imágenes (`uploadAndLifecycle`, `ticketAttachmentServe`), reportes (`adminReports`, `blockReport`, `institutionalReport`), SSO (`ssoExchange`, `securityHardening`, `ssoPkce`), FCM (`fcmService`, `notificationRoutes`), correo (`emailOutbox`, `emailOutboxWorker`, `emailTemplatesLabels`), sesiones (`sessionsAndLogin`, `sessionIntrospection`), endurecimiento (`securityHardening` ×2, `gatewayHardening`, `corsAuthority`, `robustness`), recordatorios (`validationReminder`).

## 2. Compilación y validación estática

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` auth / catalog / ticket / gateway | PASS |
| `tsc -b` + `vite build` (Vite 7.3.8) frontend | PASS |
| `prisma validate` × 3 y `schema.prisma == schema.mssql.prisma` | PASS |
| `docker compose config` servidor nuevo y laboratorio | PASS |
| `npm audit` | frontend 0; gateway/auth 7 *low* (jest); catalog/ticket 7 *low* + zod *high* (ver `INFORME_FINAL_SEGURIDAD.md` §3) |
| gitleaks (historial de la rama) | PASS (4 falsos positivos documentados) |

## 3. Laboratorio local (SQL Server 2022 real, 6 contenedores)

| Comprobación | Resultado |
|---|---|
| Reconstrucción de imágenes y arranque 6/6 healthy; procesos Node como `node` (uid 1000) | PASS |
| `prisma db push` sobre la base existente: `tickets.location` → nvarchar(255), índice `tickets_resolved_by_id_idx` | PASS |
| Trabajador de correo y recordatorios activos en el arranque (logs) | PASS |
| Smoke de solo lectura (48 comprobaciones: salud, CORS, rutas internas, 401/403/404/410/413, catálogo, dev-login por rol, aislamiento por área, adjunto autenticado 200/403, estadísticas T-SQL, reportes técnico/bloque, términos, lookup, FCM 400, logout) | **PASS 48/48** |
| **Impresión real con CSP**: Chrome headless → nginx (plantilla real, TLS) → SPA compilada para ese origen → backend real: login, reporte de técnico generado, `print()` una vez, sin ventanas, PDF 144 KB con encabezado institucional, **0 violaciones de CSP** (`Log` + `Runtime`), cabecera CSP presente | **PASS** |

## 4. Simulación de servidor nuevo (`scripts/testing/new-server-simulation.sh`)

Paquete generado desde el árbol final → instalación limpia (`sdsimclean`, Developer/pruebas) → arquitectura → nginx TLS → E2E → backup → persistencia → restauración (`sdsimrestore`, Express, credenciales nuevas) → guardas.

| Resultado | Valor |
|---|---|
| Comprobaciones de la simulación | **61 / 61 PASS** |
| E2E funcional (`smoke-e2e.mjs`, NODE_ENV=production) | **105 / 105 PASS** |
| Restauración: conteos = origen, login, imagen servida, admin con contraseña cambiada | PASS |

## 5. Backups cifrados y recuperación ante desastre (`backup-dr-simulation.sh`)

**60 / 60 PASS** (segunda ejecución; la primera 59/60 por una interferencia del auditor sobre el laboratorio de origen, explicada en `AUDITORIA_GENERAL_SERVICEDESK_UTA.md` §12b). Detalle en `INFORME_FINAL_BACKUPS.md`.

## 6. Android

`cap sync` + `gradlew assembleDebug` (JDK 21): PASS; contenido y manifest verificados con `aapt2`: PASS. **Dispositivo físico: NOT TESTED.** Detalle en `INFORME_FINAL_ANDROID.md`.

## 7. Matriz E2E definitiva (PARTE 23 del plan)

| Área | Local | Real |
|---|---|---|
| Usuarios: login local, logout, sesiones, permisos | PASS (E2E + smoke) | NOT TESTED |
| Microsoft SSO real | tests con MSAL simulado PASS | **NOT TESTED** (tenant) |
| Técnicos: Bloque 1/2, disponibles, aceptar, contribuir, reescalar, resolver | PASS (E2E 105, blockReport) | NOT TESTED |
| DTIC: panel y tickets propios, separación en estadísticas y reportes | PASS (smoke: disponibles solo DTIC; bloque excluye DTIC) | NOT TESTED |
| Administrador: usuarios/roles/bloques (manage-user + `/admin/bloques`), servicios, ubicaciones, conocimiento, asignaciones, reportes, estadísticas | PASS | NOT TESTED |
| Solicitante: crear con imágenes, historial, revisar, términos, aceptar/rechazar, estado final | PASS (E2E) | NOT TESTED |
| Informes: técnico, Bloque 1/2, PDF e impresión | PASS (PDF real con CSP; block/tech print 12-nov en navegador) | NOT TESTED (impresora física) |
| Android: login, SSO, imágenes, push, deep links, aceptación | build PASS | **NOT TESTED** |
| Infraestructura: reinicio, persistencia, backup, restauración, logs, HTTPS | PASS (simulación) | **BLOCKED** (Ubuntu real) |

## 8. Datos de prueba

Los E2E crean sus propios usuarios (`e2e.*@uta.edu.ec`) y tickets dentro de proyectos Docker aislados (`sdsimclean`, `sdsimrestore`, `sddrsim`) que se destruyen con `--cleanup`. El laboratorio local solo recibió lecturas y `dev-login` (sesiones/`auth_logs`); no se crearon tickets ni constancias en él.
