# Auditoría general y reparación — ServiceDesk UTA

> Este informe corresponde a la auditoría del 12/14 de noviembre. La fase de finalización del 15 de noviembre
> (nuevas correcciones, dependencias, simulaciones repetidas y paquete RC6) está en `AUDITORIA_FINAL_SERVICEDESK_UTA.md`.

**Fecha:** 2026-11-14 (segunda pasada; incorpora y verifica la primera, del 2026-11-12).
**Rama auditada:** `consolidacion/fases-q-r-s-t` (commit 7593bbb) con los cambios sin commitear del árbol de trabajo. Mismo código que la rama `microservicios` (3cebd1c) salvo la documentación interna.
**Alcance:** código local y laboratorio Docker local. **No** se tocó el VPS, **no** se desplegó, **no** se ejecutó ninguna migración sobre producción, **no** se hizo commit ni push, **no** se borró ninguna base ni volumen.

Categorías de prueba usadas en todo el informe: **local** = este equipo (tests, builds, Docker). Nada se probó en producción ni en un dispositivo Android físico.

Leyenda de hallazgos: CRÍTICO · ALTO · MEDIO · BAJO. Leyenda de comprobaciones: PASS · FAIL · BLOCKED · NOT TESTED.

---

## 1. Arquitectura encontrada

Cinco componentes: `auth-service` (3001), `catalog-service` (3002), `ticket-service` (3003), `api-gateway` (8080, Express + http-proxy-middleware) y `frontend` (React 18 + Vite 5 + Tailwind, servido por nginx). **SQL Server 2022 es el único motor**: `auth_db`, `catalog_db`, `ticket_db` con Prisma `provider = "sqlserver"`. No existe ninguna dependencia de ejecución de PostgreSQL (los restos están en `archive/postgresql/`, fuera del paquete de servidor).

Servidor nuevo: `deploy/server/compose.yaml` + `scripts/install-server.sh`, con redes `data` (interna, sin Internet), `app` y `edge`; solo gateway y frontend publicados, y solo en 127.0.0.1, detrás del nginx del host (`deploy/nginx/servicedesk.conf.template`). Laboratorio local: `compose.yaml` + `.env.mssql`. Android: Capacitor 8, `appId ec.uta.servicedesk`, bundle web empaquetado + API remota.

Autenticación: login local (bcrypt), **Microsoft Entra ID real** con `@azure/msal-node` (authorization code + `state` ligado a cookie + código de un solo uso + verificador tipo PKCE en Android) y JWT HS256 con sesión persistida por SHA-256. Roles oficiales: `admin`, `technician` (área TECHNICIANS, bloque 1/2 como clasificación), `dtic` (área DTIC, sin bloque), `user`.

## 2. Estado de cada microservicio

| Componente | Tests unitarios | TypeScript / build | Observación |
|---|---|---|---|
| auth-service | **97 PASS** (10 suites) | PASS | Rutas asíncronas protegidas, limitador acotado, tenant validado, lookup solo UUID |
| catalog-service | **84 PASS** (6 suites) | PASS | Id no UUID → 400 (antes tumbaba el proceso) |
| ticket-service | **307 PASS** (20 suites) | PASS | Resolución condicionada, asignación admin con guardas, etiquetas de estado, adjuntos siempre por URL autenticada |
| api-gateway | **13 PASS** (3 suites) | PASS | Autoridad CORS única, rutas internas bloqueadas, registros sin códigos |
| frontend | **38 PASS** (node --test) | PASS (`tsc -b` + `vite build`) | Verificador SSO Android, destinos de notificación solo internos |

Total: **539 pruebas unitarias en verde** (451 en RC4 → 526 el 12-nov → 539 hoy). Ninguna prueba existente se modificó para ocultar un fallo; las dos modificaciones a tests existentes son (a) la aserción de `POST /tickets/:id/resolve`, que ahora espera la escritura condicionada, y (b) un tiempo de espera de 30 s en `insecureLoginGuard.test.ts`, cuya carga de la aplicación completa superaba los 5 s con varias suites en paralelo (fallaba por tiempo, no por lógica).

Contenedores (laboratorio local reconstruido hoy): 6/6 `healthy`; los cuatro procesos Node corren como el usuario `node` (uid 1000). En el compose del servidor nuevo SQL Server corre además como `mssql` (uid 10001), verificado en la simulación; el compose del laboratorio lo mantiene como root por diseño (`user: "0:0"`).

## 3. Estado de SQL Server

