# FASE R — Correcciones funcionales, autorización y seguridad

**Fecha:** 2026-11-04 · **Rama:** `Develop` (sin commit, sin push)
**Alcance:** repositorio local, SQL Server del laboratorio y entornos Docker locales aislados. **El VPS no se tocó.**
**Motor:** SQL Server 2022, único. PostgreSQL no se usó.

Escrito para: el equipo del proyecto (Tech Lead y docente supervisor). Sin secretos.

Leyenda: **PASS** = ejecutada y aprobada · **FAIL** = ejecutada y fallida · **BLOCKED** = no ejecutable por falta de infraestructura o credenciales · **NOT TESTED** = no realizada.

---

## 1. Hallazgos originales (Fase Q)

| # | Hallazgo | Gravedad |
|---|---|---|
| R1 | `GET /tickets/history/:id`: cualquier técnico veía tickets de la otra área, con eventos internos | Alta |
| R2 | `GET /tickets/:id` y el endpoint de adjuntos: mismo problema | Alta |
| R3 | `PATCH /tickets/:id/status`: cerraba o resolvía tickets **saltándose la validación del usuario** | Alta |
| R4 | Endpoints del modelo por nivel (N1–N4) que autorizaban por nivel y no por área | Media |
| R5 | Sin roles diferenciados para DTIC y Técnicos (el área se deducía de `tech_n1..n4`) | Alta (requisito) |
| R6 | Sin tests de acceso entre áreas | Media |
| A | El JWT del SSO viajaba en la query string, y por tanto quedaba en los logs de nginx | Alta |
| B | `sessions` guardaba el JWT completo; logout y revocación no afectaban a ticket ni catalog | Alta |
| C | `INITIAL_ADMIN_PASSWORD` persistía en `.env` y en el contenedor; `ADMIN_EMAILS` traía correos reales por defecto | Media |
| D | Sin limitación de intentos de login en la aplicación | Media |
| E | El tipo de imagen se tomaba del MIME declarado; no había compresión ni manejo de HEIC | Media |
| F | UFW, SSH, el daemon de Docker y el hook de certbot solo estaban documentados | Media |
| G | Tras aceptar la solución el ticket quedaba en `resuelto` y no en `cerrado` | Funcional |

## 2. Causas raíz

- **R1–R4:** convivían dos modelos de autorización. El antiguo por nivel nunca se retiró del backend cuando la interfaz pasó al modelo por área, y la lectura de tickets solo comprobaba si el usuario era "personal".
- **R5:** el área se codificaba en el nombre del rol; no había una identidad propia de DTIC.
- **A:** el callback de Microsoft redirigía con `?token=<JWT>`.
- **B:** las sesiones se guardaban por el valor literal del token, y los demás servicios solo verificaban la firma.
- **C:** el admin inicial se creaba desde el seed leyendo una contraseña del entorno.
- **D–F:** no estaban implementados.
- **G:** el endpoint `user-accept` escribía `resuelto`, aunque su mensaje decía "Ticket cerrado".

## 3. Soluciones (resumen)

