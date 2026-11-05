# Arquitectura final ServiceDesk UTA — post Fase N

**Fecha:** 2026-09-15
**Motor único:** SQL Server 2022 (`mcr.microsoft.com/mssql/server:2022-latest`)
**PostgreSQL:** retirado del runtime — ver [POSTGRESQL_RETIRADO.md](../../../archive/postgresql/docs/POSTGRESQL_RETIRADO.md).

Escrito para: cualquier persona que necesite levantar, mantener o
auditar ServiceDesk UTA sin contexto previo.

## Diagrama

```
                    ┌──────────────────────┐
                    │  Frontend :3000      │  React + Vite + Tailwind
                    │  (nginx en el runner)│
                    └──────────┬───────────┘
                               │ HTTP + JWT
                               ▼
                    ┌──────────────────────┐
                    │  API Gateway :8080   │  http-proxy-middleware
                    │  Único punto público │
                    └──┬──────┬──────┬─────┘
                       │      │      │
       ┌───────────────┘      │      └────────────────┐
       ▼                      ▼                       ▼
 ┌──────────┐          ┌──────────┐            ┌──────────┐
 │  auth    │          │ catalog  │            │  ticket  │
 │  :3001   │          │  :3002   │            │  :3003   │
 └────┬─────┘          └────┬─────┘            └────┬─────┘
      │                     │                       │
      └─────────────────────┼───────────────────────┘
                            ▼
                  ┌──────────────────────┐
                  │  SQL Server 2022     │
                  │      :1433 (mssql)   │
                  │   auth_db            │  ← 3 bases aisladas
                  │   catalog_db         │    sin FK cruzadas
                  │   ticket_db          │    integridad por app
                  └──────────────────────┘
```

## Motor y bases

| DB | Owner de tablas | Prisma provider | Colación |
|---|---|---|---|
| `auth_db` | `auth_user` | `sqlserver` | `SQL_Latin1_General_CP1_CI_AS` |
| `catalog_db` | `catalog_user` | `sqlserver` | idem |
| `ticket_db` | `ticket_user` | `sqlserver` | idem |

Cada microservicio se conecta **solo** a su base (principio de
privilegio mínimo). El usuario `sa` de MSSQL se usa solo durante el
bootstrap para crear las 3 bases; los servicios de aplicación nunca
lo usan.

Formato de `DATABASE_URL` (Prisma):

```
sqlserver://mssql:1433;database=<db>;user=<user>;password=<pw>;encrypt=true;trustServerCertificate=true
```

## Composes activos

| Archivo | Propósito |
|---|---|
| `docker-compose.mssql.yml` | Desarrollo local. Levanta `sd-mssql-lab` + 5 servicios. |
| `docker-compose.prod-mssql.yml` | Producción (VPS `<IP_VPS>`). Levanta `sd-mssql` + 5 servicios. |
| `docker-compose.legacy-pg.yml` | ⛔ Legacy PostgreSQL, no ejecutar. Se conserva únicamente para reconstruir un contenedor `postgres:16-alpine` capaz de restaurar los `.custom.dump` históricos si alguna vez hiciera falta. |

## Dockerfiles

- `auth-service/Dockerfile.mssql`, `catalog-service/Dockerfile.mssql`,
  `ticket-service/Dockerfile.mssql` — usados por los composes activos.
- Los `Dockerfile` sin sufijo son la variante PG legacy y solo tienen
  sentido con `docker-compose.legacy-pg.yml`.
- `api-gateway/Dockerfile`, `frontend/Dockerfile` — DB-agnósticos, sin
  cambios.

## Volúmenes Docker (productivo)

| Volumen | Contenido |
|---|---|
| `servicedesk-uta_mssql-data` | `/var/opt/mssql` — datos de SQL Server. |
| `servicedesk-uta_ticket-uploads` | Adjuntos de tickets (Fase L/M). |

**No** existe `servicedesk-uta_postgres-data` — retirado en Fase N.

## Backups activos

- **MSSQL diario/semanal:** `scripts/backup-mssql.sh` — respalda con
  `BACKUP DATABASE … WITH COMPRESSION, INIT` en
  `/var/backups/servicedesk-mssql/{daily,weekly}/`. Cada `.bak` verifica
  con `RESTORE VERIFYONLY`.
- **PG histórico congelado:**
  `/root/backups/postgresql-final-retired/20260915T203658Z/` en el VPS
  (`.custom.dump` + `.sql` + `SHA256SUMS.txt`, `chmod 600 root:root`).
  Ver [POSTGRESQL_RETIRADO.md](../../../archive/postgresql/docs/POSTGRESQL_RETIRADO.md) para el
  procedimiento de restauración de emergencia.

## Puertos expuestos al host

- **Local (dev):** `3000` (frontend), `8080` (gateway) — el resto es
  interno a la red Docker.
- **VPS:** `443/80` (nginx del host) → `3000/8080` (contenedores).
  `mssql:1433` y los 3 servicios (`:3001/:3002/:3003`) son estrictamente
  internos.

## Cambios respecto a la arquitectura previa

- SQL Server 2022 sustituyó a PostgreSQL 16 en Fase F (schema) y Fase G
  (VPS cutover).
- Los adjuntos de ticket se sirven por endpoint autenticado
  `GET /api/tickets/:id/attachments/:aid` desde Fase L/M — la ruta
  antigua `/uploads/*` ya no está expuesta al frontend.
- En Fase N (esta) se retiró definitivamente el contenedor
  `sd-postgres`, el volumen `postgres-data` y las 4 variables
  `POSTGRES_*` del `.env.mssql` productivo. Los composes activos no
  tienen ninguna referencia runtime a PostgreSQL.
