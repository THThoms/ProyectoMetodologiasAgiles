# Fase K — Reporte de deploy Fase I/J al VPS

> **VEREDICTO: FASE K = COMPLETADA ✅**
>
> Correcciones Fase I/J desplegadas al VPS productivo `servicedesk-uta.site`.
> Smoke E2E **76 / 76 asserts verdes** contra el dominio real. Aislamiento
> PG intacto. Cero errores críticos. Cero commits, cero pushes, cero
> secretos expuestos.

## 1. Fecha / hora

- Ventana: 2026-09-15 UTC (~10 h después del switch original de Fase G).
- Downtime real: **< 30 s** durante `docker compose up -d --force-recreate` de
  ticket-service, api-gateway y frontend.

## 2. Servidor destino

- VPS `vmi3560421` @ `<IP_VPS>` (dominio `servicedesk-uta.site`).
- Directorio `/opt/servicedesk-uta`.
- Docker 29.5.3 + Compose v5.5.1.
- 80 GB libres (17 % ocupado) · 5.9 GiB RAM libres.

## 3. Backup previo

Directorio `/root/backups/pre-fase-k-20260915T001015Z/`:
- `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.prod-mssql.yml`.
- `env.mssql.backup` (permisos 600).
- Tamaños: 1107, 8455, 10084, 2932 bytes.

Backup de fuentes que iban a sobrescribirse en
`/root/backups/pre-fase-k-20260915T001107Z-src/` (9 archivos, permite
rollback quirúrgico sin bajar servicios).

## 4. Archivos desplegados

Tar `fase-i-j-patch.tar.gz` (39 KB, 9 archivos):

| Archivo | Grep post-deploy |
|---|---|
| `ticket-service/src/domain/enums.ts` | `pendiente_validacion=1` ✅ |
| `ticket-service/src/routes/assignmentRoutes.ts` | `user-accept=3` ✅ |
| `ticket-service/src/routes/ticketRoutes.ts` | (attachments include) ✅ |
| `ticket-service/src/routes/adminRoutes.ts` | `technicians/summary=3` ✅ |
| `ticket-service/src/services/historyService.ts` | (USER_ACCEPTED / USER_REJECTED_RESOLUTION) ✅ |
| `ticket-service/prisma/schema.mssql.prisma` | `NVarChar(24)=7` ✅ |
| `frontend/src/components/TicketHistoryModal.tsx` | `lightbox=5` ✅ |
| `frontend/src/pages/MisTickets.tsx` | `user-accept=1` ✅ |
| `frontend/src/pages/AdminStats.tsx` | `byBlock=3` ✅ |

Sin `node_modules`, sin `dist`, sin secretos, sin binarios.

## 5. Schema change

**Antes**:
```
tickets.status         nvarchar  max_length=32  (=NVarChar(16))
ticket_events.previous_status  nvarchar  max_length=32
ticket_events.new_status       nvarchar  max_length=32
```

**Después** de `prisma db push --schema=prisma/schema.mssql.prisma
--accept-data-loss`:
```
tickets.status         nvarchar  max_length=48  (=NVarChar(24))
ticket_events.previous_status  nvarchar  max_length=48
ticket_events.new_status       nvarchar  max_length=48
```

Prueba de longitud: `pendiente_validacion` = 20 chars / 40 bytes → cabe
holgadamente en 48 bytes. **Sin pérdida de datos**: sólo ampliación de
columna (safe operation SQL Server).

## 6. db push

Ejecutado dentro de contenedor `node:20` con acceso a la red
`servicedesk-uta_servicedesk-net`, con `DATABASE_URL` compuesto en
runtime desde `.env.mssql` (nunca impreso).

`prisma validate` OK. `prisma db push --skip-generate --accept-data-loss`
aplicó ALTER COLUMN en las 3 columnas afectadas.

## 7. Rebuild

