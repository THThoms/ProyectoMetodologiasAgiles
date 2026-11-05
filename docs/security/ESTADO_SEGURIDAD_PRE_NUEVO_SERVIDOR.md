# Estado de seguridad previo al servidor nuevo

Escrito para: el propietario del sistema y quien autorice la puesta en producción.
Fecha: 2026-11-04 (Fase P). Sin valores sensibles.

Estados: **CONFIRMADO** (verificado con evidencia) · **CORREGIDO** (arreglado y probado en el código o paquete nuevo) · **PENDIENTE** (requiere una acción todavía no hecha) · **NO VERIFICADO**.
"VPS" = el servidor de producción actual (`servicedesk-uta.site`). Esta fase **no lo modificó**.

## Dictamen

> **El servidor nuevo NO debe declararse listo para producción** hasta cerrar los
> bloqueantes B1–B3. El paquete nuevo corrige en código el bypass de login y los
> backups. Lo que queda es decidir la licencia de SQL Server, configurar la copia
> externa y tomar el backup de origen fresco.

| # | Bloqueante para el servidor nuevo | Estado |
|---|---|---|
| B1 | Edición/licencia de SQL Server definida (`MSSQL_PID` ≠ Developer/Evaluation) | **PENDIENTE: decisión del propietario.** El instalador bloquea sin ella |
| B2 | Copia externa de backups configurada y probada | **PREPARADA Y PROBADA EN LABORATORIO (Fase S)**: Restic cifrado, MinIO S3, retención 14/8/12, restore drill y recuperación completa en otro entorno. **PENDIENTE** en real: bucket B2, Application Key y custodios |
| B3 | Migración: backup **fresco** del VPS (los automáticos fallan desde el 15-sep) | **PENDIENTE** (requiere autorización sobre el VPS) |
| — | Bypass de login deshabilitado en producción | **CORREGIDO** en código y probado (Fase P) |
| — | Backups automáticos MSSQL correctos | **CORREGIDO** en el paquete nuevo y probado en local |

## Actualización Fase R (2026-11-04) — autorización, sesiones y autenticación

| # | Hallazgo (Fase Q) | Estado tras Fase R |
|---|---|---|
| R1 | Cualquier técnico veía el historial (incl. eventos internos) de tickets de la otra área | **CORREGIDO** — regla única `ticketAccess` (área / asignado / propietario). Tests + E2E en Docker |
| R2 | Detalle e imágenes accesibles por técnicos de la otra área | **CORREGIDO** — misma regla. Tests + E2E (403) |
| R3 | `PATCH /tickets/:id/status` permitía cerrar saltándose la validación del usuario | **CORREGIDO** — 410 Gone, sin tocar la BD |
| R4 | Endpoints por nivel (N1–N4) autorizaban por nivel | **CORREGIDO** — `GET /tickets`, `GET /tickets/level`, `PUT /tickets/escalate`, `POST /routing/*` → 410 |
| — | Roles sin distinción DTIC/Técnicos | **CORREGIDO** — roles `admin`, `technician`, `dtic`, `user`; migración controlada probada sobre datos reales del laboratorio |
| — | JWT del SSO en la query string | **CORREGIDO** — código opaco de un solo uso (60 s) + `POST /auth/sso/exchange` |
| — | `sessions` guardaba el JWT completo | **CORREGIDO** — solo SHA-256; migración de sesiones existentes (equivalencia T-SQL/Node verificada); purga a 7 días |
| — | Logout/revocación no afectaban a ticket/catalog | **CORREGIDO** — introspección de sesión (`/auth/verify`, caché 30 s, falla cerrado) |
| — | Sin limitación de intentos en la aplicación | **CORREGIDO** — por IP y por cuenta con enfriamiento progresivo; 429 + `Retry-After`; mensajes genéricos; tiempo constante |
| — | `ADMIN_EMAILS` con correos reales por defecto | **CORREGIDO** — vacío por defecto |
| — | `INITIAL_ADMIN_PASSWORD` persistía en `.env` y en el contenedor | **CORREGIDO** — bootstrap con contraseña temporal (solo hash en BD, archivo 0600, cambio obligatorio, no crea un 2.º admin). El instalador rechaza la variable |
| — | Tipo de imagen según MIME declarado | **CORREGIDO** — validación por bytes; HEIC rechazado con mensaje; compresión en el cliente |
| — | UFW, SSH, daemon de Docker y hook de certbot solo documentados | **PREPARADO** en el instalador (`sshd -t`, `logrotate -d`, `dockerd --validate` pasan) — **NO VERIFICADO en Ubuntu real** |
| — | Estado OAuth (`state`) no ligado al navegador (posible *login CSRF*) | **PENDIENTE** (riesgo bajo; ver reporte Fase R §15) |

