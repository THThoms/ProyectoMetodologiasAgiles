# Contexto maestro — ServiceDesk UTA

**Última auditoría:** 2026-11-04 (incorporación, solo lectura del repo local).
**Alcance de la auditoría:** repositorio local en `Develop`. **El VPS no se consultó** en esta auditoría.
**Este documento no contiene secretos.** No copiar aquí contraseñas, JWT, tokens FCM, SMTP, connection strings ni el contenido de `.env*` o `google-services.json`.

Leyenda usada en todo el documento:

- **[CONFIRMADO]** — verificado directamente en el repositorio el 2026-11-04.
- **[HISTÓRICO]** — reportado en un `FASE_*.md` (sept. 2026); no re-verificado ahora.
- **[PENDIENTE]** — trabajo identificado y no realizado.
- **[NO VERIFICADO]** — requiere acceso al VPS o a un dispositivo y no se ha comprobado.

> **Fase T (2026-11-05) — bloques, aceptación digital, reportes e imágenes.** Técnicos clasificados en
> Bloque 1/2 (`users.fisei_block`; no es rol ni da acceso). Aceptación con términos versionados, casilla y
> constancias inmutables en `solution_acceptances`. Reportes en una sola pantalla (`/admin/reportes`) con
> el formato original más validación, solución y ubicación; **Bloques** solo asigna. Pruebas: 447 unitarias,
> copia 31/31, simulación 61/61, Fase S 60/60. BLOCKED: Android, Firebase/SMTP reales, logotipos, Ubuntu real.
> Informe: `docs/history/phases/FASE_T_REPORTE_IMPLEMENTACION.md`.

> **Fase S (2026-11-05) — backups cifrados y recuperación.** `backup-mssql.sh` genera un conjunto con
> ID (3 `.bak` con CHECKSUM + VERIFYONLY + SHA-256, `manifest.json`, conteos, lista SHA-256 de imágenes,
> configuración) y lo sube con **Restic** (imagen fijada `restic/restic:0.18.0`, cifrado AES-256) a S3.
> Scripts en `scripts/backup/` (init, test-connection, backup, check, retention 14/8/12, restore, keys,
> restore-drill); timers systemd de backup, verificación, retención y drill mensual; alertas por código.
> Probado con MinIO local (`deploy/backup-lab/`) y recuperación completa en otro proyecto Docker con la
> clave del custodio (`scripts/testing/backup-dr-simulation.sh`). **Backblaze B2 real NO configurado.**
> Reporte: `docs/history/phases/FASE_S_REPORTE_BACKUPS_CIFRADOS.md`.

> **Fase R (2026-11-04) — roles, autorización y seguridad.** Roles oficiales `admin`, `technician`
> (área TECHNICIANS), `dtic` (área DTIC, no admin) y `user`; los `tech_n1..n4` se migran al arrancar.
> Aislamiento por área en backend (`ticketAccess`); endpoints por nivel → 410; aceptar la solución →
> `cerrado`; sesiones con SHA-256 e introspección en ticket y catalog; SSO con código de un solo uso;
> límite de intentos; bootstrap del admin con contraseña temporal; validación de imágenes por bytes y
> compresión en el cliente. 372 tests, simulación 37/37, E2E 82/82. Reporte:
> `docs/history/phases/FASE_R_REPORTE_SEGURIDAD_Y_FUNCIONALIDAD.md`. Las §5–§6 de este documento
> describen el estado anterior a la Fase R.

> **Fase P (2026-11-04) — reorganización e instalador.** Los reportes `FASE_*.md` están ahora en
> `docs/history/phases/`; los archivos de PostgreSQL en `archive/postgresql/`; la documentación de la
> migración en `docs/history/mssql-migration/`; y la del SQL Server UTA en `docs/history/institucional-uta/`
> (registro completo en `docs/history/MOVIMIENTOS_FASE_P.json`). Desarrollo: `compose.yaml`.
> Servidor nuevo: `deploy/` + `scripts/install-server.sh`. Seguridad: `docs/security/ESTADO_SEGURIDAD_PRE_NUEVO_SERVIDOR.md`.
> Reporte de la fase: `docs/history/phases/FASE_P_REPORTE_LIMPIEZA_NUEVO_SERVIDOR.md`.
> Las rutas citadas más abajo con su ubicación anterior siguen siendo válidas como referencia histórica.