| Problema | Solución | Archivos principales |
|---|---|---|
| R5 | Roles oficiales `admin`, `technician`, `dtic`, `user`; normalización de los heredados; migración al arrancar | `auth-service/src/domain/enums.ts`, `src/maintenance/*`, `ticket-service/src/services/areaService.ts`, `catalog-service/src/middleware/verifyJwt.ts`, `frontend/src/lib/auth.ts` |
| R1, R2 | Regla única `ticketAccess` (admin / técnico del área / técnico asignado / propietario) | `ticket-service/src/services/areaService.ts`, `routes/ticketRoutes.ts` |
| R3, R4 | 6 endpoints heredados → **410 Gone** (sin autenticación previa ni acceso a BD) | `ticket-service/src/routes/ticketRoutes.ts`, `routes/routingRoutes.ts` |
| G | Aceptar → **`cerrado`** (`USER_ACCEPTED`: `pendiente_validacion → cerrado`) | `ticket-service/src/routes/assignmentRoutes.ts`, `services/historyService.ts` |
| A | Código opaco de un solo uso + `POST /auth/sso/exchange` (web y Android) | `auth-service/src/security/ssoCodeStore.ts`, `routes/authRoutes.ts`, `frontend/src/lib/session.ts`, `pages/AuthCallback.tsx`, `lib/ssoMobile.ts`, `App.tsx` |
| B | `sessions` guarda solo el SHA-256; conversión de las sesiones existentes; purga; introspección en ticket y catalog | `auth-service/src/utils/jwt.ts`, `middleware/verifyJwt.ts`, `services/authService.ts`, `maintenance/maintenance.ts`, `ticket-service/src/middleware/verifyJwt.ts`, `catalog-service/src/middleware/verifyJwt.ts` |
| C | Bootstrap del admin con contraseña temporal (solo hash en BD, archivo 0600, cambio obligatorio, no crea un segundo admin); `reset-password`; `ADMIN_EMAILS` vacío por defecto | `auth-service/src/maintenance/bootstrapAdmin.ts`, `scripts/operations/manage-user.sh`, `frontend/src/pages/CambiarContrasena.tsx`, `auth-service/prisma/seed.ts` |
| D | Limitador por IP y por cuenta con enfriamiento progresivo; tiempo constante; eventos `[security]`; el gateway reenvía la IP real | `auth-service/src/security/loginRateLimiter.ts`, `securityLog.ts`, `app.ts` (`trust proxy`), `api-gateway/src/app.ts` (`xfwd`) |
| E | Compresión en el cliente (≤ 1920 px, JPEG 0.8, PNG con alfa, WebP, HEIC rechazado); validación por bytes en el backend | `frontend/src/lib/imageCompression*.ts`, `pages/NuevoTicket.tsx`, `ticket-service/src/services/imageType.ts`, `middleware/upload.ts`, `routes/ticketRoutes.ts` |
| F | UFW, endurecimiento de SSH (solo si hay una clave autorizada, validado con `sshd -t`), `daemon.json`, logrotate, hook de certbot, `no-new-privileges` | `deploy/{ssh,docker,logrotate,certbot}/`, `scripts/install-server.sh`, `deploy/server/compose.yaml` |

## 4. Roles definitivos

| Rol | Área | Tickets | Admin | KB |
|---|---|---|---|---|
| `admin` | Técnicos y DTIC | Todos | Sí | Consulta y edición |
| `technician` | TECHNICIANS | Los de su área y el que tenga asignado | No | Consulta |
| `dtic` | DTIC | Los de su área y el que tenga asignado | **No** | Consulta |
| `user` | — | Solo los suyos (eventos públicos) | No | No |

La base de conocimiento se mantiene **compartida** por todo el personal. Es conocimiento institucional, no información restringida de un área. Su edición sigue siendo exclusiva de `admin`.

## 5. Migración de usuarios

- **Mecanismo:** `auth-service/src/maintenance/run.ts` se ejecuta en cada arranque, tras `prisma db push`, y es idempotente:
  - `UPDATE dbo.users SET role=@P1 WHERE role=@P2` por cada rol heredado;
  - conversión de las sesiones con JWT en claro a `SHA2_256`;
  - purga de sesiones caducadas o revocadas hace más de 7 días.
  - No borra usuarios, no cambia IDs y no toca otras tablas.
- **Compatibilidad:** los JWT emitidos antes de la migración llevan roles `tech_n*`; los tres servicios y el frontend los **normalizan** (n1/n2 → technician, n3/n4 → dtic, valor desconocido → user). Un backup restaurado de una versión anterior se migra solo al arrancar.
- **Esquema:** solo cambios **aditivos**:
  - `users.must_change_password BIT DEFAULT 0`;
  - el campo Prisma `tokenHash` **reutiliza la columna `token`** existente mediante `@map`.

  No hay ninguna operación con pérdida de datos. Funciona con `PRISMA_ACCEPT_DATA_LOSS=false`.