## Hallazgos

### 1. Backups diarios MSSQL fallando en el VPS
- **CONFIRMADO** (auditoría del 2026-11-04): `servicedesk-backup.timer` ejecuta el script de **PostgreSQL** (`sd-postgres` ya no existe) y falla a diario. No hay `.bak` posteriores al 15-sep-2026.
- **CORREGIDO para el servidor nuevo**: `scripts/backup-mssql.sh` + `deploy/systemd/` (timer diario, verificación cada 6 h, alerta `OnFailure`, SHA-256, `RESTORE VERIFYONLY`, imágenes incluidas, copia externa obligatoria). Probado en la simulación local.
- **PENDIENTE en el VPS**: tomar un backup manual ya y reapuntar el timer (ver `docs/operations/BACKUPS_MSSQL.md §7`). Requiere autorización.

### 2. Login "Microsoft simulado" activo
- **CONFIRMADO en el VPS**: `/api/auth/config` devuelve `microsoftSimulateEnabled:true` y el código desplegado incluye `POST /auth/microsoft-simulate`, que emite un JWT **sin contraseña** para cualquier correo del dominio y **crea** cuentas admin si el correo está en `ADMIN_EMAILS`. No se probó contra producción.
- **CORREGIDO en código** (Fase P):
  - `auth-service/src/config/env.ts`: `microsoftSimulateEnabled` y `devLoginEnabled` son `false` siempre que `NODE_ENV=production`, y fuera de producción requieren `AUTH_MICROSOFT_SIMULATE=true` / `AUTH_DEV_LOGIN=true`.
  - `authRoutes.ts`: `/microsoft-simulate` responde **404** si no está habilitado. `/config` informa el valor real.
  - `Login.tsx`: si falla la lectura de la configuración, ya no asume que el simulado está disponible.
  - Pruebas: `auth-service/tests/insecureLoginGuard.test.ts` (8 casos: producción con flags → 404, sin token y sin tocar la BD; desarrollo opt-in).
  - `deploy/server/compose.yaml` fija además los flags en `false`.
  - Verificado en Docker real (simulación): `microsoft-simulate` → 404 y `dev-login` → 404.
- **PENDIENTE en el VPS**: sigue vulnerable hasta desplegar el auth-service nuevo. Además conviene revisar `auth_logs` buscando `auth_provider='microsoft-simulated'` para saber si se ha usado.

### 3. Cuentas demo con contraseñas públicas (hallazgo nuevo de Fase P)
- **CONFIRMADO en el código del VPS**: el seed de auth se ejecuta en **cada arranque**, también en producción, y crea o actualiza 9 cuentas (incluido `admin@uta.edu.ec`) con contraseñas que figuran en el README. La Fase K reportó login correcto con esas cuentas en producción.
- **CORREGIDO en código**: el seed solo crea cuentas demo con `SEED_DEMO_USERS=true` **y** `NODE_ENV≠production`. En producción solo crea un administrador inicial definido por el operador (contraseña ≥ 12 con política). La simulación comprobó que las cuentas demo **no existen** en una instalación limpia.
- **PENDIENTE en el VPS**: deshabilitar o cambiar la contraseña de esas cuentas. Desplegar el código nuevo **no** las borra.

### 4. Credenciales SQL Server expuestas (Fase N)
- **CONFIRMADO sin rotar** (2026-11-04, comparación por hash): `auth_user`, `catalog_user` y `ticket_user` conservan la contraseña expuesta.
- **Servidor nuevo**: no se reutilizan. `--generate-secrets` genera valores nuevos e independientes; la simulación verificó que la instalación restaurada usa credenciales distintas del origen. `mssql-init` permite rotarlas cambiando `.env`.
- **PENDIENTE en el VPS**: rotarlas (tarea urgente y separada).

### 5. Contraseña de root del VPS expuesta
- **CONFIRMADO**: se compartió en un chat el 2026-11-04 y el acceso SSH del VPS es por contraseña de root (la clave del operador no está autorizada).
- **PENDIENTE**: cambiarla, autorizar una clave SSH y desactivar `PasswordAuthentication`. La guía del servidor nuevo lo hace desde el principio (§2).