- `prisma validate` sobre los tres `schema.mssql.prisma`: **PASS**; `schema.prisma` es byte a byte idéntico a `schema.mssql.prisma` en los tres servicios (PASS). `prisma generate`: PASS (se ejecuta en cada build de imagen).
- `tickets.status`, `ticket_events.previous_status` y `new_status` son `NVarChar(24)`: admiten `pendiente_validacion` (PASS).
- SQL crudo: 7 consultas T-SQL en estadísticas y mantenimiento, todas con texto fijo y parámetros posicionales `@P1…`; el DDL de los triggers de inmutabilidad es texto fijo. **No se encontró inyección SQL.**
- Integridad referencial lógica entre bases (sin FK físicas): el backup registra conteos y referencias cruzadas (`xref_*`) y la restauración los compara; verificado en la simulación (conteos restaurados = origen).
- Observaciones que **requieren migración** (no aplicadas; ver §10): `tickets.location` es `VarChar(255)` no Unicode; `tickets.resolved_by_id` no tiene índice y se usa en reportes y estadísticas.
- Smoke contra SQL Server 2022 real: **PASS** (laboratorio local, 48/48, y simulación de servidor nuevo con Developer y Express, 61/61 + E2E 105/105). El 12-nov esta comprobación estaba BLOCKED por falta de Docker.

## 4. Problemas de seguridad