**Prueba real sobre los datos del laboratorio (PASS)**, con backup previo en `scratchpad/lab-backup-preR/` (VERIFYONLY + SHA-256):

| | Antes | Después |
|---|---|---|
| Roles | admin 2 · tech_n1 2 · tech_n2 1 · tech_n3 2 · tech_n4 1 · user 3 | **admin 2 · technician 3 · dtic 3 · user 3** |
| Usuarios / huella SHA-256 de (id, correo) | 11 / `c175015bb0b6a20a` | 11 / **`c175015bb0b6a20a`** |
| Sesiones | 373 (0 con hash), 10 activas | 373 convertidas, 360 caducadas purgadas, 13 restantes (13 con hash), **10 activas conservadas** |
| Sesión de muestra: SHA-256 en Node / valor tras la migración T-SQL | `9c5c6b9017970ddf` | **`9c5c6b9017970ddf`** (64 caracteres) |
| tickets / eventos / adjuntos / KB / auth_logs | 7 / 20 / 5 / 34 / 373 | **7 / 20 / 5 / 34 / 373** |

Smoke del laboratorio tras la migración: 22/22.

## 6. Endpoints modificados

| Endpoint | Cambio |
|---|---|
| `GET /tickets/history/:id`, `GET /tickets/:id`, `GET /tickets/:id/attachments/:aid` | Autorización por `ticketAccess` |
| `POST /tickets/:id/user-accept` | Estado final `cerrado` |
| `POST /tickets` | Validación del tipo real por bytes (415 si no es JPEG/PNG/WebP; HEIC con mensaje); se guardan el MIME detectado y la extensión correcta |
| `GET /tickets`, `GET /tickets/level`, `PUT /tickets/escalate`, `PATCH /tickets/:id/status`, `POST /routing/assign`, `POST /routing/preview` | **410 Gone** |
| `GET /admin/technicians/summary` | `byArea` (Técnicos / DTIC) en lugar de `byBlock` |
| `POST /auth/login` | Limitación de intentos (429), `mustChangePassword`, rol normalizado |
| `GET /auth/microsoft/callback` | Redirige con `?code=` (sin JWT) |
| `POST /auth/sso/exchange` | **Nuevo**: canje del código de un solo uso |
| `POST /auth/change-password` | **Nuevo**: cambio de contraseña (obligatorio con contraseña temporal) |
| `POST /auth/microsoft-simulate`, `/auth/dev-login` | 404 en producción (Fase P, se mantiene) |
| `POST /auth/verify` | Rechaza tokens con `pwdChange` (403); lo usan ticket y catalog |

**Consumidores revisados antes de retirar endpoints:** la web y el APK usan el mismo bundle; las únicas páginas que llamaban a los endpoints por nivel (`PanelTecnico.tsx`, `BandejaTickets.tsx`) **no estaban enrutadas** y se movieron a `archive/frontend-legacy/`.

## 7. Aislamiento entre áreas

Probado con tests automatizados (`ticket-service/tests/areaIsolation.test.ts`) **en los tres endpoints** y en Docker real (E2E):

| Caso | Esperado | Resultado |
|---|---|---|
| technician → ticket de Técnicos | permitido | PASS |
| technician → ticket DTIC | 403 | PASS |
| dtic → ticket DTIC | permitido | PASS |
| dtic → ticket de Técnicos | 403 | PASS |
| propietario → su ticket | permitido | PASS |
| otro usuario → ticket ajeno | 403 | PASS |
| usuario no autorizado → adjuntos | 403 | PASS |
| técnico de la otra área pero asignado | permitido | PASS |
| solicitante → eventos internos | ocultos | PASS |
| técnico de la otra área → no se consulta la BD de eventos | sin consulta | PASS |
| rol heredado `tech_n3` | se trata como `dtic` | PASS |
| `dtic` → endpoints de administración (5) | 403 | PASS |
| técnico de la otra área → aceptar el ticket | 403 | PASS (E2E) |