### 6. Compose PostgreSQL residual en el VPS
- **CONFIRMADO**: `/opt/servicedesk-uta/docker-compose.yml` y `docker-compose.override.yml` son el stack PostgreSQL. Un `docker compose up` sin `-f` lo levantaría.
- **Repositorio**: movido a `archive/postgresql/` con un README de advertencia. El paquete nuevo no lo contiene.
- **PENDIENTE en el VPS**: renombrar esos archivos.

### 7. Puertos internos expuestos a Internet (hallazgo nuevo)
- **CONFIRMADO desde fuera** (2026-11-04): `http://<IP_VPS>:8080` (gateway, 404) y `:3000` (frontend, 200) responden sin TLS. Docker publica los puertos por encima de UFW. El 1433 no responde (correcto).
- **CORREGIDO para el servidor nuevo**: el gateway y el frontend se publican solo en `127.0.0.1` y SQL Server no publica puertos (red `data` interna). Verificado con `docker compose config` y en la simulación (`docker port` de mssql vacío).
- **PENDIENTE en el VPS**.

### 8. Healthcheck del frontend
- **CONFIRMADO** (local y VPS): `wget http://localhost/` falla porque resuelve a `::1` y nginx solo escucha en IPv4; `127.0.0.1` funciona.
- **CORREGIDO** en `compose.yaml` y `deploy/server/compose.yaml`. Probado en Docker real (frontend `healthy`).
- **PENDIENTE en el VPS** (cosmético).

### 9. Edición / licencia de SQL Server
- **CONFIRMADO**: el laboratorio es `Developer Edition (64-bit) 16.0.4275.2 CU26` (`SERVERPROPERTY('Edition')`). El compose del VPS declara `MSSQL_PID: "Developer"`, edición no licenciada para producción (no se consultó en el VPS en esta fase).
- **Servidor nuevo**: `MSSQL_PID` es obligatorio. Developer y Evaluation quedan bloqueados, y se comprueba que la edición real coincida. La simulación usó **Express** y funcionó (incluido el backup sin compresión).
- **PENDIENTE**: decisión de licencia del propietario (B1).

### 10. Otros puntos revisados

| Tema | Estado |
|---|---|
| `.env.mssql` no ignorado por Git | **CORREGIDO**: `.gitignore` cubre `.env.*` y `**/.env*`, excepto `.env.example` |
| Secretos en el paquete | **CORREGIDO y verificado**: el generador aborta si encuentra `.env`, claves o keystores, y comprueba que ningún valor secreto de los `.env` locales aparezca en el contenido |
| ticket-service recibía credenciales de auth_db y catalog_db sin usarlas | **CORREGIDO** en los composes nuevos (mínimo privilegio) |
| `prisma db push --accept-data-loss` en cada arranque | **CORREGIDO** en el servidor nuevo (`PRISMA_ACCEPT_DATA_LOSS=false`). El default histórico se mantiene para no alterar el VPS |
| Seeds sobre una base restaurada | **CORREGIDO**: `RUN_SEED=false` por defecto; el modo restore nunca siembra |
| Fuerza bruta en login | **MITIGADO** en nginx (`limit_req` de 10/min por IP en `/api/auth/login`) |
| TLS / cabeceras | HSTS, `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy`; TLS 1.2/1.3 |
| Gestión de roles sin UI/API | **PENDIENTE funcional** (decisión del propietario); cubierto con `manage-user.sh` |
| Certificado del VPS | Vence el 2026-12-05; `certbot.timer` activo (no verificado el hook de recarga) |
| Microsoft SSO, FCM y SMTP reales | **NO VERIFICADOS** en la simulación (sin credenciales de prueba) |

## Tareas urgentes sobre el VPS actual (separadas de esta fase, requieren autorización)

1. Backup MSSQL manual inmediato y reapuntar el timer.
2. Desplegar el auth-service corregido, o como mínimo bloquear `location = /api/auth/microsoft-simulate` y `/api/auth/dev-login` en nginx con `return 404;`.
3. Deshabilitar o cambiar la contraseña de las 9 cuentas demo.
4. Rotar las contraseñas de `auth_user`, `catalog_user` y `ticket_user`.
5. Cambiar la contraseña de root y pasar a clave SSH.
6. Publicar 8080 y 3000 solo en `127.0.0.1`.
7. Renombrar el compose PostgreSQL residual.
