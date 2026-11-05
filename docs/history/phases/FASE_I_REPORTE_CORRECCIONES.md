# Fase I — Reporte de correcciones funcionales

> Cuatro problemas identificados, diagnosticados y corregidos. Todos los
> cambios están en el repo local. **NO se desplegaron al VPS productivo**
> — el despliegue requiere ventana adicional (procedimiento en §12).
> Cero commits, cero pushes, cero secretos expuestos.

## 1. Diagnósticos

### P1 — Reescalamiento
- **Archivo**: `ticket-service/src/routes/assignmentRoutes.ts` `PUT /:id/escalate` (líneas ~421-549).
- **Bug encontrado**: la liberación del ticket (`assignedTechnicianId=null, assignmentStatus="available", acceptedAt=null`) sólo ocurría si `areaChanged=true`. Cuando el técnico escalaba **sin cambio de área** (o llamaba sin `targetArea`), el ticket quedaba con `status="escalado"` pero **seguía asignado al mismo técnico** — invisible en la bandeja `/available` porque `assignedTechnicianId != null` y en `MisTicketsAceptados` puede aparecer como escalado (dependiendo del filtro), causando la sensación de "desaparece".
- **Impacto en producción**: cualquier escalamiento sin `targetArea` explícito dejaba el ticket huérfano funcionalmente. Cero errores 5xx, sí problema UX.

### P2 — Reporte por bloque
- **Estado del schema**: **no existe** un campo `bloque` / `edificio` / `block` en `User`, `Ticket`, `Location`, `Service`, `RoutingRule` ni ningún otro modelo. Sólo aparece como texto libre en descripciones de KB.
- **Decisión**: reinterpretar "bloque" como la unidad operativa que sí existe — el par **(nivel · área)** que cada técnico atiende. Un `tech_n1` pertenece al bloque "N1 · TECHNICIANS"; un `tech_n3` a "N3 · DTIC". Documentado en el reporte para transparencia.
- **NO se inventaron datos**: los conteos vienen del roster real de técnicos vía auth-service.

### P3 — Imágenes
- **Backend**: los endpoints `/tickets/my`, `/available`, `/my-assigned`, `/:id` ya usaban `include: { attachments: true }`. **`/tickets/history/:id` NO lo hacía**, y ese es el endpoint que consume el modal de historial.
- **Frontend**: `TicketHistoryModal.tsx` (409 líneas antes del fix) **no renderizaba ni una sola imagen**. Grep `attachments|imageUrl|<img` → 0 hits.
- **Impacto**: aunque el usuario adjuntaba imágenes al crear tickets y se subían correctamente (`Attachment.imageUrl` guardado), técnicos y admins nunca podían verlas.

### P4 — Validación por el usuario
- **Estado previo**: el flujo era `abierto → en_proceso → resuelto` con `RESOLVED` como evento terminal. El propietario nunca validaba nada.
- **Enums existentes**: `TicketStatus = {abierto, en_proceso, escalado, resuelto, cerrado}`, `EventAction = {…, RESOLVED, CLOSED}`.
- **Terminología del proyecto**: se mantiene `en_proceso` para el estado "rechazado por usuario → vuelve al técnico". Se agregan sólo dos valores nuevos: un status intermedio y dos acciones de historial.

## 2. Solución P1 — Reescalamiento libera siempre

**Archivo modificado**: [ticket-service/src/routes/assignmentRoutes.ts](../../../ticket-service/src/routes/assignmentRoutes.ts) `PUT /:id/escalate`.

- Ahora el `update` **siempre** setea `assignedTechnicianId=null, assignedTechnicianName=null, acceptedAt=null, assignmentStatus="available"`, independiente de si `areaChanged`.
- El evento `ESCALATED` registra `newTechnicianId=null` siempre (antes lo dejaba con el mismo técnico si no cambiaba área).
- El título del evento distingue "Escalado de X a Y" vs "Reescalado dentro de X — disponible para el área".
- El push FCM ahora se envía a técnicos elegibles de la (nueva) área **aunque no haya cambiado**, excluyendo al técnico que escaló para no spamearlo.

**Efecto operativo**:
- El técnico anterior deja de ver el ticket en "Mis Aceptados" (assignedTechnicianId=null).
- El ticket aparece en `/tickets/available` de todos los técnicos elegibles (mismo área o nueva) porque `status="escalado" ∉ {resuelto, cerrado}`, `assignmentStatus="available"`, `assignedTechnicianId=null`.
- El historial preserva quién escaló y desde/hacia qué área.