## 8. Sesiones
SHA-256 del JWT en `sessions`; búsqueda por hash; comprobación de expiración y revocación; purga periódica (al arrancar y cada 6 h). Introspección desde ticket y catalog con caché de 30 s que **falla cerrado** (503) si auth no responde. Tests PASS: hash al crear, logout → 401, sesión expirada → 401, sin sesión → 401, introspección (activa / revocada / auth caído). E2E PASS: tras el logout, ticket **y** catalog rechazan el token.

## 9. Login
Limitación por IP (20/15 min) y por cuenta (5 fallos → enfriamiento de 1, 2, 4… hasta 15 min; nunca permanente; un acceso correcto lo reinicia). Mensaje genérico idéntico exista o no la cuenta; tiempo constante con un hash bcrypt ficticio; `Retry-After`; eventos `[security]` con el correo enmascarado. Tests PASS (incluido el reloj simulado). E2E PASS (429 tras fallos reales).

## 10. Microsoft SSO
El callback emite un código opaco de 256 bits, de un solo uso y con 60 s de vida (solo se guarda su SHA-256). Se canjea con `POST /auth/sso/exchange`. Web: `AuthCallback` canjea el código y lo borra de la barra de direcciones. Android: `ssoMobile` y `App.tsx` lo canjean desde el deep link `?code=`. Tests PASS con MSAL simulado (web y Android sin JWT en la URL, canje único, código caducado o malformado). **Login real con Azure: BLOCKED** (sin credenciales de prueba).

## 11. Imágenes
- **Cliente:** máximo 1920 px, JPEG 0.8, PNG si hay transparencia, WebP admitido, HEIC rechazado con instrucciones, orientación EXIF respetada y metadatos eliminados al recodificar.
  - Prueba en **Chrome real** (headless, DevTools Protocol): JPEG 4032×3024 (523 KB) → 1920×1440 (158 KB); PNG transparente → PNG 1920×960; WebP → JPEG; HEIC y un PDF disfrazado → rechazados. **PASS**.
  - Reglas puras: 6/6 con `node --test`.
- **Backend:** tipo real por bytes; JPEG declarado como PNG → se guarda `image/jpeg` con extensión `.jpg`; texto disfrazado → 415 sin crear el ticket y sin dejar el archivo; HEIC → 415/400 con mensaje. **PASS**.
- Se mantienen el endpoint autenticado, el JWT, los permisos, el Content-Type y el lightbox (E2E PASS). No se eliminó ninguna imagen existente.

## 12. Backups
Sin cambios de diseño respecto a la Fase P. Re-verificado en esta fase: backup de las 3 bases e imágenes, `RESTORE VERIFYONLY`, SHA-256, código 3 sin copia externa, `check-backup.sh` y restauración en otro proyecto (ver §14). Cifrado, S3 y retención mensual quedan para la **Fase S**. **La copia externa NO está configurada**: no hay proveedor.

## 13. Infraestructura (preparada, no aplicada a ningún servidor)

| Elemento | Validación local |
|---|---|
| UFW (SSH/80/443, configurable con `--ssh-port`) | NOT TESTED (requiere un host real) |
| `deploy/ssh/99-servicedesk-hardening.conf` | `sshd -t` en Ubuntu 24.04 **PASS** (`passwordauthentication no`, `permitrootlogin without-password`, `maxauthtries 3`) |
| `deploy/docker/daemon.json` | `dockerd --validate` **PASS** |
| `deploy/logrotate/servicedesk` | `logrotate -d` en Ubuntu 24.04 **PASS** |
| Hook de certbot `servicedesk-reload-nginx.sh` | `sh -n` **PASS**; ejecución real NOT TESTED |
| `no-new-privileges` en los 6 servicios | `docker compose config` **PASS** (6 ocurrencias); servicios healthy en la simulación |
| Puertos solo en 127.0.0.1 / SQL Server sin publicar | **PASS** (Fase P, re-verificado) |