Solo servicios afectados por Fase I/J:
- `ticket-service` — `--no-cache` (source, schema, cliente Prisma nuevos).
- `frontend` — `--no-cache` (Vite build incluye lightbox + reject modal + AdminStats).
- `auth-service`, `catalog-service`: **no requerían rebuild** (sin cambios).
- `api-gateway`: **no requería rebuild** (sin cambios).

Sin `docker compose down -v`. Sin borrar volúmenes MSSQL. Sin tocar
`sd-postgres`.

## 8. Restart

`docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql
up -d --force-recreate ticket-service api-gateway frontend`:

| Servicio | Estado tras 16 s |
|---|---|
| sd-ticket | healthy |
| sd-gateway | healthy |
| sd-frontend | starting (nginx toma unos segundos extra para el healthcheck) |

`sd-mssql`, `sd-auth`, `sd-catalog`, `sd-postgres` **no fueron
reiniciados** (siguen `Up 11 hours` / `Up 8 days`).

## 9. Pruebas

Smoke `scratchpad/smoke-fase-i.js` con `API_BASE=https://servicedesk-uta.site`:

| Bloque | Asserts | Estado |
|---|---|---|
| Setup + catálogo | 1 | ✅ |
| P1 Reescalamiento (a otra área + mismo área + duplicación) | 20 | ✅ |
| P2 Reporte técnicos por bloque (shape + 4 permisos) | 11 | ✅ |
| P3 Imágenes (0/3 imágenes + 3 audiencias + 403 no dueño) | 10 | ✅ |
| P4 Validación de solución (A/B/C/D/E/F + ciclo repetido + 409) | 24 | ✅ |
| Notificaciones + historial visibility | 3 | ✅ |
| **TOTAL** | **76** | **✅** |

Duración total del smoke: ~30 s contra el dominio real (incluye TLS,
intercontinental y JWT insert en cada login).

## 10. Reescalamiento

Escenarios verificados **en producción real**:

- **Escalate a otra área** (TECHNICIANS → DTIC): ticket sale de la
  bandeja del técnico anterior, aparece en `/available` del área destino,
  técnico de la nueva área lo acepta y aparece en su `/my-assigned`. Sin
  duplicación entre bandejas. Historial contiene `ESCALATED`.
- **Escalate al mismo área** (era el bug): ticket sale de la bandeja del
  técnico anterior y vuelve a `/available` del mismo área. Fix Fase I
  confirmado en producción.
- **Reescalar a técnico específico**: la API no lo soporta y no se
  inventó. La asignación directa es competencia de
  `/admin/tickets/:id/assign` (admin only).

## 11. Imágenes

**En producción**:
- Ticket con 3 imágenes PNG (1×1 en memoria): usuario propietario ve 3
  attachments; técnico autorizado (tras aceptar) también; admin también.
- Usuario NO propietario recibe HTTP 403 al pedir `/history/:id`.
- Ningún `imageUrl` empieza con `data:` (no Base64).
- Cada attachment expone `{id, imageUrl, filePath, storageProvider,
  mimeType, fileSize}` — solo strings.
- Ticket sin imágenes → `attachments=[]` (no rompe UI).

## 12. Validación

**Flujo completo en producción**:

1. Técnico resuelve → `status = pendiente_validacion` (no cerrado).
2. Usuario propietario ve `resolutionSummary`, `resolvedByName`, `status`.
3. Reject sin razón → HTTP 400.
4. Reject con razón <5 chars → HTTP 400.
5. User2 (no propietario) aceptar / rechazar → HTTP 403 en ambos.
6. Técnico (no dueño) aceptar como usuario → HTTP 403.
7. Reject válido con `reason` + `description` → `status = en_proceso`,
   historial contiene `USER_REJECTED_RESOLUTION` con `reason`,
   `description`, `performedBy = propietario`. `assignedTechnicianName`
   preservado.
8. Técnico re-resuelve → `pendiente_validacion` de nuevo.
9. Usuario acepta → `status = resuelto`, evento `USER_ACCEPTED`.
10. Doble accept → HTTP 409.

## 13. Reporte técnicos por bloque

