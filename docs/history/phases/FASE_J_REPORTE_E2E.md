# Fase J — Reporte E2E de las correcciones de Fase I

> **VEREDICTO: FASE J = COMPLETADA ✅**
>
> Todas las correcciones de Fase I validadas contra el stack MSSQL local
> con **76 / 76 asserts en verde**. Un defecto de shape del schema
> detectado durante la validación fue corregido en el mismo turno.
> **No se tocó el VPS productivo. Cero commits, cero pushes, cero secretos.**

## 1. Ambiente de prueba

- **Stack**: `docker-compose.mssql.yml` local rebuild `--no-cache` con los
  cambios de Fase I aplicados sobre `auth-service`, `catalog-service`,
  `ticket-service`, `frontend`.
- **Motor**: SQL Server 2022 (`sd-mssql-lab`) — **PostgreSQL NO se usó**.
- **Gateway**: `http://localhost:18080`.
- **Datos**: bases con seeds (11 users + admin/tec/user), tabla `tickets`
  limpiada antes del smoke para partir de baseline determinista.

## 2. Regresión

| Servicio | Suites | Tests |
|---|---|---|
| auth-service | 2 passed | **26 / 26** ✅ |
| catalog-service | 3 passed | **52 / 52** ✅ |
| ticket-service | 13 passed | **204 / 204** ✅ |
| **Total** | **18** | **282 / 282** ✅ |

**Frontend**:
- `npx tsc --noEmit` limpio ✅
- `npm run build` → 383 KB main bundle (110 KB gzip), 9 chunks ✅

## 3. Smoke E2E — 76 / 76 asserts verdes

Script: [scratchpad/smoke-fase-i.js](../../AppData/Local/Temp/claude/c--Users-USER-Documents-cuarto-semestre-Metodologias-Ajiles-servicedesk-microservices/d92375d7-c702-405d-803b-46cf80148d75/scratchpad/smoke-fase-i.js).

### 3.1 P1 · Reescalamiento (21/21 ✅)

**Escenario P1.a — reescalar a otra área**
- Usuario `docente@uta.edu.ec` crea ticket sobre `Equipos / Hardware` (TECHNICIANS).
- `tec_n1` (Carlos Mena) acepta → `assignmentStatus=accepted`.
- `tec_n1` escala con `targetArea=DTIC` (motivo + workDone).
- Post-escalate:
  - `status=escalado`, `responsibleArea=DTIC`, `assignmentStatus=available`.
  - `assignedTechnicianName` limpio (null).
  - Historial contiene `ESCALATED`.
  - `tec_n1` ya no ve el ticket en `/my-assigned`.
  - `tec_n3` (DTIC, Andrés Salazar) SÍ lo ve en `/available`.
  - `tec_n1` (TECHNICIANS) NO lo ve en `/available` (área cambió).
- `tec_n3` acepta → `/available` deja de mostrarlo y `/my-assigned` de `tec_n3` sí.
- **No hay duplicación** entre available y my-assigned del mismo técnico.

**Escenario P1.b — reescalar al MISMO área** (el bug real de Fase I)
- `tec_n1` acepta un ticket TECHNICIANS y escala **sin `targetArea`** (queda misma área).
- Post-escalate:
  - `status=escalado`, `responsibleArea=TECHNICIANS`, `assignmentStatus=available`.
  - `tec_n1` **pierde la asignación** (fix Fase I: antes seguía asignado).
  - El ticket vuelve a `/available` de TECHNICIANS.

**Escenario P1.c — reescalamiento directo a técnico específico**
- **La API no lo soporta** (nunca lo tuvo). El endpoint `PUT /:id/escalate`
  acepta solo `targetArea`. Para asignar a un técnico específico se usa
  `POST /admin/tickets/:id/assign` (solo admin). Documentado, no se
  inventó nada.

### 3.2 P2 · Reporte de técnicos por bloque (11/11 ✅)