---

## 1. Qué es

Sistema institucional de mesa de ayuda de la FISEI (Universidad Técnica de Ambato). Los usuarios crean tickets, los técnicos los atienden por área y los administradores supervisan. Se usa desde el navegador (`https://servicedesk-uta.site`) y desde una app Android (Capacitor).

## 2. Arquitectura [CONFIRMADO]

```text
Navegador / APK Android (WebView Capacitor)
        │  HTTPS
        ▼
Nginx host (VPS) ──► sd-frontend (nginx, SPA estática)
        │
        ▼
sd-gateway (Express + http-proxy-middleware, :8080)
   ├── /api/auth/*      → sd-auth     (:3001) → auth_db
   ├── /api/catalog/*   → sd-catalog  (:3002) → catalog_db
   ├── /api/knowledge/* → sd-catalog
   ├── /api/tickets/*   → sd-ticket   (:3003) → ticket_db   (+ volumen ticket-uploads)
   └── /api/routing/*, /api/admin/*, /api/notifications/* → sd-ticket
                                     │
                                     ▼
                          sd-mssql (SQL Server 2022)
```

- Frontend: React 18 + TypeScript + Vite 5 + Tailwind; Capacitor 8 para Android.
- Backend: Node 20, Express, TypeScript, Prisma (`provider = "sqlserver"`), JWT.
- **SQL Server 2022 es el único motor.** PostgreSQL fue retirado (Fase N). No reintroducirlo.
- El gateway no toca bases de datos. El frontend nunca habla con SQL Server.

### Schemas Prisma

| Servicio | Activo | Copia MSSQL | Legacy (no usar) |
|---|---|---|---|
| auth-service | `prisma/schema.prisma` (sqlserver) | `schema.mssql.prisma` (idéntico) | `schema.pg.legacy.prisma` |
| catalog-service | ídem | ídem | ídem |
| ticket-service | ídem | ídem | ídem |

Los `Dockerfile.mssql` hacen `cp prisma/schema.mssql.prisma prisma/schema.prisma` durante el build. **Hay dos fuentes con el mismo contenido: cualquier cambio de schema debe aplicarse en ambos archivos** (hoy son idénticos, verificado con `diff`).

`Ticket.status`, `TicketEvent.previousStatus` y `newStatus` son `NVarChar(24)` (corrección de Fase J/K para `pendiente_validacion`).

### Docker Compose

| Archivo | Uso | Contenedores |
|---|---|---|
| `docker-compose.prod-mssql.yml` | Producción VPS | `sd-mssql`, `sd-mssql-init`, `sd-auth`, `sd-catalog`, `sd-ticket`, `sd-gateway`, `sd-frontend` |
| `compose.yaml` (antes `docker-compose.mssql.yml`) | Desarrollo/lab local | mismos con sufijo `-mssql` / `sd-mssql-lab` |
| `deploy/server/compose.yaml` | **Servidor nuevo** (Fase P) | proyecto `servicedesk`, sin `container_name` |
| `archive/postgresql/docker-compose.legacy-pg.yml` | **⛔ LEGACY — NO EJECUTAR** | — |

Volúmenes de producción: `mssql-data`, `mssql-log`, `mssql-secrets`, `ticket-uploads` (en el VPS: `servicedesk-uta_mssql-data`, `servicedesk-uta_ticket-uploads`). **No borrarlos nunca.** No usar `docker compose down -v`.

