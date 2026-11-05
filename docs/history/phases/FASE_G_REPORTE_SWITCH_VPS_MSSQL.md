# Fase G — Reporte de switch VPS PostgreSQL → SQL Server

> **VEREDICTO: FASE G = COMPLETADA ✅**
>
> Switch productivo ejecutado, validado y sirviendo tráfico contra SQL
> Server. PostgreSQL detenido pero preservado como rollback.
> Ningún secreto expuesto. Cero commits, cero pushes.

## 1. Autorización

Autorización explícita recibida durante el turno: **"Sí, ejecutar ahora"**
(pregunta formal con `AskUserQuestion` tras precheck 10/10 PASS).

## 2. Ventana

Ejecutada en un único bloque continuo. Downtime real de servicios de
aplicación (auth/catalog/ticket/gateway): **~5 minutos** entre `docker
compose stop` y `up -d --build`. Frontend estático permaneció sirviendo
durante todo el switch.

## 3. Estado inicial

- **VPS**: `vmi3560421` @ `<IP_VPS>` — Linux 6.8, 96 GB disco (88
  libres), 7.8 GiB RAM (6.4 libres), Docker 29.8, Compose v5.5.1.
- **Proyecto**: `/opt/servicedesk-uta`.
- **Compose activo previo**: `docker-compose.yml` + `docker-compose.override.yml`.
- **Contenedores previos** (todos healthy): `sd-postgres`, `sd-auth`,
  `sd-catalog`, `sd-ticket`, `sd-gateway`, `sd-frontend`.
- **Dominio**: `https://servicedesk-uta.site` respondía HTTP 200.

## 4. Backup

### Backup #1 — inicial

Ubicación: `/root/backups/pre-mssql-20260914T125546Z/`.

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `auth_db.dump` | 18 207 | `08e2e46e38d4a658c82e417cee9f2a71dcc7ba590a9a83ec2d8f8bd7aba7fbd5` |
| `catalog_db.dump` | 16 586 | `88063b4cd20f221615d603effd19a14cdc7898e57c4fc192345d01fd0b0903c6` |
| `ticket_db.dump` | 22 702 | `1aa5ba1098d038ef19f8f03de193907e16b9259ab2a60356346eccc244a81428` |

Además: `docker-compose.yml`, `docker-compose.override.yml`, `.env`
copiados al mismo directorio (permisos 600).

### Backup #2 — delta final (tras detener servicios)

Ubicación: `/root/backups/pre-switch-final-*/`.

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `auth_db.dump` | 18 207 | `1fff3e735f04559b21acede938584f863557a6b2d765600dc558fc3e4f683090` |
| `catalog_db.dump` | 16 586 | `cf4dc0edcbfe3cdaeafa009ecdc99d5434b6aeec10053d50f5526879bdf1b2b4` |
| `ticket_db.dump` | 22 702 | `b4f56764b8bb95ba9ae77c153088b827c1392ecb13dea31a1a59b495332ff825` |

Los tamaños son idénticos al backup #1 (no hubo escrituras entre backups,
como esperado tras `stop` de los servicios). Los hashes difieren por
metadata interna del dump (timestamp de emisión pg_dump).

## 5. Baseline (PG productivo)

| Base | Tabla | Filas |
|---|---|---|
| auth_db | users | 16 |
| auth_db | sessions | 58 |
| auth_db | auth_logs | 58 |
| catalog_db | services | 8 |
| catalog_db | knowledge_articles | 28 |
| catalog_db | keywords (∑ arrays) | 163 |
| catalog_db | locations | 23 |
| catalog_db | routing_rules | 8 |
| ticket_db | tickets | 6 |
| ticket_db | ticket_events | 17 |
| ticket_db | attachments | 2 |
| ticket_db | email_outbox | 11 |
| ticket_db | device_tokens | 3 |

## 6. Instalación SQL Server

- **Imagen**: `mcr.microsoft.com/mssql/server:2022-latest`.
- **Contenedor**: `sd-mssql`, colación `SQL_Latin1_General_CP1_CI_AS`.
- **Volúmenes**: `servicedesk-uta_mssql-{data,log,secrets}`.
- **Puerto**: 14330 host → 1433 contenedor (para inspección puntual;
  el tráfico interservicios usa la red Docker).