| # | Sev. | Hallazgo | Estado |
|---|---|---|---|
| S1 | **ALTO** | Un handler `async` que fallaba fuera de un try/catch terminaba el proceso Node (Express 4 no captura promesas rechazadas). `GET /api/catalog/services/<id no UUID>` es público: una petición sin autenticar podía tumbar el catálogo | Corregido 12-nov (`utils/asyncRoutes.ts` en los 3 servicios); verificado hoy contra SQL Server real: 400 |
| S2 | MEDIO | `/uploads` se servía como carpeta estática con solo un JWT: cualquier usuario autenticado podía leer la imagen de un ticket ajeno conociendo el nombre del archivo | Corregido 12-nov (ruta retirada); verificado hoy: 404 |
| S3 | MEDIO | Android: el código SSO de un solo uso vuelve por un esquema propio que otra app puede declarar; quien lo capturaba podía canjearlo | Corregido 12-nov (verificador tipo PKCE, `lib/ssoPkce.ts` + `security/oauthState.ts`); incluido en el APK nuevo |
| S4 | MEDIO | Limitador de login: cada intento reservaba memoria por correo, sin tope y con limpieza cada 6 h | Corregido 12-nov |
| S5 | MEDIO | SSO: con `MICROSOFT_TENANT_ID=common/organizations` cualquier tenant podía presentar un correo institucional; no se comprobaba el `tid` del token | Corregido 12-nov (SSO se desactiva con autoridad multi-tenant; se valida `tid`) |
| S6 | MEDIO | Sin política de contenido (CSP) y el JWT vive en `localStorage` | Corregido 12-nov en la plantilla nginx; probado hoy a través de nginx con TLS en la simulación |
| S7 | BAJO | JWT sin algoritmo fijado; `JWT_SECRET` sin mínimo en ejecución | Corregido 12-nov (HS256, ≥32 en producción) |
| S8 | BAJO | Registros con el código de autorización y el `state` de la URL | Corregido 12-nov |
| S9 | BAJO | Gateway: origen no permitido → 500 con traza; error de proxy devolvía host interno | Corregido 12-nov |
| S10 | BAJO | SMTP: credenciales podían viajar sin TLS si el servidor no anunciaba STARTTLS | Corregido 12-nov (`SMTP_REQUIRE_TLS`) |
| S11 | BAJO | Android `allowBackup="true"` (el JWT entra en las copias del dispositivo) | Corregido 12-nov; verificado hoy en el APK con `aapt2` (`allowBackup=false`) |
| S12 | BAJO | Límite de login de nginx esquivable con `/API/AUTH/LOGIN` o barra final | Corregido 12-nov |
| S13 | BAJO | Textos sin tope; token FCM mayor que la columna → 500 | Corregido 12-nov; verificado hoy: 400 |
| S14 | BAJO | Plantilla histórica con contraseñas de laboratorio de ejemplo | Corregido 12-nov (marcadores) |
| S15 | **MEDIO** (nuevo) | **El gateway no era la autoridad CORS efectiva.** Los tres microservicios responden `Access-Control-Allow-Origin: *` (`cors()` por defecto) y el proxy copiaba esa cabecera encima de la del gateway: el navegador recibía `*` junto a `Access-Control-Allow-Credentials: true`, y la lista de orígenes permitidos (frontend, `https://localhost` de la app) no se aplicaba a las respuestas sin preflight. Detectado con el smoke del laboratorio (la cabecera devuelta era `*`) | **Corregido hoy** (`api-gateway/src/app.ts`: `proxyRes` elimina toda cabecera `Access-Control-*` del servicio interno) + test `corsAuthority.test.ts`; verificado en el laboratorio: `https://localhost` recibe su propio origen y un origen ajeno 403 |
| S16 | MEDIO (nuevo) | **Los contenedores Node corrían como root.** El 12-nov quedó como pendiente | **Corregido hoy**: `api-gateway` con `USER node`; en los tres servicios el entrypoint ejecuta `db push`/mantenimiento/seed como root y arranca el proceso que atiende peticiones con `setpriv` como `node`; ticket-service corrige al arrancar el propietario del volumen de imágenes (solo los archivos que no sean de `node`). Verificado: `docker top` muestra uid 1000 en los 4 contenedores, readiness 200, imágenes servidas, simulación completa 61/61 (incluida restauración de imágenes como root → servidas después por `node`) |
| S17 | BAJO (nuevo) | `POST /auth/users/lookup` pasaba cualquier cadena a `WHERE id IN (…)`: un valor que no es GUID hacía fallar la conversión a `uniqueidentifier` y toda la petición respondía 500 (sin inyección: la consulta es parametrizada) | **Corregido hoy** (solo UUID) + 2 tests; verificado en el laboratorio |
| S18 | BAJO (nuevo) | Destino de una notificación push: la app navegaba a `data.deepLink` tal cual. Lo envía el propio backend por Firebase, pero `react-router-dom` 6 tiene avisos de redirección abierta con `//` o `\` y la app no validaba el destino | **Corregido hoy** (`frontend/src/lib/deepLink.ts`: solo rutas internas `/…`, o `/tickets/<uuid>`) + 3 tests |
| S19 | BAJO | Dependencias npm con avisos (ver §13) | 41 de 48 corregidas el 12-nov; quedan 7 que exigen versión mayor y 7 avisos *low* del propio `jest` (solo desarrollo) |

**No se encontró**: XSS (React escapa; el reporte impreso, el historial impreso y los correos escapan todo valor con `esc()`), path traversal en adjuntos (`path.basename` + comprobación de prefijo), bypass de autenticación, secretos reales en el árbol actual, IDOR en tickets/historial/adjuntos/constancias (regla única `ticketAccess`: propietario, técnico del área o asignado, admin), ni fuga entre áreas (el técnico de la otra área recibe 403 en detalle, historial y adjuntos; verificado en el laboratorio y en el E2E).

**Escaneo de secretos del historial Git** (gitleaks 8 vía Docker, 60 commits de la rama): 4 coincidencias de la regla `generic-api-key`, todas falsos positivos: tres en `scripts/testing/backup-dr-simulation.sh:91` (credenciales deliberadamente INCORRECTAS de las pruebas negativas, en 3 commits) y una en `README.md:121` de un commit de septiembre (texto que ya no existe en el README actual). No hay claves, contraseñas ni tokens reales en el historial de esta rama. El repositorio público `ProyectoMetodologiasAgiles` sigue conservando en `origin/Develop` las contraseñas demo antiguas (fuera del alcance de esta rama; ver §13).

## 5. Problemas funcionales

| # | Sev. | Hallazgo | Estado |
|---|---|---|---|
| F1 | MEDIO | Los avisos push de "ticket nuevo" y "ticket escalado" nunca salían si quien actuaba no era admin (`GET /auth/technicians` exige admin → 403) | Corregido 12-nov (token interno de servicio + `GET /auth/internal/technicians`, no publicado) |
| F2 | MEDIO | Un ticket `pendiente_validacion` se podía escalar: desaparecía de la bandeja del solicitante sin que decidiera | Corregido 12-nov (409) |
| F3 | MEDIO | Dos tickets creados a la vez obtenían el mismo número y uno fallaba | Corregido 12-nov (reintento) |
| F4 | BAJO | Se podían añadir aportaciones a un ticket cerrado | Corregido 12-nov (409) |
| F5 | BAJO | Los listados devolvían adjuntos con la ruta interna `/uploads/…` | Corregido 12-nov; verificado hoy (7 adjuntos del laboratorio con URL `/api/tickets/…/attachments/…`) |
| F6 | BAJO | JSON mal formado o cuerpo grande respondían 500 | Corregido 12-nov (400 / 413); verificado hoy |
| F7 | **MEDIO** (nuevo) | **Dos "resolver" simultáneos sobre el mismo ticket** pasaban ambos las comprobaciones de estado y escribían los dos: dos eventos RESOLVED, dos artículos de conocimiento y el segundo pisaba `resolvedAt`/`knowledgeArticleId` del primero. El 12-nov se dejó pendiente porque un test fijaba la consulta | **Corregido hoy**: la escritura exige `status ∉ {resuelto, cerrado, pendiente_validacion}` y el mismo técnico asignado; si otra operación ganó, P2025 → 409 y no se registra nada. Test actualizado + test nuevo de conflicto |
| F8 | MEDIO (nuevo) | **El administrador podía reasignar un ticket `pendiente_validacion` o `resuelto`** (solo se bloqueaba `cerrado`): cambiaba al técnico responsable de una solución que el solicitante aún estaba validando, en contra de la regla "con solución enviada decide el solicitante" | **Corregido hoy** (409 en ambos casos, mismo criterio que el escalado) + 2 tests |
| F9 | BAJO (nuevo) | **El correo "solución lista para tu revisión" mostraba el estado interno `pendiente_validacion`** en lugar de una etiqueta legible (faltaba en `STATUS_LABEL` de las plantillas); lo mismo en `describeEvent` para un cambio de estado hacia ese valor ("undefined") | **Corregido hoy** + 3 tests |
| F10 | BAJO (nuevo) | Comparaciones de propietario/técnico con `!==` sobre GUID, mientras `ticketAccess` ya comparaba sin distinguir mayúsculas (`sameId`) | **Corregido hoy**: aportaciones, escalado y resolución usan `sameId` |
| F11 | BAJO (nuevo) | El frontend servía `index.html` con la caché por defecto de nginx: tras una actualización, un `index.html` antiguo apunta a assets con hash que ya no existen (pantalla en blanco hasta vaciar caché) | **Corregido hoy** (`Cache-Control: no-cache` en el fallback de la SPA; los assets versionados siguen con caché larga); verificado en el laboratorio |
| F12 | BAJO (nuevo) | El APK anterior (15-sep) tenía `versionCode 1`; un APK con las correcciones S3/S11 debe distinguirse e instalarse como actualización | **Corregido hoy**: `versionCode 2`, `versionName "1.1"`; APK debug generado (ver §14) |

## 6. Errores encontrados y 7. Causas raíz

- **S1/F6** — Express 4 no encadena promesas; el middleware de error convertía todo en 500. Solución: envoltura de routers (`asyncSafe`), validación de UUID antes de la base, red de seguridad del proceso y errores de cliente con su código real.
- **S15** — http-proxy copia las cabeceras del servicio interno DESPUÉS de que el gateway haya puesto las suyas, así que la decisión de `cors()` en el gateway se perdía. Solución: eliminar las cabeceras `Access-Control-*` del servicio en `proxyRes`; los servicios internos no se publican y no necesitan CORS propio.
- **S16** — Las imágenes `node:22-slim` arrancan como root y nada lo cambiaba. Solución: `setpriv` (util-linux, presente en la imagen) tras las tareas de arranque; el volumen de imágenes puede llegar con propietario root (versiones anteriores, restauración con `tar` como root), por eso el entrypoint lo corrige antes de bajar privilegios.
- **F1** — Una consulta de servicio a servicio se hacía con la identidad de la persona. Solución: token interno de 60 s (audiencia propia, sin `userId`) que ningún `verifyJwt` acepta como sesión.
- **F7/F8/F2/F3** — Comprobaciones de estado en memoria sin condición en la escritura (lectura → decisión → escritura). Solución: escrituras condicionadas por estado/técnico y numeración con reintento ante clave duplicada.
- **F9** — Un estado añadido en la Fase I (`pendiente_validacion`) no se propagó a dos tablas de etiquetas.
- **S17** — Prisma pasa el valor al parámetro `uniqueidentifier` y SQL Server rechaza la conversión; el error llegaba al manejador global como 500.

## 8. Archivos modificados

**Hoy (14-nov):**
- `api-gateway/src/app.ts` (cabeceras CORS del servicio interno), `api-gateway/Dockerfile` (`USER node`).
- `auth-service/src/routes/authRoutes.ts` (lookup solo UUID), `auth-service/docker/entrypoint.mssql.sh`, `auth-service/tests/insecureLoginGuard.test.ts` (tiempo de espera), `auth-service/tests/securityHardening.test.ts` (+2 tests).
- `catalog-service/docker/entrypoint.mssql.sh`.
- `ticket-service/src/routes/assignmentRoutes.ts` (resolución condicionada, `sameId`), `ticket-service/src/routes/adminRoutes.ts` (guardas de asignación), `ticket-service/src/services/historyService.ts` y `emailTemplates.ts` (etiqueta), `ticket-service/docker/entrypoint.mssql.sh`, tests `ticketResolve`, `ticketAssignment`, `ticketHistory`.
- `frontend/src/lib/pushNotifications.ts` (usa `deepLink.ts`), `frontend/nginx.conf`, `frontend/android/app/build.gradle` (versión).

**12-nov (sin commitear, revisados hoy):** `auth-service/src/{app,index}.ts`, `config/env.ts`, `routes/authRoutes.ts`, `services/authService.ts`, `security/{loginRateLimiter,oauthState,ssoCodeStore,securityLog}.ts`, `utils/jwt.ts`; `catalog-service/src/{app,index}.ts`, `config/env.ts`, `middleware/verifyJwt.ts`, `routes/*`; `ticket-service/src/{app,index}.ts`, `config/env.ts`, `middleware/{verifyJwt,upload}.ts`, `routes/*`, `services/{authClient,storageService,emailService}.ts`; `api-gateway/src/app.ts`; `frontend/src/App.tsx`, `lib/{session,ssoMobile}.ts`, `android/app/src/main/AndroidManifest.xml`; `deploy/nginx/servicedesk.conf.template`, `deploy/server/compose.yaml`, `.env.example`, `docs/history/config/env.mssql.example`; `package-lock.json` de los cinco componentes (`package.json` sin cambios).

## 9. Archivos creados

**Hoy:** `frontend/src/lib/deepLink.ts`, `frontend/tests/deepLink.test.ts`, `api-gateway/tests/corsAuthority.test.ts`, `ticket-service/tests/emailTemplatesLabels.test.ts`; paquete `release/servicedesk-uta-server-1.0.0-rc5.tar.gz` (+ `.sha256`, `MANIFEST.md`, `FILES.txt`; `release/` está ignorado por Git); APK `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (ignorado por Git).

**12-nov:** `{auth,catalog,ticket}-service/src/utils/asyncRoutes.ts`, `auth-service/src/security/serviceToken.ts`, `api-gateway/src/logging/redact.ts`, `frontend/src/lib/ssoPkce.ts`, tests `auth-service/tests/securityHardening.test.ts`, `catalog-service/tests/robustness.test.ts`, `ticket-service/tests/securityHardening.test.ts`, `api-gateway/tests/gatewayHardening.test.ts`, `frontend/tests/ssoPkce.test.ts`.

Sin seguimiento en Git desde fases anteriores (pendientes de commit, no tocados hoy): `.gitattributes`, `docs/history/phases/FASE_X_REPORTE_FINAL_RC3.md`, `docs/history/phases/FASE_Y_REPORTE_SEGURIDAD_RELEASE.md`, `docs/manual-tecnico/`.

## 10. Migraciones necesarias

**Ninguna** para aplicar estos cambios: ningún cambio altera los esquemas Prisma; `prisma db push` en el arranque no hará nada. Recomendadas para una fase posterior (no ejecutadas, requieren ventana y backup previo): `tickets.location` → `NVarChar(255)` (Unicode) y un índice sobre `tickets.resolved_by_id`.

## 11. Tests ejecutados y 12. Resultados

| Comprobación | Resultado |
|---|---|
| Tests auth / catalog / tickets / gateway / frontend | **PASS** 97 / 84 / 307 / 13 / 38 = 539 (ejecución secuencial final, 0 fallos) |
| Roles, bloques, autorización por área, aceptación digital, imágenes, reportes, SSO (state, código, verificador, tenant), FCM (suites existentes + nuevas) | PASS |
| Prisma validate (3 esquemas) y `schema.prisma == schema.mssql.prisma` | PASS |
| TypeScript `tsc --noEmit` en los 4 backends; `tsc -b` + `vite build` en frontend | PASS |
| `docker compose config` del servidor nuevo (con valores ficticios) y del laboratorio | PASS |
| Build de las 5 imágenes Docker del laboratorio y arranque 6/6 healthy con procesos Node sin root | PASS |
| Smoke de solo lectura contra el laboratorio (SQL Server 2022 real): salud, readiness, CORS, rutas internas, 401/403/404/410/413, catálogo, dev-login por rol, aislamiento de áreas en bandejas y adjuntos, adjunto autenticado 200/403, estadísticas T-SQL, reportes de técnico y bloque, términos v1.0, lookup, logout revoca sesión | **PASS 48/48** |
| **Simulación de servidor nuevo** (`scripts/testing/new-server-simulation.sh`, paquete generado desde este árbol): guardas del instalador, instalación limpia con secretos generados, bootstrap del admin sin filtrar la contraseña temporal, arquitectura (imágenes fijadas, volúmenes separados, SQL sin root, puertos solo loopback, redes aisladas, readiness real, caída/recuperación de SQL, restart policy), nginx con TLS + plantilla real, E2E, backup local + verificación, persistencia (restart y down/up), **restauración en otro proyecto con credenciales nuevas y SQL Server Express**, guardas contra mezcla de modos | **PASS 61/61** |
| **E2E funcional** (`scripts/testing/smoke-e2e.mjs`, NODE_ENV=production): login, catálogo, ticket con 2 imágenes, enrutamiento por área, aceptar, aportar, reescalar a otra área, resolver con KB nuevo, validación del usuario (403 ajeno, 400 sin motivo, rechazo, aceptación, 409 repetido), resolver con KB existente, historial, autorización de imágenes, knowledge, estadísticas, EmailOutbox, registro FCM | **PASS 105/105** (ticket de prueba creado y destruido con el proyecto de simulación) |
| Backup `backup-mssql.sh` (BACKUP + CHECKSUM + VERIFYONLY + SHA-256) y `check-backup.sh` | PASS (en la simulación) |
| Restauración `restore-mssql.sh` + imágenes + re-mapeo de logins + conteos = origen | PASS (en la simulación) |
| **Simulación DR de backups cifrados** (`scripts/testing/backup-dr-simulation.sh`: Restic + MinIO, cifrado, retención, manipulación, custodia, drill, desastre) | ver §12b |
| CSP con backend real (impresión de un reporte real en navegador) | NOT TESTED (el 12-nov se probó la CSP con 8 pantallas y API simulada; hoy nginx+TLS en la simulación pasa el smoke, pero no se imprimió un reporte real) |
| Build Android (`cap sync` + `gradlew assembleDebug`, JDK 21, Gradle 8.14.3, AGP 8.13) | **PASS** (APK generado; ver §14) |
| APK en dispositivo físico: login, SSO, imágenes, push, deep link | **NOT TESTED** (sin dispositivo) |
| SSO real de Microsoft contra el tenant institucional, FCM real, SMTP real | NOT TESTED (requieren credenciales/servicios externos; el código del flujo está cubierto por tests con MSAL simulado) |
| Gitleaks sobre el historial de la rama | PASS (4 falsos positivos documentados en §4) |
| `npm audit` (5 componentes) | ver §13 |
| Ubuntu 24.04 real, systemd, certbot, UFW, SSH del host | NOT TESTED (la simulación usa `--test-mode`, que omite esos pasos) |

### 12b. Simulación DR de backups cifrados

Ejecutada dos veces el 15-nov (hora UTC) sobre el laboratorio local como origen y un MinIO aislado como S3:

- **Ejecución 1: 59 OK · 1 FALLO.** La única comprobación fallida fue "Laboratorio de origen intacto": los conteos de `sessions` y `auth_logs` al final no coincidían con los del inicio. Causa verificada: el propio auditor ejecutó el smoke de solo lectura del laboratorio a las 04:45:10Z (4 `dev-login` + 1 logout, registrados en `auth_logs`), entre la toma de conteos inicial y el backup de las 04:48Z. No es un fallo del sistema de backups: los 59 pasos de cifrado, verificación, retención, manipulación, custodia, drill y desastre pasaron.
- **Ejecución 2 (sin actividad concurrente): 60 OK · 0 fallos — PASS.** Incluye: repositorio Restic con TLS y usuario S3 limitado; diagnóstico de 8 errores (clave, credenciales, endpoint, TLS, http, configuración); backup completo cifrado con `BACKUP WITH CHECKSUM` + `VERIFYONLY` + SHA-256 y manifest sin secretos; `restic check` rápido, 5 % y completo; deduplicación; ningún texto plano en el bucket (con control positivo); retención 14/8/12 sobre 400 snapshots sintéticos con salvaguardas; detección de paquetes alterados y rechazo de la restauración; clave independiente del custodio y rotación/revocación de la clave del servidor; restore drill (CHECKDB, 13 conteos, 14 relaciones, imágenes) y drill negativo; **desastre**: servidor nuevo desde el paquete + clave del custodio → 3 bases, 10 imágenes (SHA-256 idéntico), login, cambio de contraseña, historial, 401 sin token; persistencia tras reinicios y backup propio del servidor recuperado; ningún secreto en logs; laboratorio de origen intacto.
- Backblaze B2 **no** está configurado (sin credenciales reales no se declara activo ningún backup externo); la cobertura real es la del laboratorio S3. Los recursos de prueba se eliminaron con `--cleanup`.

## 13. Problemas pendientes

- **ALTO** — El repositorio público `ProyectoMetodologiasAgiles` conserva en `origin/Develop` contraseñas demo y correos personales; el VPS anterior sigue sin parchear (incluido S1, que permite tumbar el catálogo sin autenticarse). Decisión y acceso del responsable; no se tocó nada remoto.
- **MEDIO** — Dependencias que exigen versión mayor (`npm audit`, 14-nov): `zod` 3.24 → 4 (*high*: agotamiento de memoria con colecciones acotadas enormes; mitigado porque los cuerpos están limitados a 32 kB en auth y 100 kB en los demás, y las listas a 20 elementos), `nodemailer` 8 → 10 (*high*: opciones `raw`/`resolveContent` que el proyecto no usa), `@azure/msal-node` 2 → 7 (*moderate*, vía `uuid`), `react-router-dom` 6 → 7 (*moderate*, redirección abierta con `//` y `\`: mitigado en S18 para el único destino externo), `vite`/`esbuild` (*high*/*moderate*, solo servidor de desarrollo, no se despliega). Los 7 avisos *low* restantes son de `jest`/`ts-jest` (solo desarrollo) y el "arreglo" que propone npm es un downgrade incoherente. Planificar las actualizaciones mayores con sus pruebas.
- **MEDIO** — Logotipos oficiales: `frontend/public/branding/uta-logo.png` y `fisei-logo.png` no existen; el encabezado de los reportes sale solo con texto hasta que la institución entregue los archivos oficiales (el código no inventa ni redibuja logotipos).
- **BAJO** — Un ticket `pendiente_validacion` que el solicitante nunca valida permanece así indefinidamente (no hay recordatorio ni expiración). Decisión funcional.
- **BAJO** — El outbox de correo solo se reintenta a mano (`POST /admin/email-outbox/process`).
- **BAJO** — `GET /services` y `/locations` son públicos por diseño (los tests y el smoke de instalación lo fijan); `includeInactive=true` no exige admin.
- **BAJO** — El bloque no limita el acceso a tickets (decisión vigente del responsable).
- **BAJO** — Introspección de sesión en ticket/catalog con caché de 30 s: tras un logout, un JWT sigue siendo aceptado en esos servicios hasta 30 s (en producción `AUTH_INTROSPECTION=true`; auth-service lo revoca al instante).
- Texto de los términos v1.0 sin aprobación institucional (la constancia se presenta como aceptación digital interna, no como firma electrónica certificada); Backblaze B2 sin configurar; custodios de claves sin designar.
- Documentación: el cambio de nombre de versión (`versionCode 2`), las variables `SMTP_REQUIRE_TLS`, la ejecución sin root y el paquete RC5 deben reflejarse en `docs/CONTEXTO_MAESTRO_SERVICEDESK.md` y en el manual técnico cuando se consolide la fase (se añadió una nota al contexto maestro).