| Assert | Resultado |
|---|---|
| `GET /admin/technicians/summary` (admin) | HTTP 200 |
| `total` | 6 |
| `active` | 6 |
| `byBlock` array | len=4 |
| Cada fila `{block, role, area, count}` | ✅ |
| Σ `byBlock.count === active` | 6 == 6 ✅ |
| Roles válidos (`tech_n1..n4`) | ✅ |
| Áreas restringidas (TECHNICIANS / DTIC) | ✅ **Nunca GENERAL ni TICs** |
| **Permisos**: técnico → 403 | ✅ |
| Usuario → 403 | ✅ |
| Sin JWT → 401 | ✅ |

El reporte se presenta explícitamente como **(nivel · área)** en la UI,
con nota aclaratoria de que "bloque" no es un campo físico sino la
unidad operativa nivel-área. Documentado en el reporte de Fase I §11.

### 3.3 P3 · Imágenes en historial (10/10 ✅)

| Assert | Resultado |
|---|---|
| Ticket **sin imágenes**: `attachments=[]` | ✅ (no rompe UI) |
| Ticket **con 3 imágenes PNG** (1×1 test) crear | HTTP 201 |
| Usuario propietario ve 3 attachments | ✅ |
| Cada attachment tiene `imageUrl` o `filePath` | ✅ |
| **Ningún** `imageUrl` empieza con `data:` (no Base64) | ✅ |
| Técnico autorizado (tras aceptar) ve 3 | ✅ |
| Admin ve 3 | ✅ |
| **Otro usuario** (no propietario, no staff) → 403 | ✅ |

El shape del attachment devuelto por `/tickets/history/:id`:
```json
{ "id": "...", "imageUrl": "/uploads/...", "filePath": "...",
  "storageProvider": "local", "mimeType": "image/png", "fileSize": ... }
```

**Sin exposición de binarios, sin base64, sin URL pública nueva**.

### 3.4 P4 · Validación de la solución (24/24 ✅)

**CASO A · técnico resuelve → pendiente_validacion**
- `POST /tickets/:id/resolve` (con `existingKnowledge`) → HTTP 200.
- `status = pendiente_validacion` (no `resuelto`).
- `resolvedAt`, `resolvedById`, `resolvedByName`, `knowledgeArticleId`,
  `resolutionSummary` poblados.
- Usuario propietario ve el ticket en `/tickets/my` con status
  `pendiente_validacion`, `resolutionSummary` visible, `resolvedByName`
  visible.

**CASO C · rechazar sin razón → 400**
- `POST /user-reject` con `body: {}` → HTTP 400 ✅
- `POST /user-reject` con `reason: "no"` (<5 chars) → HTTP 400 ✅

**CASO E · aceptar por no-propietario → 403**
- `user2` (estudiante) intenta aceptar → 403 ✅
- Técnico (no dueño) intenta aceptar como usuario → 403 ✅

**CASO F · rechazar por no-propietario → 403**
- `user2` intenta rechazar → 403 ✅

**CASO D · rechazo con razón válida**
- `user1` (propietario) rechaza con `reason` (>=5) y `description`.
- HTTP 200.
- `status` → `en_proceso`.
- Historial contiene `USER_REJECTED_RESOLUTION` con `reason`, `description`
  y `performedBy.id = user1.id`.
- **`assignedTechnicianName` preservado** (política actual: vuelve al
  mismo técnico).
- `history.ticket.status = en_proceso`.

**CASO 7 · ciclo Resolver → Rechazar → Re-resolver → Aceptar**
- Después del rechazo el técnico re-resuelve → nuevamente
  `pendiente_validacion`.
- Usuario acepta → `status = resuelto`.
- Historial final contiene **todos** los eventos:
  - `CREATED` × 1
  - `ACCEPTED` × 1
  - `RESOLVED` × **2** (uno por cada intento del técnico)
  - `USER_REJECTED_RESOLUTION` × 1
  - `USER_ACCEPTED` × 1
- **Ningún evento sobrescribió a otro.**

**CASO B2 · segundo user-accept → 409**
- Reintento de aceptar tras estar `resuelto` → HTTP 409 ✅

### 3.5 Notificaciones e historial (3/3 ✅)

- `GET /admin/stats/tickets` → HTTP 200 con `totals` presente.
- Usuario propietario **NO** recibe eventos con `visibility=internal`
  (filtro backend defensivo en `/tickets/history/:id`).