## 14. Tests

| Prueba | Resultado |
|---|---|
| auth-service | **57/57 PASS** (34 anteriores + 23 nuevos: sesiones, login, SSO, roles, migración, bootstrap, unicidad de tokens) |
| catalog-service | **67/67 PASS** (52 + 15 de roles) |
| ticket-service | **242/242 PASS** (ver nota) |
| frontend (reglas de compresión) | **6/6 PASS** |
| **Total** | **372/372 PASS** |
| `prisma validate` (×6) y `prisma generate` (×3); schemas idénticos | PASS |
| `tsc` de los 5 proyectos y build de backend y frontend | PASS |
| Migración real sobre datos del laboratorio | PASS (§5) |
| Smoke del laboratorio | PASS 22/22 |
| Compresión en Chrome real | PASS (§11) |
| Simulación de servidor nuevo + E2E | ver §14.1 |
| APK en dispositivo | NOT TESTED (el APK debe reconstruirse con el frontend nuevo; se hará en la Fase V) |
| SSO / FCM / SMTP reales | BLOCKED (sin credenciales) |

**Nota sobre ticket-service:** se retiraron los tests que probaban el comportamiento de los endpoints por nivel, ahora eliminado: los archivos `ticketEscalate`, `ticketLevelRoute` y `routingRoutes`, y los casos de `PATCH /status` y `GET /level` de `ticketHistory`. Su contenido sigue en el historial de git. Se reescribió 1 caso (el técnico de otra área ahora recibe 403) y se añadieron **88 casos en 4 archivos nuevos**: `areaIsolation` 43, `legacyEndpointsGone` 32, `uploadAndLifecycle` 10 y `sessionIntrospection` 3. Total actual: **242**.

### 14.1 Simulación de servidor nuevo (desde el paquete, Express, `NODE_ENV=production`)

Instalada desde un paquete recién generado y extraído en un directorio vacío, en proyectos Docker aislados (`sdsimclean`, `sdsimrestore`), con secretos nuevos y **SQL Server Express Edition (64-bit)**. Ejecución final en una sola pasada: **SIMULACIÓN 37/37 PASS · E2E 82/82 PASS**.

| Área | Comprobado (PASS) |
|---|---|
| Paquete | SHA-256; sin `.env` reales |
| Guardas del instalador | Sin `--mode` → rechazado; `MSSQL_PID=Developer` / vacío → BLOQUEADO; reinstalar encima y restaurar sin `--replace` → rechazados |
| Bootstrap del admin | Secreto en archivo dedicado; **no aparece** en la salida del instalador, en el `.env` ni en el entorno del contenedor; no crea un segundo admin (exit 3) |
| Contraseña temporal (E2E) | El login exige cambio; el token temporal es rechazado por ticket y catalog (403); contraseña débil → 400; cambio → 200; la temporal deja de valer |
| Aislamiento (E2E) | Técnicos → historial, detalle, imagen y aceptar un ticket DTIC: **403** |
| Ciclo de vida (E2E) | Crear (2 imágenes) → aceptar → contribuir → reescalar → aceptar en destino → resolver → rechazo con motivo → re-resolver → aceptar → **cerrado**; 409 al repetir; `PATCH /status` → 410 |
| Imágenes (E2E) | 401/200 (bytes íntegros)/200/200/403; archivo falso → **415** |
| Sesiones | Base: **8/8 sesiones como SHA-256**; logout → ticket y catalog responden **401** |
| Login (E2E) | 5 fallos → **429**; mensaje idéntico exista o no la cuenta; código SSO inválido → 400 |
| Roles en BD | Solo oficiales (`admin=1 dtic=1 technician=1 user=2`); sin cuentas demo |
| nginx | `nginx -t`, smoke 14/14 por TLS, `/uploads/` → 404, HSTS |
| Backup y persistencia | VERIFYONLY + SHA-256; sin copia externa → código 3; `restart` y `down`/`up` con datos idénticos e imagen servida |
| Restauración | Credenciales independientes; conteos = origen (`users=5 services=8 kb=28 tickets=2 events=10 attachments=3 outbox=6 devices=1`); login de un usuario y del admin (con su contraseña ya cambiada); imagen restaurada servida |