Variables de entorno: plantilla en `.env.example` (solo MSSQL). En el VPS el archivo real es `/opt/servicedesk-uta/.env.mssql` (permisos 600). Localmente existen `.env` (antiguo, aún con variables `POSTGRES_*` muertas) y `.env.mssql` (lab).

## 3. Producción

> **Auditoría de solo lectura del 2026-11-04** (`FASE_P_AUDITORIA_VPS_Y_LOCAL.md`): 6 servicios arriba (frontend `unhealthy` por el healthcheck), 4 volúmenes intactos, 7 archivos en `ticket-uploads`, certificado válido hasta el 2026-12-05, y **código idéntico al repo local** (89/93 archivos por MD5; las 4 diferencias son esperadas). El VPS se reinició el 2026-11-04 a las 22:27 CET y se recuperó solo. El acceso SSH es por contraseña de root (la clave local no está autorizada). Lo que sigue en esta sección es histórico de septiembre.

- Dominio `https://servicedesk-uta.site`; VPS `vmi3560421`, Ubuntu 24.04, SSH puerto 2222; proyecto en `/opt/servicedesk-uta`.
- **`/opt/servicedesk-uta` no es un repositorio git.** Los despliegues de K y M se hicieron copiando archivos (tar / `pscp`) y reconstruyendo imágenes en el VPS. El código de producción puede diferir del repo; antes de desplegar hay que comparar.
- Contenedores tras Fase N: `sd-mssql`, `sd-auth`, `sd-catalog`, `sd-ticket`, `sd-gateway` (healthy) y `sd-frontend` (`unhealthy`, aunque sirve HTTP 200).
- Bundle web en producción: `assets/index-B6aM42JF.js`.
- Conteos al cierre de Fase N: users 16, services 8, knowledge 28, tickets 13, ticket_events 37, attachments 7. **Incluyen tickets de prueba creados por los smoke E2E de K contra producción.**
- Almacenamiento de imágenes: `storage_provider = local` en el volumen `ticket-uploads` (7 archivos). `STORAGE_MODE=cloudinary` está configurado, pero el paquete `cloudinary` no está instalado (no figura en `ticket-service/package.json` — [CONFIRMADO]), así que el servicio usa almacenamiento local.

## 4. Cronología de fases

| Fase | Qué se hizo | Dónde | Reporte |
|---|---|---|---|
| Sprints 1–3 (may–sep 2026) | Funcionalidad base, áreas, KB, estadísticas, SSO, renombre TICs→DTIC, retiro del área GENERAL | git (último commit 7c5620b, 2026-09-06) | README |
| B | Schemas MSSQL, `KnowledgeKeyword` en lugar de `String[]`, enums como constantes (`src/domain/enums.ts`), T-SQL en estadísticas | local | (en F/E) |
| C | Stack completo sobre MSSQL de laboratorio, 60/60 E2E | local | — |
| D | Migración de datos PG → MSSQL de laboratorio con UUID y fechas preservados | local | — |
| E | Preparación de la conexión al SQL Server institucional UTA. **Abandonada por decisión del proyecto** | docs | `FASE_E_REPORTE.md`, `docs/mssql-uta/` |
| F | Bloqueada para la UTA; después, preparación del runtime MSSQL-only, del compose de producción y del script de backup | local | `FASE_F_*.md` |
| G | **Switch real del VPS a SQL Server** (2026-09-14), datos 1:1, 29 sesiones invalidadas | VPS | `FASE_G_REPORTE_SWITCH_VPS_MSSQL.md` |
| H | Estabilidad día 0 en verde, backups manuales + restore drills | VPS | `FASE_H_REPORTE_ESTABILIDAD_MSSQL.md` |
| I | Correcciones: reescalamiento libera siempre, reporte de técnicos, imágenes en el historial, validación por el usuario | local | `FASE_I_REPORTE_CORRECCIONES.md` |
| J | E2E local 76/76; columnas de estado a `NVarChar(24)` | local | `FASE_J_REPORTE_E2E.md` |
| K | **Despliegue de I/J al VPS**, `db push` (ALTER COLUMN), smoke 76/76 contra producción | VPS | `FASE_K_REPORTE_DEPLOY_VPS.md` |
| L | Diagnóstico de "No disponible" en imágenes; endpoint autenticado + `AuthenticatedImage` + detalle clicable | prod (lectura) + local | `FASE_L_*.md` |
| M | **Despliegue del arreglo de imágenes al VPS**, verificado con curl (401/200/200/200/403, MD5 idéntico) | VPS | `FASE_M_REPORTE_DEPLOY_IMAGENES.md` |
| N | **Retiro de PostgreSQL** local y VPS; backups PG conservados; restore drill MSSQL | local + VPS | `FASE_N_RETIRO_DEFINITIVO_POSTGRESQL.md`, `docs/mssql/*.md` |
| O | Bundle web reconstruido + `cap sync` + `assembleDebug` → APK con `AuthenticatedImage`. **No probado en dispositivo** | local | `FASE_O_REPORTE_APK_IMAGENES.md` |