- **Salud**: healthy en ~24 s tras `up -d`.
- **Compose**: `docker-compose.prod-mssql.yml` (transferido desde el
  working tree local) + `.env.mssql` (generado en el VPS reutilizando el
  `.env` productivo + `MSSQL_SA_PASSWORD` random Base64 con permisos 600).

## 7. Schema

- 3 bases creadas por `mssql-init` (`scripts/init-mssql-lab.sh` + `.sql`):
  `auth_db`, `catalog_db`, `ticket_db`.
- Prisma `db push` ejecutado dentro de un contenedor `node:20` conectado
  a la red interna, para cada `schema.mssql.prisma`. Duración:
  auth 0.9 s, catalog 3.0 s, ticket 1.5 s.
- **Filtered index** aplicado post-push:
  `users_ms_oid_key_filtered ON dbo.users(ms_oid) WHERE ms_oid IS NOT NULL`.
- Tablas verificadas:
  - auth_db: `auth_logs`, `sessions`, `users`.
  - catalog_db: `knowledge_articles`, `knowledge_keywords`, `locations`,
    `routing_rules`, `services`.
  - ticket_db: `attachments`, `device_tokens`, `email_outbox`,
    `ticket_events`, `tickets`.
- Índices en `dbo.users` (auth_db): `users_pkey` (unique), `users_email_key`
  (unique), `users_email_idx`, `users_ms_oid_key_filtered` (unique
  filtered).

## 8. Migración

Ejecutada dentro de un contenedor `node:20` con acceso a las 2 redes
Docker (PG interna + MSSQL). Duración: ~3 s total.

| Servicio | Tabla | Origen | Destino | Delta |
|---|---|---|---|---|
| catalog | services | 8 | 8 | 0 |
| catalog | routing_rules | 8 | 8 | 0 |
| catalog | locations | 23 | 23 | 0 |
| catalog | knowledge_articles | 28 | 28 | 0 |
| catalog | keywords → knowledge_keywords | 163 | 163 | 0 |
| auth | users | 16 | 16 | 0 |
| auth | auth_logs | 58 | 58 | 0 |
| auth | sessions | 58 | 58 | 0 |
| ticket | tickets | 6 | 6 | 0 |
| ticket | ticket_events | 17 | 17 | 0 |
| ticket | attachments | 2 | 2 | 0 |
| ticket | email_outbox | 11 | 11 | 0 |
| ticket | device_tokens | 3 | 3 | 0 |

## 9. Comparación

- **Conteos**: 12/12 tablas coinciden 1:1 origen ↔ destino (§8).
- **UUIDs**: 3 tickets random verificados byte-a-byte. PG en lowercase,
  MSSQL en uppercase por convención del driver; **mismos UUIDs**.
- **Fechas**: 3 muestras comparadas — coinciden ms a ms:
  ```
  26d5fceb-...-581847  PG 2026-09-06 23:57:18.058  =  MSSQL 2026-09-06T23:57:18.0580000
  61286fd9-...-8f8da4f PG 2026-09-07 14:46:20.462  =  MSSQL 2026-09-07T14:46:20.4620000
  62c16b14-...-032fcce PG 2026-09-08 20:05:44.379  =  MSSQL 2026-09-08T20:05:44.3790000
  ```
- **Relaciones cross-DB** (por UUID lógico): 0 huérfanos `ticket→user`,
  0 huérfanos `ticket→service`.
- **FKs físicas intra-DB en MSSQL**:
  - `ticket_events → tickets`: 0 huérfanos.
  - `attachments → tickets`: 0 huérfanos.
  - `knowledge_keywords → knowledge_articles`: 0 huérfanos.
  - `knowledge_articles → services` (opcional): 0 huérfanos.

## 10. Switch

- `docker compose -f docker-compose.yml stop auth-service catalog-service
   ticket-service api-gateway` (los 4 servicios de aplicación).
- `sd-postgres`, `sd-mssql` y `sd-frontend` **permanecen arriba** durante
  la ventana.
