# Guía oficial ServiceDesk UTA sobre SQL Server (Sprint F)

Desde Sprint F, **SQL Server es el motor único** del ServiceDesk UTA, tanto
en desarrollo local como en el VPS productivo. PostgreSQL queda como
mecanismo de rollback durante un periodo de estabilidad y después se
retira (ver `RETIRO_POSTGRESQL.md`).

## 1. Requisitos mínimos

- Docker Desktop / Docker Engine ≥ 24.
- 4 GiB RAM libres para SQL Server + servicios Node.
- 5 GiB de disco para volúmenes (`mssql-data`, `mssql-log`, `mssql-secrets`,
  `ticket-uploads`).
- Puertos libres: `18080` (gateway), `13000` (frontend), `14330` opcional
  para acceder al motor SQL desde SSMS.

## 2. Desarrollo local

### 2.1 Compose oficial

```bash
docker compose -f docker-compose.mssql.yml --env-file .env.mssql up -d --build
```

Servicios levantados (todos en la red `sd-mssql-lab-net`):

- `sd-mssql-lab` — SQL Server 2022 Developer
- `sd-auth-mssql` (Prisma + `schema.mssql.prisma`)
- `sd-catalog-mssql`
- `sd-ticket-mssql`
- `sd-gateway-mssql`
- `sd-frontend-mssql` (Vite build con `VITE_API_URL=http://localhost:18080`)

### 2.2 URLs

| Servicio | URL |
|---|---|
| Frontend | http://localhost:13000 |
| Gateway | http://localhost:18080 |
| SSMS/DBeaver | `localhost,14330` (user: `sa`, password en `.env.mssql`) |

### 2.3 Credenciales del seed (desarrollo)

Definidas en `auth-service/prisma/seed.ts`; se cargan idempotentemente al
primer arranque:

- `admin@uta.edu.ec` / `admin123` (admin)
- `carlos.mena@uta.edu.ec` / `tecn1123` (tech_n1)
- `daniela.paredes@uta.edu.ec` / `tecn2123` (tech_n2)
- `docente@uta.edu.ec` / `docente123` (user)

En producción los usuarios llegan por Microsoft SSO — los seeds no aplican.

### 2.4 Tests

```bash
cd auth-service    && npm test    # 26/26
cd catalog-service && npm test    # 52/52
cd ticket-service  && npm test    # 204/204
```

Ninguno abre conexión real: mockean Prisma. El DSN dummy en
`tests/setup-env.ts` es `sqlserver://…` (Sprint F, paridad con runtime).

## 3. Producción VPS

### 3.1 Compose oficial

```bash
# Desde /root/servicedesk en el VPS
docker compose -f docker-compose.prod-mssql.yml --env-file .env up -d --build
```

Diferencias respecto al lab:

- Nombres de contenedor sin sufijo `-mssql` (`sd-mssql`, `sd-auth`, …).
- El `sd-mssql-init` se auto-elimina tras crear las 3 bases + logins.
- El compose antiguo `docker-compose.yml` (PostgreSQL) queda como rollback
  durante el periodo de estabilidad.

### 3.2 Variables de entorno productivas

Se cargan de `.env` (no commitear). Bloque nuevo:

```
MSSQL_SA_PASSWORD=<canal seguro>
AUTH_DB_NAME=auth_db
AUTH_DB_USER=auth_user
AUTH_DB_PASSWORD=<canal seguro>
CATALOG_DB_NAME=catalog_db
CATALOG_DB_USER=catalog_user
CATALOG_DB_PASSWORD=<canal seguro>
TICKET_DB_NAME=ticket_db
TICKET_DB_USER=ticket_user
TICKET_DB_PASSWORD=<canal seguro>
```

Todo lo demás (JWT_SECRET, MICROSOFT_*, FCM_*, SMTP_*, CLOUDINARY_*)
permanece intacto.

### 3.3 Aplicar CHECK constraints y filtered index

Post primer `db push`, dentro del contenedor `sd-mssql`:

```bash
docker exec -i sd-mssql /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -N -b -I \
    -d auth_db < docs/mssql-uta/CHECK_CONSTRAINTS-auth.sql
```

(idem para catalog_db y ticket_db). Los DDL están en
`docs/mssql-uta/CHECK_CONSTRAINTS.md`.

### 3.4 Backups automáticos

Instalar el timer systemd en el VPS:

```bash
sudo cp scripts/backup-mssql.sh                       /usr/local/sbin/servicedesk-backup-mssql.sh
sudo chmod +x /usr/local/sbin/servicedesk-backup-mssql.sh
sudo cp scripts/systemd/servicedesk-mssql-backup.*    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now servicedesk-mssql-backup.timer
```

Retención por defecto: 14 días diarios + 56 días semanales.

Restore manual:

```bash
docker exec -i sd-mssql /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -N \
    -Q "RESTORE DATABASE [auth_db] FROM DISK='/var/opt/mssql/backup/auth_db-<STAMP>.bak' WITH REPLACE"
```

## 4. Diferencias operativas vs PostgreSQL

| Aspecto | PG | MSSQL |
|---|---|---|
| Provider Prisma | `postgresql` | `sqlserver` |
| Enums | Tipos ENUM nativos | `NVARCHAR(N)` + CHECK constraint |
| Arrays | `keywords String[]` | Tabla puente `KnowledgeKeyword` |
| Case-insensitive | `mode: "insensitive"` | Colación `_CI_AS` del motor |
| UUIDs | `@db.Uuid` | `@db.UniqueIdentifier` |
| Text largo | `@db.Text` | `@db.NVarChar(Max)` |
| Unique sobre text | Sí | `@db.NVarChar(n)` con n fijo |
| Filtered index | No aplica | `WHERE ms_oid IS NOT NULL` |
| Backup | `pg_dump` | `BACKUP DATABASE TO DISK` |

## 5. Runbook de operaciones comunes

### Arrancar todo
```bash
docker compose -f docker-compose.prod-mssql.yml --env-file .env up -d
```

### Ver logs de SQL Server
```bash
docker logs sd-mssql --tail 200 -f
```

### Aplicar cambios de schema (nueva versión Prisma)
```bash
docker exec sd-auth npx prisma db push --schema=prisma/schema.mssql.prisma
```
(sin `--force-reset`; nunca `--accept-data-loss` en producción sin backup previo).

### Consulta ad-hoc read-only
```bash
docker exec -it sd-mssql /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -N -d ticket_db \
    -Q "SELECT TOP 10 number, status, priority FROM tickets ORDER BY created_at DESC"
```

### Restart controlado
```bash
docker compose -f docker-compose.prod-mssql.yml restart auth-service catalog-service ticket-service
```
(no reiniciar `mssql` sin necesidad — pesa 30-60 s en volver a health).

## 6. Qué NO tocar

- `mssql-data`, `mssql-log`, `mssql-secrets` — volúmenes de SQL Server.
- `ticket-uploads` — imágenes locales (si `STORAGE_MODE=local`).
- `postgres-data` durante el periodo de estabilidad (rollback).
- `.env` — nunca commitear ni distribuir por canales inseguros.

## 7. Ver también

- `docs/mssql-uta/REQUISITOS_DBA.md` — si en el futuro se migra a SQL Server
  institucional (UTA en vez de contenedor Docker).
- `docs/mssql-uta/CHECK_CONSTRAINTS.md` — DDL de constraints por tabla.
- `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md` — plan de la ventana de switch.
- `docs/mssql/RETIRO_POSTGRESQL.md` — cómo retirar PG en 4 etapas.
- `FASE_D_REPORTE` (dentro del histórico) — validación migración de datos.