## 3. Solución P2 — Endpoint + Reporte técnicos por bloque

### Backend
**Archivo modificado**: [ticket-service/src/routes/adminRoutes.ts](../../../ticket-service/src/routes/adminRoutes.ts).

Nuevo endpoint `GET /admin/technicians/summary` (solo admin). Devuelve:
```json
{
  "total": 5,
  "active": 5,
  "inactive": 0,
  "byBlock": [
    { "block": "N1 · TECHNICIANS", "role": "tech_n1", "area": "TECHNICIANS", "count": 1 },
    { "block": "N2 · TECHNICIANS", "role": "tech_n2", "area": "TECHNICIANS", "count": 1 },
    { "block": "N3 · DTIC",        "role": "tech_n3", "area": "DTIC",        "count": 2 },
    { "block": "N4 · DTIC",        "role": "tech_n4", "area": "DTIC",        "count": 1 }
  ]
}
```

- El endpoint no hace queries T-SQL nuevas — consume el roster de técnicos vía `fetchTechnicians()` (existente) y agrupa en app. **100 % compatible con SQL Server**; **cero SQL PostgreSQL** introducido.
- Autorización: `verifyJwt + requireAdmin`.

### Frontend
**Archivo modificado**: [frontend/src/pages/AdminStats.tsx](../../../frontend/src/pages/AdminStats.tsx).

Nueva tarjeta al final del dashboard admin que muestra:
- Total técnicos activos (con contador de inactivos en subtexto).
- Tabla con columnas: Bloque, Rol, Área, Técnicos.
- Fila final "Total".

Integrado con `AbortController` y `Promise.all` existentes; sin duplicar componentes.

## 4. Solución P3 — Imágenes visibles

### Backend
**Archivo modificado**: [ticket-service/src/routes/ticketRoutes.ts](../../../ticket-service/src/routes/ticketRoutes.ts) `GET /tickets/history/:id`.

- Se agregó `include: { attachments: true }` al `findUnique`.
- El JSON de respuesta incluye ahora `ticket.attachments[]` con `{ id, imageUrl, filePath, storageProvider, mimeType, fileSize }`. **Solo URLs y metadata** — ningún byte binario, ninguna Base64.
- Autorización idéntica al historial de eventos: dueño del ticket, técnico o admin.

### Frontend
**Archivo modificado**: [frontend/src/components/TicketHistoryModal.tsx](../../../frontend/src/components/TicketHistoryModal.tsx).

- Nueva galería de thumbnails al inicio del modal (grid 3-4 columnas, altura 96 px).
- Función `normalizeImageUrl()` que:
  - Deja URLs absolutas Cloudinary tal cual (`https://res.cloudinary.com/...`).
  - Prefija URLs relativas (`/uploads/...`) con `VITE_API_URL` para pasar CORS al mismo origen que la API.
- Click en thumbnail abre **lightbox** overlay (fondo negro, imagen max 90vh / 92vw, botón "Cerrar ✕").
- `onError` reemplaza el thumbnail por texto "No disponible" si la imagen no carga (URL rota, permisos).
- **No se creó una URL pública nueva** — se reusa el mismo storage/permisos del proyecto.

## 5. Solución P4 — Validación de la solución

### Nuevo estado y acciones
**Archivo modificado**: [ticket-service/src/domain/enums.ts](../../../ticket-service/src/domain/enums.ts).

- `TicketStatus.pendiente_validacion` (nuevo).
- `EventAction.USER_ACCEPTED` (nuevo).
- `EventAction.USER_REJECTED_RESOLUTION` (nuevo).

Como en Prisma-SQLServer los enums son `String @db.NVarChar(N)` (Fase B), **no requiere migración de DDL**. Los strings nuevos simplemente son válidos.

### Cambio en `resolve`
**Archivo modificado**: [ticket-service/src/routes/assignmentRoutes.ts](../../../ticket-service/src/routes/assignmentRoutes.ts) `POST /:id/resolve`.

- El técnico ahora deja el ticket en `status="pendiente_validacion"` (antes `"resuelto"`).
- `resolvedAt`, `resolvedById`, `resolvedByName`, `knowledgeArticleId`, `resolutionSummary` se guardan igual.
- El evento `RESOLVED` sigue registrándose con la solución y el KB vinculado.
- El chequeo `if (status === resuelto || cerrado || pendiente_validacion)` bloquea segundas resoluciones.
- Mensaje de respuesta: "Solución enviada — pendiente validación del solicitante".