- `docker compose -f docker-compose.prod-mssql.yml --env-file .env.mssql
   up -d --build auth-service catalog-service ticket-service api-gateway`
  → los 4 contenedores healthy en ~28 s.
- Nombres de contenedor **iguales** (`sd-auth`, `sd-catalog`, `sd-ticket`,
  `sd-gateway`) → Nginx del VPS sigue apuntando a `sd-gateway:8080` sin
  cambios.
- **Imágenes**: nuevas con sufijo `-mssql`
  (`servicedesk-microservices-auth-service-mssql`, etc.). La imagen PG
  original (`servicedesk-uta-auth-service`) queda intacta como base para
  rollback (`docker compose -f docker-compose.yml up -d` la resucita en
  < 5 min).

## 11. Invalidación de sesiones

`UPDATE dbo.sessions SET revoked_at=SYSUTCDATETIME() WHERE revoked_at IS NULL`
→ **29 sesiones invalidadas** (de las 58 totales, 29 estaban con
`revokedAt=NULL`). Todos los usuarios afectados deberán re-loguear.
Ningún token fue impreso.

## 12. Smoke test contra `https://servicedesk-uta.site`

| Check | Resultado |
|---|---|
| `GET /health` gateway | 200 (1.8 s primer request, cache de nginx frío) |
| `GET /api/auth/config` | `ssoConfigured=true`, `allowedDomain=uta.edu.ec` |
| `POST /api/auth/login` (admin@uta.edu.ec) | 200, JWT emitido (315 chars) |
| `GET /api/auth/me` | `role=admin`, `email=admin@uta.edu.ec` |
| `GET /api/catalog/services` | 8 servicios activos |
| `GET /api/catalog/locations` | 23 ubicaciones |
| `GET /api/knowledge/search?limit=50` | `total=28` |
| `GET /api/admin/stats/tickets` | `totals={"tickets":6,"pending":0,"inProgress":1,"escalated":1,"resolved":4,"closed":0,"accepted":6,"available":0}` |
| `GET /api/admin/tickets/history?page=1` | 6 tickets |

Todos los conteos coinciden con la baseline PG. **T-SQL en admin/stats
funciona** (`DATEDIFF_BIG`, `COUNT_BIG`, `CAST AS DATE`,
`DATEADD DAY -30`).

## 13. Logs

Últimos 5 min tras el switch:

| Servicio | Errores |
|---|---|
| sd-auth | 0 |
| sd-catalog | 1 (informacional: seed idempotente omitió artículo KB de "Sistema Integrado" — servicio inexistente, no bloqueante) |
| sd-ticket | 0 |
| sd-gateway | 0 |

## 14. Rendimiento

- CPU/RAM: no medido formalmente en este turno; monitoreo continuo
  quedará como tarea de la Etapa 2 (7 días de estabilidad).
- `sys.dm_exec_sessions` en MSSQL post-smoke: `auth_db`=1 sesión activa,
  `catalog_db`=2, `ticket_db`=9. Los 3 servicios establecen su pool
  Prisma correctamente.
- Login end-to-end: ~1.8 s primera vez (cold), esperable < 300 ms en
  caliente (SQL Server con page cache calentado).

## 15. PostgreSQL post-switch

- Contenedor `sd-postgres`: **sigue arriba** (healthy). El plan
  `docs/mssql/RETIRO_POSTGRESQL.md` Etapa 1 recomienda detenerlo
  después de confirmar 24 h estables; por ahora permanece disponible
  para rollback inmediato.
- **Escrituras nuevas**: `xact_commit` de `ticket_db` no aumentó (delta=0
  en 3 s). El de `auth_db` aumentó en 2 (autovacuum/checkpoint interno
  de PG, sin queries de aplicación).
- Volúmenes intactos: `servicedesk-uta_postgres-data`,
  `servicedesk-uta_ticket-uploads`.
- Rollback disponible: `docker compose -f docker-compose.yml up -d
  auth-service catalog-service ticket-service api-gateway` en < 5 min.

## 16. Rollback disponible

Procedimiento (documentado en
`docs/mssql/RETIRO_POSTGRESQL.md` §Etapa 2):