Desde el 2026-09-15 no hay cambios en el código (ningún archivo fuente es más reciente que el APK).

## 5. Flujo de tickets [CONFIRMADO en código]

Estados (`ticket-service/src/domain/enums.ts`): `abierto`, `en_proceso`, `escalado`, `pendiente_validacion`, `resuelto`, `cerrado`.

```text
abierto ─(técnico acepta)→ en_proceso ─(técnico resuelve)→ pendiente_validacion
                                                           │
                         ┌─ propietario acepta (POST /tickets/:id/user-accept)
                         │      → status = resuelto, evento USER_ACCEPTED
                         └─ propietario rechaza (POST /tickets/:id/user-reject, reason ≥ 5)
                                → status = en_proceso, resolvedAt = null,
                                  mismo técnico asignado, evento USER_REJECTED_RESOLUTION
```

- **Al aceptar la solución, el ticket pasa a `resuelto`, no a `cerrado`, y no se registra ningún evento `CLOSED`.** El estado `cerrado` existe en los enums y en filtros/estadísticas, pero el flujo de validación no lo asigna. El comentario de `enums.ts:15` ("aceptar (→ cerrado)") no coincide con el código (`assignmentRoutes.ts:784`). Hay que decidir si esto es lo esperado.
- Solo el propietario valida (403 para otros); estado incorrecto → 409.
- Reescalamiento: `PUT /tickets/:id/escalate` con `targetArea` libera siempre la asignación y deja el ticket disponible para el área destino. La asignación directa a un técnico es solo de administrador: `/admin/tickets/:id/assign`.
- Historial en `TicketEvent`; los eventos nunca se sobrescriben. El propietario no ve los eventos `visibility=internal`.
- Áreas: `TECHNICIANS` y `DTIC`. No reintroducir `GENERAL` ni `TICs`.

## 6. Imágenes adjuntas [CONFIRMADO en código; HISTÓRICO en producción]

- Endpoint: `GET /api/tickets/:ticketId/attachments/:attachmentId` (`ticketRoutes.ts`): verifica el JWT, permite al dueño, a los técnicos y al admin, comprueba `attachment.ticketId === :id`, aplica `path.basename`, envía el Content-Type real con `nosniff` y `Cache-Control: private, max-age=300` y usa `res.sendFile`. Para Cloudinary responde con un 302.
- `serializeAttachment()` (`storageService.ts`) reescribe `image_url` local a la ruta API. Se aplica en `GET /tickets/history/:id` y `GET /tickets/:id`. **[PENDIENTE]** `/my`, `/available`, `/my-assigned` y `/accepted` aún devuelven attachments sin serializar (hoy esas vistas no muestran miniaturas).
- `frontend/src/components/AuthenticatedImage.tsx`: Axios con `responseType: "blob"` y el JWT del interceptor → `URL.createObjectURL` → revocación al desmontar, con `AbortController`. Lo usa `TicketHistoryModal.tsx` (miniatura y lightbox).
- Prohibido: `<img src="/uploads/...">`, Base64, localhost, IPs privadas, hostnames Docker.
- El `location /uploads/` del nginx del VPS quedó como código muerto.