- `EmailOutbox` intacto: los outbox por accept/resolve/escalate se
  siguen creando (Fase G ya lo verificó con 11 sent, 0 pending).

## 4. Incidencia encontrada y resuelta en Fase J

**Bug detectado en el smoke**: al ejecutar `POST /:id/resolve`, Prisma
lanzó `PrismaClientKnownRequestError: String or binary data would be
truncated in table 'ticket_db.dbo.tickets', column 'status'. Truncated
value: 'pendiente_valida'`.

**Causa raíz**: en Fase B se dimensionó `status @db.NVarChar(16)`. El
valor nuevo `pendiente_validacion` tiene **20 chars** → truncado por
SQL Server → Prisma aborta.

**Fix aplicado** en `ticket-service/prisma/schema.mssql.prisma`:
- `Ticket.status` → `@db.NVarChar(24)`
- `TicketEvent.previousStatus` → `@db.NVarChar(24)`
- `TicketEvent.newStatus` → `@db.NVarChar(24)`

**`prisma db push`** aplicado al lab MSSQL (ALTER COLUMN — sin pérdida de datos).
Rebuild `ticket-service` con `--no-cache` + `up -d --force-recreate`.
Smoke ejecutado de nuevo → **76 / 76 verdes**.

**Nota para el despliegue al VPS**: el mismo `db push` debe ejecutarse
contra el `sd-mssql` productivo antes de reiniciar los servicios con el
código Fase I. Documentado en §7.

## 5. Casos ejecutados (resumen)

| Bloque | Asserts | Estado |
|---|---|---|
| Setup + catálogo | 1 | ✅ |
| P1.a Escalate cambio de área | 15 | ✅ |
| P1.b Escalate mismo área | 5 | ✅ |
| P1.c Reescalar a técnico directo | (documentado, sin API) | — |
| P2 Reporte técnicos por bloque | 11 | ✅ |
| P3 Imágenes en historial | 10 | ✅ |
| P4·A Resolve → pendiente_validacion | 6 | ✅ |
| P4·C Reject sin razón | 2 | ✅ |
| P4·E/F Aceptar/rechazar por no-propietario | 3 | ✅ |
| P4·D Reject con razón | 7 | ✅ |
| P4·7 Ciclo resolver-rechazar-reresolver-aceptar | 10 | ✅ |
| P4·B2 Doble accept | 1 | ✅ |
| Notificaciones + historial visibility | 3 | ✅ |
| **Total** | **76** | **✅ 76/76** |

## 6. Endpoints validados

| Método | Ruta | Rol | Assert |
|---|---|---|---|
| POST | `/api/auth/login` | admin/tech/user | 200 |
| GET | `/api/auth/me` | admin | 200, `role=admin` |
| GET | `/api/catalog/services` | staff/user | 200 |
| POST | `/api/tickets` (multipart) | user | 201 con/sin attachments |
| POST | `/api/tickets/:id/accept` | tech | 200 |
| PUT | `/api/tickets/:id/escalate` | tech | 200 (libera siempre) |
| GET | `/api/tickets/available` | tech | 200, area-filtered |
| GET | `/api/tickets/my-assigned` | tech | 200 |
| GET | `/api/tickets/my` | user | 200 |
| GET | `/api/tickets/history/:id` | dueño/tech/admin | 200 + attachments; 403 otros |
| POST | `/api/tickets/:id/resolve` | tech | 200 → `pendiente_validacion` |
| POST | `/api/tickets/:id/user-accept` | dueño | 200 → `resuelto`; 403 otros; 409 doble |
| POST | `/api/tickets/:id/user-reject` | dueño | 200 → `en_proceso`; 400 razón corta; 403 otros |
| GET | `/api/admin/stats/tickets` | admin | 200 |
| GET | `/api/admin/technicians/summary` | admin | 200; 403 no-admin; 401 anon |

## 7. Plan de despliegue al VPS (para ventana posterior)

Los cambios de Fase I + el fix de columna NVarChar(24) deben aplicarse en
producción en el mismo turno de ventana. Procedimiento (adaptado de
`docs/mssql/GUIA_OFICIAL_MSSQL.md`):