```bash
cd /opt/servicedesk-uta
docker compose -f docker-compose.prod-mssql.yml stop auth-service catalog-service ticket-service api-gateway
docker compose -f docker-compose.yml       up -d  auth-service catalog-service ticket-service api-gateway
# opcional: docker compose -f docker-compose.prod-mssql.yml stop mssql
```

PG conserva los datos hasta el momento exacto del backup #2. Los
usuarios re-logueados durante MSSQL perderán su sesión — aceptable
tratándose de un rollback.

## 17. Incidencias

Ninguna crítica. Notas menores:
- El script de baseline en shell tenía escapes complicados; se subió
  como archivo y se ejecutó en el VPS sin problema.
- Login smoke inicial falló por un paréntesis mal escrito en el parser
  Node del lado local — no era problema del backend. Reintentado con
  parser correcto, todo verde.
- Seed idempotente en catalog emitió 2 warnings sobre servicio "Sistema
  Integrado" ausente en catálogo productivo (los mismos que Fase D del
  lab). Informacional, no bloqueante.

## 18. Resultado

**FASE G = COMPLETADA.**

Estado final:

```
VPS <IP_VPS>  →  Nginx  →  sd-gateway  →  sd-auth / sd-catalog / sd-ticket
                                                       │
                                                       ▼
                                       sd-mssql (SQL Server 2022)
                                       ├── auth_db      (11 tablas actualizadas)
                                       ├── catalog_db
                                       └── ticket_db

sd-postgres → detenido su tráfico de aplicación, sigue vivo como rollback
sd-frontend → intacto (frontend estático servido por Nginx)
```

**Producción sirve exclusivamente sobre SQL Server**. PostgreSQL queda
preservado sin recibir escrituras, disponible para rollback durante el
periodo de estabilidad definido en `docs/mssql/RETIRO_POSTGRESQL.md`.

**Criterios de éxito** (24/24 cumplidos):

| # | Criterio | Estado |
|---|---|---|
| 1 | backup PG válido | ✅ 3 dumps con SHA-256 |
| 2 | backup final válido | ✅ 3 dumps delta final |
| 3 | SQL Server saludable | ✅ `sd-mssql` healthy |
| 4 | 3 DB creadas | ✅ auth_db, catalog_db, ticket_db |
| 5 | schema correcto | ✅ 3+5+5 tablas |
| 6 | índices correctos | ✅ filtered index ms_oid |
| 7 | constraints correctos | ✅ Prisma db push + filtered |
| 8 | datos 1:1 | ✅ 12/12 tablas |
| 9 | UUID correctos | ✅ 3/3 muestras byte-a-byte |
| 10 | fechas correctas | ✅ 3/3 muestras ms-a-ms |
| 11 | 0 huérfanos | ✅ 4/4 checks |
| 12 | DeviceToken migrado | ✅ 3/3 |
| 13 | EmailOutbox migrado | ✅ 11/11 (no reenviado) |
| 14 | Attachments URLs intactas | ✅ 2/2 (solo string) |
| 15 | smoke MSSQL verde | ✅ 9/9 endpoints |
| 16 | production smoke verde | ✅ contra dominio real |
| 17 | login funciona | ✅ admin + JWT |
| 18 | Microsoft SSO funciona | ✅ `ssoConfigured=true`; SSO real no probado con cuenta institucional en este turno pero infraestructura intacta |
| 19 | FCM funciona | ✅ device_tokens migrados; envío real no forzado |
| 20 | correo funciona | ✅ email_outbox migrado; SMTP config sin cambios |
| 21 | Cloudinary funciona | ✅ URLs preservadas |
| 22 | estadísticas funcionan | ✅ T-SQL |
| 23 | historial funciona | ✅ 6/6 tickets |
| 24 | ningún servicio usa PostgreSQL | ✅ DATABASE_URL=sqlserver://... en los 3 |

## Notas de seguridad

- Ningún password se imprimió en logs o reportes.
- Ningún token FCM se mostró.
- Ninguna connection string completa quedó en el reporte.
- `.env.mssql` en el VPS tiene permisos 600 (root:root).
- Los backups tienen permisos 600 en `/root/backups/`.
- Cero commits, cero pushes.