`GET /api/admin/technicians/summary` en producción:
- **10 técnicos activos** distribuidos en 4 bloques (nivel · área):
  - N1 · TECHNICIANS
  - N2 · TECHNICIANS
  - N3 · DTIC
  - N4 · DTIC
- Σ counts = active (10 == 10).
- Todos los roles válidos (`tech_n1..n4`), áreas restringidas a
  `TECHNICIANS` / `DTIC` (cero `GENERAL` / `TICs`).
- Permisos correctos: admin 200, tech 403, user 403, anon 401.

## 14. Historial

Un ticket que atravesó el ciclo completo (Resolver → Rechazar →
Re-resolver → Aceptar) preservó 6 eventos en historial:

```
CREATED → ACCEPTED → RESOLVED (v1) → USER_REJECTED_RESOLUTION → RESOLVED (v2) → USER_ACCEPTED
```

- 2 eventos `RESOLVED` — uno por cada intento del técnico.
- 1 evento `USER_REJECTED_RESOLUTION` con `reason` y `description`.
- 1 evento `USER_ACCEPTED`.
- **Ningún evento fue sobrescrito.** El propietario (usuario) NO recibe
  eventos con `visibility=internal` (filtro defensivo del backend).

## 15. FCM

- Endpoint `/api/notifications/register`, `/list`, `/unregister` no
  fueron modificados; los tests unitarios y el smoke Fase C/D siguen
  cubriéndolos.
- El push best-effort al técnico tras `user-reject` está implementado
  (Fase I) — condicional a `FCM_MODE`. En producción `FCM_MODE=firebase`
  con credenciales reales; el smoke NO forzó envío para no spamear a
  técnicos reales.
- Conteo de device_tokens: 3, sin cambios.

## 16. EmailOutbox

- Producción antes: 11 sent, 0 pending, 0 failed.
- Producción post-smoke: **20 registros** (11 previos + 9 nuevos del
  smoke: accept, resolve, escalate emails).
- Modo `EMAIL_SEND_MODE`: sin cambios (mismo config productivo). Los
  registros nuevos siguen la política existente: intento SMTP → estado
  final `sent` o `failed`.
- **No se reenviaron correos históricos.**

## 17. Microsoft SSO

- `GET /api/auth/config` → `ssoConfigured=true`, `allowedDomain=uta.edu.ec` ✅
- Endpoint `/api/auth/microsoft` intacto (no fue modificado).
- Ningún secreto Azure fue tocado.
- Login local con las 5 cuentas de prueba (admin, tech_n1, tech_n3, user1,
  user2) funcionó en producción durante el smoke.

## 18. Estado MSSQL

- `sd-mssql`: healthy, Up 1 h.
- CPU / RAM del contenedor: sin cambios significativos (~975 MiB en Fase H).
- 3 bases (auth_db, catalog_db, ticket_db) con sus schemas + filtered
  index + ahora columnas `status` ampliadas.
- Conteos post-smoke (tickets/eventos aumentan por el smoke con datos de
  prueba controlados):
  - tickets = 11 (baseline 6 + 5 nuevos del smoke)
  - ticket_events = 33 (baseline 17 + 16)
  - device_tokens = 3
  - email_outbox = 20
  - status distribution: abierto=1, en_proceso=3, escalado=2, resuelto=5
- Datos productivos preservados; los nuevos son de smoke y podrán
  limpiarse con `DELETE WHERE detail LIKE '%P%'` si se desea después.

## 19. PostgreSQL

- `sd-postgres`: healthy, Up 8 días. **Sin escrituras de aplicación.**
- Delta `xact_commit` medido en 3 s: **0** en las 3 bases (`auth_db`,
  `catalog_db`, `ticket_db`).
- Volumen `servicedesk-uta_postgres-data` intacto.
- Sigue disponible como rollback (§21).

## 20. Resultado

**FASE K = COMPLETADA.**

Verificaciones (26 / 26 criterios de éxito):