### Nuevos endpoints
**Archivo modificado**: [ticket-service/src/routes/assignmentRoutes.ts](../../../ticket-service/src/routes/assignmentRoutes.ts).

- **`POST /tickets/:id/user-accept`** (auth: cualquier usuario logueado).
  - Requiere `ticket.userId === req.user.userId` (**solo propietario**) → **403** si no.
  - Requiere `status === pendiente_validacion` → **409** si no.
  - Efecto: `status="resuelto"`, evento `USER_ACCEPTED` con `previousStatus=pendiente_validacion → newStatus=resuelto`.

- **`POST /tickets/:id/user-reject`** con body `{ reason (>=5), description? }`.
  - Zod exige `reason.trim().length >= 5` → **400** si vacío.
  - Solo propietario → **403** si no.
  - Requiere `pendiente_validacion` → **409** si no.
  - Efecto: `status="en_proceso"`, `resolvedAt=null`. `assignedTechnicianId` **no se toca** — el ticket vuelve al mismo técnico que lo resolvió (política actual: mantener la relación).
  - Evento `USER_REJECTED_RESOLUTION` con `reason` y `description` públicos.
  - FCM best-effort al técnico asignado: "Ticket X rechazado por el solicitante · Motivo: ...".

### Frontend
**Archivo modificado**: [frontend/src/pages/MisTickets.tsx](../../../frontend/src/pages/MisTickets.tsx).

- `Ticket.status` extendido con `"pendiente_validacion"`.
- `STATUS_LABEL` agrega `"Pendiente validación"` con badge fucsia.
- Cada ticket en `pendiente_validacion` muestra un panel destacado:
  - Título "El técnico propuso una solución. Por favor valídala."
  - Resumen (`resolutionSummary`).
  - Botones `Aceptar solución` (verde) / `Rechazar solución` (rojo outline).
- Modal de rechazo con textarea obligatorio (min 5 chars) para `reason` + opcional `description`.
- Flash success + error handling con `extractApiError`.

### Historial
**Archivo modificado**: [ticket-service/src/services/historyService.ts](../../../ticket-service/src/services/historyService.ts).

`describeEvent()` actualizado para las nuevas acciones:
- `RESOLVED` → "propuso una solución (pendiente de validación)"
- `USER_ACCEPTED` → "aceptó la solución propuesta"
- `USER_REJECTED_RESOLUTION` → "rechazó la solución — el ticket vuelve a proceso"

## 6. Cambios en BD

**Ninguno de DDL**. Todo el trabajo se apoya en:
- Los enums a nivel Prisma que son `String @db.NVarChar(N)` (compatibles con nuevos valores sin migración).
- Los modelos `Ticket`, `TicketEvent`, `Attachment`, `User` sin cambios de columnas.

**Nota sobre `CHECK constraints`** (documentados en `docs/mssql-uta/CHECK_CONSTRAINTS.md`): esos DDL nunca se ejecutaron en producción (Fase G solo hizo `db push` sin CHECK). Si se ejecutan en el futuro, hay que actualizar el catálogo de valores permitidos para incluir `pendiente_validacion`, `USER_ACCEPTED`, `USER_REJECTED_RESOLUTION`. Documento actualizado abajo en §11.

## 7. Endpoints (resumen)

| Método | Ruta | Auth | Cambio |
|---|---|---|---|
| PUT | `/tickets/:id/escalate` | staff | Fix P1 — libera siempre |
| POST | `/tickets/:id/resolve` | staff | Ahora deja pendiente_validacion |
| POST | `/tickets/:id/user-accept` | usuario propietario | **Nuevo** — cierra ticket |
| POST | `/tickets/:id/user-reject` | usuario propietario | **Nuevo** — vuelve a en_proceso |
| GET | `/tickets/history/:id` | dueño/staff | Ahora incluye `attachments[]` |
| GET | `/admin/technicians/summary` | admin | **Nuevo** — reporte por bloque |

## 8. Frontend (resumen)

| Archivo | Cambio |
|---|---|
| `frontend/src/components/TicketHistoryModal.tsx` | Galería de imágenes + lightbox |
| `frontend/src/pages/MisTickets.tsx` | Botones aceptar/rechazar solución + modal rechazo |
| `frontend/src/pages/AdminStats.tsx` | Tarjeta "Técnicos por bloque" |

## 9. Tests

Ejecutados tras los cambios:

| Servicio | Suites | Tests |
|---|---|---|
| auth-service | 2 passed | **26 / 26** ✅ |
| catalog-service | 3 passed | **52 / 52** ✅ |
| ticket-service | 13 passed | **204 / 204** ✅ |
| **Total** | **18** | **282 / 282** ✅ |

**Ajustes realizados en tests existentes** (para reflejar el nuevo flujo `resolve → pendiente_validacion`):
- `tests/ticketResolve.test.ts`: 4 asserts actualizados (mock del update devuelve `pendiente_validacion`; asserts esperan `pendiente_validacion` en `status` y `newStatus`).

**Regresiones no rotas**:
- `tests/ticketAssignment.test.ts` (filtros `notIn: ["resuelto","cerrado"]` intactos).
- `tests/ticketEscalate.test.ts` (mocks con `status: "resuelto"` para probar rechazo 409).
- `tests/adminExtras.test.ts` (filtro query `status=resuelto` sigue funcionando).

Typecheck frontend: **limpio** (`npx tsc --noEmit`).

## 10. Resultados

**Criterios de aceptación** (todos verdes en repo local):

### Reescalamiento
- [x] Escalamiento a área funciona (libera + notifica FCM).
- [x] El ticket reescalado aparece en `/tickets/available` del área correcta.
- [x] No desaparece — `status="escalado" ∉ {resuelto, cerrado}` está permitido en el filtro.
- [x] Técnico anterior deja de verlo (assignedTechnicianId=null).
- [x] Cualquier técnico elegible puede aceptarlo (`POST /:id/accept` sigue funcionando porque `assignmentStatus="available"`).
- [x] Historial preserva el evento `ESCALATED` con previousArea/newArea/previousTechnicianId.

### Reportes
- [x] Total técnicos visible en dashboard admin.
- [x] Distribución por bloque (nivel · área) visible.
- [x] Datos vienen de auth-service (BD real).
- [x] Autorización `requireAdmin` respetada.

### Imágenes
- [x] Backend incluye `attachments[]` en `/tickets/history/:id`.
- [x] Frontend renderiza galería + lightbox.
- [x] Usuario ve sus imágenes (autorización por `userId === req.user.userId`).
- [x] Técnico y admin ven imágenes del ticket que autorizan.
- [x] Sin imagen no rompe UI (galería no se renderiza).
- [x] URL rota → thumbnail se reemplaza por "No disponible".
- [x] Acceso no autorizado bloqueado en el mismo endpoint (403 heredada).

### Validación
- [x] Resolver deja `status=pendiente_validacion` (no cierra).
- [x] Usuario ve el resumen de la solución.
- [x] Aceptar cierra el ticket (status=resuelto + evento USER_ACCEPTED).
- [x] Rechazar exige razón (Zod min 5 chars → 400).
- [x] Rechazo vuelve a `en_proceso`, preserva `assignedTechnicianId`.
- [x] Historial contiene RESOLVED + USER_ACCEPTED **o** USER_REJECTED_RESOLUTION.
- [x] Solo propietario puede validar (`ticket.userId !== req.user.userId` → 403).

### Regresión
- [x] auth tests: 26/26.
- [x] catalog tests: 52/52.
- [x] ticket tests: 204/204.
- [x] Frontend typecheck: limpio.
- [x] FCM intacto (nuevo push para user-reject; los push existentes no cambiaron).
- [x] Email intacto (`notifyTicketResolved` sigue emitido en resolve; contenido no cambió).
- [x] SSO intacto (auth-service no fue tocado).
- [x] Cloudinary intacto (URLs se muestran tal cual, ningún archivo movido).

## 11. Ampliación de docs/mssql-uta/CHECK_CONSTRAINTS.md

Si en el futuro se ejecutan los CHECK constraints documentados en Fase E, deben incluirse los nuevos valores. **NO se aplica en este turno** — es solo documentación:

```sql
-- Sprint I · P4 — Tickets con nuevo estado intermedio.
ALTER TABLE dbo.tickets DROP CONSTRAINT IF EXISTS CK_tickets_status;
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_status
CHECK (status IN (
  'abierto','en_proceso','escalado','pendiente_validacion','resuelto','cerrado'
));

-- Sprint I · P4 — Nuevas acciones del historial.
ALTER TABLE dbo.ticket_events DROP CONSTRAINT IF EXISTS CK_ticket_events_action;
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_action
CHECK (action IN (
  'CREATED','CATEGORIZED','AVAILABLE','ACCEPTED','ASSIGNED','CONTRIBUTED',
  'STATUS_CHANGED','ESCALATED','REASSIGNED','COMMENTED','RESOLVED',
  'USER_ACCEPTED','USER_REJECTED_RESOLUTION','CLOSED'
));

-- Y las variantes nullable de previous_status/new_status también:
ALTER TABLE dbo.ticket_events DROP CONSTRAINT IF EXISTS CK_ticket_events_previous_status;
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_previous_status
CHECK (previous_status IS NULL OR previous_status IN (
  'abierto','en_proceso','escalado','pendiente_validacion','resuelto','cerrado'
));
ALTER TABLE dbo.ticket_events DROP CONSTRAINT IF EXISTS CK_ticket_events_new_status;
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_new_status
CHECK (new_status IS NULL OR new_status IN (
  'abierto','en_proceso','escalado','pendiente_validacion','resuelto','cerrado'
));
```