## 14. Estado del APK

- **Generado hoy** (local): `frontend/android/app/build/outputs/apk/debug/app-debug.apk`, 5 964 520 bytes, MD5 `5e3b5d68141a85ee3f5311bdaa05fa4e`, `versionCode 2`, `versionName 1.1`, `targetSdk 36`, `minSdk 24`. Contiene el bundle `index-CEdSremI.js` compilado con `VITE_API_URL=https://servicedesk-uta.site` (el dominio de producción actual): incluye el verificador SSO (`sd_sso_verifier`), la carga autenticada de imágenes (`createObjectURL`), 0 apariciones de `/uploads/` y de `localhost:8080`. Manifest verificado con `aapt2`: `allowBackup=false`, esquema `ec.uta.servicedesk`, permisos INTERNET, POST_NOTIFICATIONS, VIBRATE, WAKE_LOCK (+ los que añade Firebase). El APK anterior (15-sep, MD5 `b95634a3…`) quedó sobrescrito en esa ruta.
- Es un **APK de depuración** (`debuggable=true`, firmado con la keystore de depuración): sirve para pruebas internas, **no para distribución**. No hay keystore ni configuración de release en el repositorio, y `minifyEnabled` es false.
- **NOT TESTED en dispositivo.** Pendiente: instalar en un teléfono, login local, SSO Microsoft con el verificador (la app antigua sin `cc` sigue funcionando), detalle con imágenes y lightbox, push y deep link.
- Cuando el servidor nuevo tenga dominio, el APK debe reconstruirse con ese `VITE_API_URL` y el redirect URI registrado en Azure.