## 7. Android [CONFIRMADO en repo]

- `frontend/capacitor.config.ts`: `appId ec.uta.servicedesk`, `webDir dist`, `androidScheme https`, `allowMixedContent false`. Bundle offline + API remota.
- `android/app/build.gradle`: `versionCode 1`, `versionName "1.0"`, minSdk 24, targetSdk 36. El plugin google-services se aplica si existe `google-services.json` (existe localmente e ignorado por git).
- Manifest: permisos INTERNET, POST_NOTIFICATIONS, VIBRATE, WAKE_LOCK; sin cleartext; intent-filter `ec.uta.servicedesk://auth` para el callback SSO; `launchMode singleTask`.
- SSO móvil: `src/lib/ssoMobile.ts` (`Browser.open` con `?client=android`, callback `ec.uta.servicedesk://auth/success?token=…` vía `appUrlOpen`).
- Push: `src/lib/pushNotifications.ts`; al tocar la notificación se navega a `/tickets/:id` → `pages/TicketDeepLink.tsx` → `TicketHistoryModal`.
- **APK actual:** `frontend/android/app/build/outputs/apk/debug/app-debug.apk`, 6 074 423 bytes, MD5 `b95634a3779ac3dd6f8858df19a2961e`, generado el 2026-09-15 16:52 (-05). Contiene `assets/public/assets/index-B6aM42JF.js` (el mismo hash que sirve producción) con `servicedesk-uta.site`, `createObjectURL`, `responseType:"blob"` y "No se pudo cargar la imagen"; 0 apariciones de `/uploads/`, `localhost:8080` y "No disponible".
- **[NO VERIFICADO]** Instalación y prueba en un dispositivo físico (los 7 casos de Fase O §11).
- Es un APK debug firmado con la keystore de depuración. No hay configuración de release.

## 8. Otros subsistemas

| Subsistema | Estado |
|---|---|
| Microsoft SSO | [HISTÓRICO] `ssoConfigured=true`, `allowedDomain=uta.edu.ec` en K. El usuario indicó que funciona. No tocar sin necesidad. |
| FCM | [HISTÓRICO] `FCM_MODE=firebase` en producción, 3 device_tokens. En K no se forzó un envío real. |
| EmailOutbox | [HISTÓRICO] 20 registros tras K (11 sent previos + 9 del smoke). Nodemailer + Gmail SMTP. No reenviar correos históricos. |
| Cloudinary | Integración en código con `require` perezoso; el paquete no está instalado, así que el modo real es `local`. No cambiar mientras haya imágenes locales sin un plan de migración. |
| Estadísticas | `GET /admin/technicians/summary` + tarjeta en `AdminStats.tsx`. **La UI rotula "Técnicos por bloque"** con bloque = (nivel N1–N4 · área). No es un bloque físico y además expone la jerarquía N1–N4. Revisar el rotulado con el usuario. |

## 9. Backups

- [HISTÓRICO] PG retirado: VPS `/root/backups/postgresql-final-retired/20260915T203658Z/`; local `backups/postgresql-final-retired-local-20260915T204733Z/` (ignorado por git). Conservar.
- [HISTÓRICO] MSSQL: `/root/backups/mssql/20260915T203753Z/` (3 `.bak`, VERIFYONLY ok); diarios en `/var/backups/servicedesk-mssql/daily/`.
- Script: `scripts/backup-mssql.sh` (BACKUP COMPRESSION + CHECKSUM, VERIFYONLY, sha256, retención de 14 días para los diarios y 56 para los semanales; lee `MSSQL_SA_PASSWORD` de `/etc/servicedesk.env`). En el VPS está instalado como `/usr/local/sbin/servicedesk-backup-mssql.sh`.
- **[CONFIRMADO EN EL VPS 2026-11-04] LOS BACKUPS NO FUNCIONAN DESDE EL 15-SEP.** `servicedesk-backup.timer` (diario, 03:00) ejecuta `/usr/local/sbin/servicedesk-backup.sh`, el script **de PostgreSQL**, que falla a diario con "sd-postgres no está corriendo". En `/var/backups/servicedesk-mssql/daily/` solo hay `.bak` del 14 y 15-sep. El script MSSQL está instalado, pero nada lo ejecuta. Las unidades systemd no están en el repo (`scripts/systemd/` no existe). Detalle en `FASE_P_AUDITORIA_VPS_Y_LOCAL.md` §6.1.