### 14.2 Incidencias durante las pruebas

1. **Bug real de la aplicación (corregido):** dos sesiones del mismo usuario emitidas en el mismo segundo generaban un **JWT idéntico**. Su hash chocaba con el índice único de `sessions` → **HTTP 500**. El fallo ya existía antes de la Fase R (el token en claro también era único); salía a la luz por la secuencia cambio de contraseña → login. Corrección: `jti` aleatorio en cada token. Test nuevo que **falla sin la corrección y pasa con ella** (verificado retirándola temporalmente).
2. **Fallos de mis propios tests (corregidos):** un `GET` con cuerpo en la E2E (`fetch` lo rechaza); una comprobación de catalog tras el logout que siempre daba verde (`|| true`) y además usaba un endpoint público, rehecha con un endpoint protegido de staff; y el arnés abortaba sin resumen cuando la E2E fallaba antes de crear tickets.
3. **Exposición menor durante la depuración:** al diagnosticar el punto 1, una salida mostró el **fragmento inicial (cabecera y parte del payload, sin firma) de un JWT de prueba** del entorno desechable `sdsimclean`. No es reutilizable sin la firma, y el entorno se eliminó.

## 15. Riesgos restantes

1. **OAuth `state` sin vincular al navegador** (posible *login CSRF* en el SSO). Riesgo bajo: el código de un solo uso y el dominio permitido lo acotan. Recomendación: `state` aleatorio en una cookie `HttpOnly` y su verificación en el callback.
2. La **limitación de intentos y los códigos SSO viven en memoria**: son correctos con una réplica de auth-service (el compose actual). Con varias réplicas habría que moverlos a un almacén compartido.
3. Introspección con **caché de 30 s**: un token revocado puede seguir válido hasta 30 s en ticket y catalog.
4. **Tickets antiguos en `resuelto`** (anteriores a la Fase R) conviven con los nuevos en `cerrado`. Se conservan sin reescribir el historial; las estadísticas cuentan ambos.
5. La **infraestructura del host** (UFW, SSH, certbot, systemd) no se ha ejecutado en un Ubuntu real.
6. **El APK actual no es compatible** con el SSO nuevo (`?token=` → `?code=`): hay que reconstruirlo antes de usarlo contra un servidor con la Fase R.
7. **El VPS anterior sigue sin estas correcciones**; no se modifica por decisión del proyecto.
8. Todo el trabajo de las fases B–R sigue **sin commit**.

## 16. Estado de la fase

**FASE R = COMPLETADA.** No queda ningún fallo crítico conocido de autorización, autenticación ni exposición de datos en el código del servidor nuevo: R1–R4 corregidos y probados, el bypass deshabilitado en producción, sesiones con hash e introspección, SSO sin JWT en la URL, bootstrap seguro del admin y límite de intentos. Todo verificado con 372 tests y una instalación completa simulada (37/37, E2E 82/82).

**Pendiente para fases siguientes (no bloquea la Fase R):**
- **S:** cifrado, S3 y retención mensual de backups (necesita proveedor y custodia de la clave).
- **T/V:** validación en un Ubuntu real.
- **V:** reconstruir el APK con el frontend nuevo y probarlo en un dispositivo.
- SSO, FCM y SMTP reales: BLOCKED por credenciales.
- Riesgos §15.

**El servidor nuevo todavía NO está listo para producción.**

Sin commit. Sin push. VPS sin modificar.