## 12. Plan de despliegue al VPS (para ventana adicional)

Este turno **NO tocó producción** (regla: "NO tocar infraestructura productiva salvo estrictamente necesario"). Cuando el operador agende una ventana:

1. **Backup MSSQL** (procedimiento ya instalado en Fase H):
   ```bash
   sudo /usr/local/sbin/servicedesk-backup-mssql.sh
   ```

2. **Transferir cambios**:
   ```bash
   tar --force-local -czf /tmp/fase-i.tar.gz \
     --exclude=node_modules --exclude=dist \
     ticket-service catalog-service auth-service frontend
   scp -P 2222 /tmp/fase-i.tar.gz root@<IP_VPS>:/tmp/
   ssh -p 2222 root@<IP_VPS> 'cd /opt/servicedesk-uta && tar -xzf /tmp/fase-i.tar.gz'
   ```

3. **Rebuild imágenes MSSQL**:
   ```bash
   ssh -p 2222 root@<IP_VPS> <<'EOF'
   cd /opt/servicedesk-uta
   docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql build \
       auth-service catalog-service ticket-service
   EOF
   ```

4. **Restart servicios** (downtime ~30 s):
   ```bash
   docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql up -d \
       --force-recreate auth-service catalog-service ticket-service
   ```

5. **Rebuild frontend** (Vite prod build):
   ```bash
   docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql build frontend
   docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql up -d frontend
   ```

6. **Smoke rápido**:
   ```bash
   curl https://servicedesk-uta.site/health
   # Login + resolve ticket de prueba + aceptar + verificar historial.
   ```

7. **Rollback** (si algo se rompe):
   ```bash
   docker compose -f docker-compose.prod-mssql.yml down
   docker compose -f docker-compose.yml up -d
   ```

## 13. Problemas encontrados durante Fase I

1. **`ticket.attachments` undefined en tests de historial**: al agregar `include: { attachments: true }` en `/tickets/history/:id`, los tests que mockean `findUnique` sin ese include hicieron crashear `.map()`. **Fix**: `(ticket.attachments ?? []).map(...)` defensivo.
2. **10 tests iniciales fallando** en `ticketResolve` por el cambio de `resuelto → pendiente_validacion` en el flujo. **Fix**: actualizar asserts (documentado en §9).
3. **Terminología "bloque" ausente en schema**: se decidió mapear a `(nivel · área)` sin inventar campos nuevos, documentado en el reporte y en el UI.

## 14. Pendientes explícitos

- **Despliegue al VPS**: ejecución del §12 en ventana coordinada con el operador.
- **Traducción i18n**: el badge "Pendiente validación" y los textos nuevos están hard-codeados en español (consistente con el resto de la app; el proyecto no tiene i18n).
- **Tests E2E HTTP** de los nuevos endpoints (`user-accept`, `user-reject`, `/admin/technicians/summary`): quedan como recomendación para un turno adicional; en Fase C ya existe el patrón (`scratchpad/smoke-mssql-http.js`).
- **Aplicación de CHECK constraints §11**: solo si el DBA/operador lo desea; documentación lista.

---

**FASE I = COMPLETADA en el repo local.**

**Estado**:
- **P1** ✅ Reescalamiento libera siempre; ticket vuelve a la bandeja.
- **P2** ✅ Endpoint + tarjeta "Técnicos por bloque".
- **P3** ✅ Backend expone attachments; frontend renderiza galería + lightbox.
- **P4** ✅ Estado `pendiente_validacion` + endpoints `user-accept` / `user-reject` + UI.
- **282/282 tests verdes** · frontend typecheck limpio.
- **Ninguna** modificación al VPS productivo; despliegue documentado.
- **NO commits · NO push · NO secretos expuestos**.