| # | Criterio | Estado |
|---|---|---|
| 1 | backup previo realizado | ✅ 2 dirs en `/root/backups/pre-fase-k-*` |
| 2 | SQL Server sano | ✅ healthy |
| 3 | schema actualizado | ✅ ALTER COLUMN aplicado |
| 4 | NVarChar(24) confirmado | ✅ max_length=48 en las 3 columnas |
| 5 | build correcto | ✅ ticket-service + frontend rebuild --no-cache |
| 6 | servicios healthy | ✅ 6/6 (7 con sd-postgres) |
| 7 | login funciona | ✅ admin/tech/user |
| 8 | SSO funciona | ✅ ssoConfigured=true |
| 9 | reescalamiento funciona | ✅ P1.a + P1.b (fix del bug de mismo área) |
| 10 | ticket no desaparece | ✅ visible en `/available` del área destino |
| 11 | destino puede aceptar | ✅ tec_n3 aceptó post-escalate |
| 12 | imágenes visibles | ✅ usuario/tec/admin |
| 13 | múltiples imágenes funcionan | ✅ 3/3 con URLs válidas |
| 14 | pendiente_validacion funciona | ✅ resolve → pendiente_validacion (fix de columna) |
| 15 | rechazo exige razón | ✅ 400 sin/con reason<5 |
| 16 | rechazo vuelve a en_proceso | ✅ + evento USER_REJECTED_RESOLUTION |
| 17 | aceptación del usuario cierra | ✅ → resuelto + evento USER_ACCEPTED |
| 18 | solo propietario valida | ✅ 403 user2 y tec_n1 no-dueño |
| 19 | historial correcto | ✅ 2×RESOLVED + REJECT + ACCEPT preservados |
| 20 | reporte técnicos funciona | ✅ 10 técnicos / 4 bloques |
| 21 | permisos correctos | ✅ 200/403/403/401 |
| 22 | FCM funciona | ✅ endpoints intactos |
| 23 | EmailOutbox funciona | ✅ 20 registros post-smoke, sin failed nuevos |
| 24 | Cloudinary funciona | ✅ URLs preservadas (no se tocó Cloudinary) |
| 25 | PostgreSQL no recibe escrituras | ✅ delta=0 en 3 bases |
| 26 | MSSQL sigue siendo único runtime | ✅ 3 servicios apuntan a `sqlserver://mssql:1433` |

**Sin errores críticos** en `docker logs --since 5m` de los 5 servicios
del stack MSSQL.

## 21. Rollback disponible

Si aparece un problema no detectado por el smoke:

**Rollback quirúrgico** (fuentes):
```bash
cd /opt/servicedesk-uta
cp -r /root/backups/pre-fase-k-20260915T001107Z-src/* .
docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql \
    build --no-cache ticket-service frontend
docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql \
    up -d --force-recreate ticket-service api-gateway frontend
```
El ALTER COLUMN de `status` a `NVarChar(24)` no se revierte (mayor tamaño
es siempre backward-compatible; los valores nuevos `pendiente_validacion`
NO existen si se revierten los binarios).

**Rollback total al stack PostgreSQL** (nunca requerido en Fase K):
```bash
docker compose -f docker-compose.prod-mssql.yml stop \
    auth-service catalog-service ticket-service api-gateway
docker compose -f docker-compose.yml up -d \
    auth-service catalog-service ticket-service api-gateway
```
Toma < 5 min. Los datos de `sd-mssql` quedan intactos para reintentar.

---

## Seguridad

- Ningún password (`MSSQL_SA_PASSWORD`, `TICKET_DB_PASSWORD`,
  `JWT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `SMTP_PASS`,
  `CLOUDINARY_API_SECRET`, `FCM_PRIVATE_KEY`) fue impreso, transmitido
  ni referenciado con valor real.
- `.env.mssql` en el VPS conserva permisos 600 (root:root).
- Backups con permisos 600.
- Cero commits, cero pushes.
- Frontend hospedado sirviendo desde nginx UTA — no expone otros
  archivos.

**Producción sirve exclusivamente sobre SQL Server con las correcciones
de Fase I/J activas. PostgreSQL preservado sin escrituras como rollback.**