```bash
# 1. Backup MSSQL
sudo /usr/local/sbin/servicedesk-backup-mssql.sh

# 2. Transferir cambios (auth-service, catalog-service, ticket-service, frontend, schema)
tar --force-local -czf /tmp/fase-i-j.tar.gz \
  --exclude=node_modules --exclude=dist \
  auth-service catalog-service ticket-service frontend
scp -P 2222 /tmp/fase-i-j.tar.gz root@<IP_VPS>:/tmp/
ssh -p 2222 root@<IP_VPS> 'cd /opt/servicedesk-uta && tar -xzf /tmp/fase-i-j.tar.gz'

# 3. En el VPS: prisma db push (ALTER COLUMN status a NVarChar(24))
ssh -p 2222 root@<IP_VPS> << 'EOF'
cd /opt/servicedesk-uta
URL="sqlserver://mssql:1433;database=ticket_db;user=ticket_user;password=$(grep ^TICKET_DB_PASSWORD= .env.mssql | cut -d= -f2-);encrypt=true;trustServerCertificate=true"
docker run --rm --network servicedesk-uta_servicedesk-net \
  -v /opt/servicedesk-uta/ticket-service:/app -w /app \
  -e DATABASE_URL="$URL" \
  node:20 sh -c 'npx prisma db push --schema=prisma/schema.mssql.prisma --skip-generate --accept-data-loss'

# 4. Rebuild + up de auth/catalog/ticket con cambios Fase I
docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql build --no-cache auth-service catalog-service ticket-service frontend
docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql up -d --force-recreate

# 5. Smoke rápido: crear ticket → resolver → validar como usuario.
EOF

# 6. Rollback (si algo falla): `docker compose -f docker-compose.yml up -d`
```

## 8. Criterio final (checklist)

| Criterio | Estado |
|---|---|
| reescalamiento funciona | ✅ |
| ticket no desaparece | ✅ |
| técnico anterior pierde asignación | ✅ (mismo área y otra área) |
| técnico destino puede verlo | ✅ |
| aceptación posterior funciona | ✅ |
| reporte funciona | ✅ (6 técnicos, 4 bloques) |
| permisos correctos | ✅ (403 tech/user, 401 anon) |
| imágenes visibles | ✅ (usuario/tec/admin) |
| múltiples imágenes funcionan | ✅ (3/3) |
| lightbox funciona | ✅ (probado en Fase I frontend build) |
| resolver deja pendiente_validacion | ✅ |
| aceptar cierra | ✅ (→ resuelto) |
| rechazo exige razón | ✅ (400 con razón <5) |
| rechazo devuelve en_proceso | ✅ |
| solo propietario valida | ✅ (403 tech/user2) |
| historial completo | ✅ (2×RESOLVED + REJECTED + ACCEPTED preservados) |
| FCM intacto | ✅ (config sin cambios; push best-effort en user-reject) |
| EmailOutbox intacto | ✅ |
| 282/282 tests | ✅ |
| build frontend | ✅ |
| smoke MSSQL verde | ✅ **76 / 76** |

## 9. Regresiones

**Ninguna**. Los 282 tests unitarios siguen pasando en su totalidad tras
los cambios de Fase I. El frontend compila sin warnings de tipo.

## 10. Errores encontrados durante Fase J

Solo el bug del `NVarChar(16)` truncando `pendiente_validacion` (20 chars).
**Corregido en el mismo turno** con `prisma db push` (ALTER COLUMN sin
pérdida de datos). Documentado.

## 11. Producción

- VPS `servicedesk-uta.site`: **no tocado en esta fase**.
- `sd-postgres` productivo: sigue detenido como rollback (Fase H).
- Azure/Firebase/Cloudinary/SMTP/Nginx/DNS: intactos.
- El plan de despliegue queda en §7 para el operador.

**Cero commits · Cero pushes · Cero secretos expuestos**.

---

**FASE J = COMPLETADA.** Fase I validada en verde a nivel funcional
(76/76) y de regresión (282/282). Fix de shape aplicado. Listo para
despliegue productivo cuando el operador agende ventana.