## 15. Estado del instalador

`scripts/install-server.sh` no se modificó. Revisado y ejecutado en la simulación: valida secretos y su fortaleza, exige edición de SQL Server coherente con `SERVER_PURPOSE`, modos limpio/restauración excluyentes, no siembra sobre datos restaurados, bootstrap del administrador con contraseña temporal en archivo 0600 (no aparece en logs, `.env` ni entorno), endurece el host (daemon.json, UFW, SSH solo con clave si hay clave autorizada, logrotate), instala nginx y los timers de backup.

**Paquete nuevo:** `release/servicedesk-uta-server-1.0.0-rc5.tar.gz` (580 KB, 232 archivos, SHA-256 `234ba9e8f8cd7a7e…`, en `release/servicedesk-uta-server-1.0.0-rc5.tar.gz.sha256`). Generado desde este árbol con LF, sin `.env`, sin secretos locales, sin PostgreSQL, sin tests ni cuentas demo. El paquete equivalente generado por la simulación (mismo árbol) superó la instalación limpia, el E2E y la restauración. **RC4 no incluye las correcciones del 12 ni del 14 de noviembre: usar RC5.**

## 16. Preparación del nuevo servidor

Listo en código y verificado en Docker local; falta la verificación en Ubuntu Server 24.04 real (systemd, nginx 1.24, certbot, UFW, SSH). Requisitos y decisiones que debe aportar el responsable:

1. Dominio público y certificado (certbot con webroot; la plantilla ya recarga nginx al renovar).
2. Edición y licencia de SQL Server (`MSSQL_PID`): Developer solo con `SERVER_PURPOSE=pruebas`; para producción Express/Standard/clave.
3. `MICROSOFT_TENANT_ID` = **identificador (GUID) del tenant institucional** (con `common`/`organizations` el SSO queda desactivado por diseño), `MICROSOFT_REDIRECT_URI` = `https://<dominio>/auth/callback` registrada en Azure, `ADMIN_EMAILS` opcional.
4. SMTP institucional (`EMAIL_SEND_MODE=smtp`; STARTTLS se exige por defecto cuando hay credenciales) y, si se usará push, cuenta de servicio de Firebase (`FCM_MODE=firebase`).
5. Backups externos: bucket B2 + Application Key limitada + clave Restic con custodia (`/etc/servicedesk/backup.env`, fuera del `.env`). Hasta entonces el backup diario termina con código 3 (alerta) y queda solo la copia local.
6. Logotipos oficiales en `frontend/public/branding/` antes de construir la imagen del frontend.

## 17. Recomendaciones finales

1. Revisar y confirmar estos cambios y hacer el commit (sin push hasta decidirlo); hacer privado el repositorio público o purgar su historial.
2. Instalar RC5 en el servidor nuevo con `--mode clean` (o `--mode restore --from <backup del VPS>`), y repetir allí `scripts/operations/smoke-server.sh` y `server-health.sh`.
3. Probar en el servidor real: SSO Microsoft (web y Android), SMTP, FCM y la impresión de un reporte con la CSP activa.
4. Probar el APK en un dispositivo y, para distribuirlo, crear una keystore de release custodiada.
5. Aplicar al VPS anterior al menos el parche S1 (o retirarlo del servicio) y rotar sus credenciales; nunca `down -v`.
6. Planificar las actualizaciones mayores de dependencias (`zod`, `nodemailer`, `msal-node`, `react-router-dom`, `vite`) con sus pruebas.
7. Entregar los logotipos oficiales y el texto aprobado de los términos de aceptación (nueva versión, nunca editar la 1.0 publicada).
