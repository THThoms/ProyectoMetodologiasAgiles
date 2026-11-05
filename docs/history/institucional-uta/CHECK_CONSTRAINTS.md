# CHECK constraints propuestos para SQL Server UTA

Al portar los enums Prisma a `NVarChar` (obligado por la limitación
Prisma-SQLServer), el motor deja de validar el dominio de esas columnas. Este
documento reúne el DDL exacto para reponer esa validación con `CHECK`
constraints una vez que las bases UTA estén creadas y aprobadas.

⚠️  **No se ejecuta nada de este documento en Fase E**. La aplicación es la que
sigue validando los valores permitidos (con Zod y con las constantes
`src/domain/enums.ts`), así que no hay riesgo si el DBA aún no aplica estos
constraints. Se agregan en la Fase F como red de seguridad institucional.

## 1. Convención de nombres

`CK_<tabla>_<columna>` — legible en `sys.check_constraints` para auditoría.

## 2. auth_db

### `dbo.users.role` — `Role`

Valores permitidos: `admin`, `tech_n1`, `tech_n2`, `tech_n3`, `tech_n4`, `user`.

```sql
ALTER TABLE dbo.users
ADD CONSTRAINT CK_users_role
CHECK (role IN ('admin','tech_n1','tech_n2','tech_n3','tech_n4','user'));
```

## 3. catalog_db

### `dbo.services.level_entry` — `Level`

Valores permitidos: `N1`, `N2`, `N3`, `N4`.

```sql
ALTER TABLE dbo.services
ADD CONSTRAINT CK_services_level_entry
CHECK (level_entry IN ('N1','N2','N3','N4'));
```

### `dbo.services.responsible_area` — `ResponsibleArea`

Valores permitidos: `TECHNICIANS`, `DTIC`. Prohibidos: `GENERAL`, `TICs`
(eliminados en Sprint 3).

```sql
ALTER TABLE dbo.services
ADD CONSTRAINT CK_services_responsible_area
CHECK (responsible_area IN ('TECHNICIANS','DTIC'));
```

### `dbo.routing_rules.level_entry` / `priority_high` / `priority_critical`

```sql
ALTER TABLE dbo.routing_rules
ADD CONSTRAINT CK_routing_rules_level_entry
CHECK (level_entry IN ('N1','N2','N3','N4'));

ALTER TABLE dbo.routing_rules
ADD CONSTRAINT CK_routing_rules_priority_high
CHECK (priority_high IS NULL OR priority_high IN ('N1','N2','N3','N4'));

ALTER TABLE dbo.routing_rules
ADD CONSTRAINT CK_routing_rules_priority_critical
CHECK (priority_critical IS NULL OR priority_critical IN ('N1','N2','N3','N4'));
```

## 4. ticket_db

### `dbo.tickets.status` — `TicketStatus`

Valores permitidos: `abierto`, `en_proceso`, `escalado`, `resuelto`, `cerrado`.

```sql
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_status
CHECK (status IN ('abierto','en_proceso','escalado','resuelto','cerrado'));
```

### `dbo.tickets.priority` — `Priority`

Valores permitidos: `baja`, `media`, `alta`, `critica`.

```sql
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_priority
CHECK (priority IN ('baja','media','alta','critica'));
```

### `dbo.tickets.responsible_area` — `ResponsibleArea`

```sql
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_responsible_area
CHECK (responsible_area IN ('TECHNICIANS','DTIC'));
```

### `dbo.tickets.assignment_status` — `AssignmentStatus`

Valores permitidos: `unassigned`, `available`, `accepted`, `assigned_by_admin`.

```sql
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_assignment_status
CHECK (assignment_status IN ('unassigned','available','accepted','assigned_by_admin'));
```

### `dbo.tickets.level_assigned` — `Level`

```sql
ALTER TABLE dbo.tickets
ADD CONSTRAINT CK_tickets_level_assigned
CHECK (level_assigned IN ('N1','N2','N3','N4'));
```

### `dbo.ticket_events.action` — `EventAction`

Valores permitidos: `CREATED`, `CATEGORIZED`, `AVAILABLE`, `ACCEPTED`,
`ASSIGNED`, `CONTRIBUTED`, `STATUS_CHANGED`, `ESCALATED`, `REASSIGNED`,
`COMMENTED`, `RESOLVED`, `CLOSED`.

```sql
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_action
CHECK (action IN (
  'CREATED','CATEGORIZED','AVAILABLE','ACCEPTED','ASSIGNED','CONTRIBUTED',
  'STATUS_CHANGED','ESCALATED','REASSIGNED','COMMENTED','RESOLVED','CLOSED'
));
```

### `dbo.ticket_events.visibility` — `EventVisibility`

```sql
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_visibility
CHECK (visibility IN ('public','internal'));
```

### `dbo.ticket_events` transiciones (nullable enums)

```sql
ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_previous_level
CHECK (previous_level IS NULL OR previous_level IN ('N1','N2','N3','N4'));

ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_new_level
CHECK (new_level IS NULL OR new_level IN ('N1','N2','N3','N4'));

ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_previous_status
CHECK (previous_status IS NULL OR previous_status IN (
  'abierto','en_proceso','escalado','resuelto','cerrado'
));

ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_new_status
CHECK (new_status IS NULL OR new_status IN (
  'abierto','en_proceso','escalado','resuelto','cerrado'
));

ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_previous_area
CHECK (previous_area IS NULL OR previous_area IN ('TECHNICIANS','DTIC'));

ALTER TABLE dbo.ticket_events
ADD CONSTRAINT CK_ticket_events_new_area
CHECK (new_area IS NULL OR new_area IN ('TECHNICIANS','DTIC'));
```

### `dbo.email_outbox.status` — `EmailStatus`

Valores permitidos: `pending`, `sent`, `failed`.

```sql
ALTER TABLE dbo.email_outbox
ADD CONSTRAINT CK_email_outbox_status
CHECK (status IN ('pending','sent','failed'));
```

### `dbo.device_tokens.platform`

Valores permitidos: `android`, `ios`, `web`.

```sql
ALTER TABLE dbo.device_tokens
ADD CONSTRAINT CK_device_tokens_platform
CHECK (platform IN ('android','ios','web'));
```

## 5. Filtered unique index — `users.ms_oid`

No es un CHECK constraint, pero pertenece al mismo paquete de invariantes que
Prisma no expresa:

```sql
-- Sesión con QUOTED_IDENTIFIER ON (obligatorio para filtered indexes).
SET QUOTED_IDENTIFIER ON;
CREATE UNIQUE INDEX users_ms_oid_key_filtered
ON dbo.users (ms_oid)
WHERE ms_oid IS NOT NULL;
```

## 6. Aplicación

Los CHECK constraints y el filtered index se aplican **después** del primer
`prisma db push` contra la instancia UTA, y **antes** de la ventana de
migración de datos productivos. Se pueden ejecutar dentro de una única sesión
`sqlcmd` desde el VPS (o desde la máquina del DBA), sin necesidad de bajar los
servicios.

## 7. Rollback

Para revertir un CHECK constraint específico:

```sql
ALTER TABLE dbo.<tabla> DROP CONSTRAINT <CK_...>;
```

Rollback del filtered index:

```sql
DROP INDEX users_ms_oid_key_filtered ON dbo.users;
```