## 10. Pendientes y riesgos (2026-11-04)

### Pendientes funcionales/operativos

1. **Probar el APK en un dispositivo físico** (login → Mis Aceptados → detalle → miniatura → lightbox; 0/1/3 imágenes; SSO; push + deep link).
2. **Healthcheck de `sd-frontend`**: `wget -q --spider http://localhost/` en nginx:alpine. **Causa confirmada en local el 2026-11-04** (`sd-frontend-mssql`): `localhost` resuelve a `::1` → *Connection refused*, porque `frontend/nginx.conf` solo escucha en IPv4 (`listen 80;`); `wget http://127.0.0.1/` responde OK. Arreglo: usar `http://127.0.0.1/` en el healthcheck de ambos compose. En el VPS no está verificado, aunque es la misma imagen y la misma configuración.
3. **Rotar las contraseñas de `auth_user`, `catalog_user` y `ticket_user`**: **confirmado sin rotar** el 2026-11-04 (comparación por hash con `.env.mssql.pre-fase-N`). Además, la contraseña de root del VPS se compartió en un chat el 2026-11-04: hay que cambiarla y pasar a clave SSH.
4. **Arreglar los backups**: reapuntar el timer al script MSSQL, hacer un backup manual inmediato y versionar las unidades systemd.
4b. **Renombrar en el VPS `docker-compose.yml` y `docker-compose.override.yml` (PostgreSQL)**: siguen con su nombre original, así que un `docker compose up` sin `-f` levantaría el stack antiguo.
5. Decidir `resuelto` vs `cerrado` tras `USER_ACCEPTED` (§5).
6. Rotulado "bloque" en `AdminStats.tsx` (§8).
7. Limpiar los tickets de smoke en producción (opcional, con backup previo y autorización).
8. `serializeAttachment` en el resto de endpoints (consistencia).
9. Eliminar el `location /uploads/` muerto del nginx del VPS (higiene).

### Riesgos

- **CRÍTICO: login "Microsoft simulado" sin contraseña, siempre activo.** `POST /auth/microsoft-simulate` (`auth-service/src/routes/authRoutes.ts:71`) emite un JWT para cualquier correo `@uta.edu.ec` sin contraseña ni Azure, y no lo protege ninguna variable de entorno (`microsoftSimulateEnabled: true` está fijo en el código, línea 284). Producción responde `microsoftSimulateEnabled: true` en `/api/auth/config` (comprobado el 2026-11-04). Si el endpoint está activo en el VPS, cualquiera puede entrar como `admin@uta.edu.ec` o como cualquier usuario. No se probó contra producción para no crear sesiones. Arreglo: condicionarlo a una variable (como `AUTH_DEV_LOGIN`), desactivada por defecto en producción.
- **Todo el trabajo de las fases B–O está sin commitear** en `Develop` (≈50 modificados y ≈60 sin seguimiento, incluido `frontend/android/`). Si se pierde el disco local, se pierde la única fuente fiel. Origin `Develop` está al mismo nivel que el commit local 7c5620b.
- ~~`.env.mssql` no cubierto por `.gitignore`~~ → **corregido en Fase P** (`.env.*` y `**/.env*` ignorados, excepto `.env.example`).
- Los scripts de smoke/migración citados en los reportes (`scratchpad/smoke-fase-i.js`, `smoke-mssql-http.js`, `migration-ws/migrate.js`, `compare-pg-vs-mssql.js`) **no están en el repo ni en los scratchpads locales**. No hay suite E2E reproducible.
- Producción se despliega copiando archivos sin git, lo que puede producir deriva entre el repo y el VPS.
- El directorio vacío `auth-service;C` es un artefacto de un comando mal formado (inofensivo).
- `.env` local conserva variables `POSTGRES_*` muertas.

## 11. Verificación local 2026-11-04 [CONFIRMADO]

| Comprobación | Resultado |
|---|---|
| auth-service jest | 26/26 |
| catalog-service jest | 52/52 |
| ticket-service jest | 215/215 (14 suites) |
| **Total** | **293/293** |
| `tsc --noEmit` auth/catalog/ticket/gateway | limpio |
| `tsc -b` frontend | limpio |
| Docker local | Stack `docker-compose.mssql.yml` reconstruido con `--build` (las imágenes previas eran del 14-sep, anteriores a la Fase L/M). 6 contenedores healthy salvo `sd-frontend-mssql` (healthcheck, ver §10) |
| Smoke local (gateway `:18080`, frontend `:13000`) | 22/22: health, SPA, dev-login de 5 roles, catálogo, ticket con imagen, URL autenticada, 401/200/200/403, técnico DTIC acepta y ve la imagen. Ticket de prueba `TK-20261104-001` en la BD del laboratorio. Script fuera del repo (scratchpad de la sesión) |
| VPS | no consultado |

## 12. Reglas permanentes

1. SQL Server es el único motor; no usar `docker-compose.legacy-pg.yml`.
2. Tres bases: `auth_db`, `catalog_db`, `ticket_db`.
3. Las imágenes se sirven solo por el endpoint autenticado; nunca `/uploads/` ni Base64.
4. Solo el propietario valida la solución; el rechazo exige motivo; el historial no se sobrescribe.
5. Áreas `TECHNICIANS` / `DTIC`; nada de `GENERAL`; no inventar bloques físicos.
6. Mantener SSO Microsoft y FCM.
7. Sin commits, pushes ni cambios en producción sin autorización explícita.
8. No borrar volúmenes (`mssql-data`, `ticket-uploads`), backups ni attachments.
9. No imprimir `.env`, contraseñas, JWT, tokens FCM, SMTP ni connection strings.
10. Separar siempre lo probado en local, en producción y en dispositivo.

## 13. Archivos clave

- Reportes: `docs/history/phases/FASE_E_REPORTE.md` … `FASE_P_REPORTE_LIMPIEZA_NUEVO_SERVIDOR.md`.
- Docs vigentes: `docs/architecture/`, `docs/installation/`, `docs/operations/`, `docs/security/`, `docs/troubleshooting/`. Históricos: `docs/history/` y `archive/postgresql/docs/`.
- Backend: `ticket-service/src/routes/{ticketRoutes,assignmentRoutes,adminRoutes,notificationRoutes}.ts`, `ticket-service/src/services/{storageService,historyService,fcmService,routingService}.ts`, `*/src/domain/enums.ts`.
- Gateway: `api-gateway/src/app.ts`.
- Frontend: `frontend/src/lib/{api,auth,ssoMobile,pushNotifications}.ts`, `components/{AuthenticatedImage,TicketHistoryModal}.tsx`, `pages/{MisTicketsAceptados,PanelTecnicoV2,MisTickets,AdminStats,TicketDeepLink}.tsx`.
- Android: `frontend/capacitor.config.ts`, `frontend/android/app/{build.gradle,src/main/AndroidManifest.xml}`.
- Infra: `docker-compose.prod-mssql.yml` (VPS actual), `compose.yaml` (lab), `deploy/` (servidor nuevo), `*/Dockerfile.mssql`, `frontend/{Dockerfile,nginx.conf}`, `scripts/` (ver `scripts/README.md`).
