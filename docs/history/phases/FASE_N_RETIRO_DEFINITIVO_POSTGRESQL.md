# FASE N — Retiro definitivo de PostgreSQL

**Fecha:** 2026-09-15
**Alcance:** local (Windows/Docker Desktop) + VPS `<IP_VPS>`
**Autorización:** explícita del operador tras dictamen de prechecks
(respuesta *"Sí — VPS y local, todo"*).
**Motor de aplicación:** SQL Server 2022 (único runtime).

Escrito para: el equipo del proyecto (Tech Lead + docente supervisor).

**Este documento no contiene** contraseñas, tokens, JWT, credenciales
FCM, credenciales SMTP, credenciales Cloudinary, connection strings ni
secretos de servicio.

---

## 1. Estado inicial

VPS (`vmi3560421`, `/opt/servicedesk-uta`):

```
sd-ticket     healthy
sd-frontend   unhealthy (bandera preexistente del HEALTHCHECK; sirve 200)
sd-gateway    healthy
sd-catalog    healthy
sd-auth       healthy
sd-mssql      healthy
sd-postgres   healthy (rollback, sin uso de aplicación desde Fase G)
```

Local (Docker Desktop): `sd-postgres` (postgres:16-alpine) también
corriendo desde el compose legacy, con 11 usuarios / 13 servicios /
33 artículos KB / 99 tickets sintéticos / 0 adjuntos.

## 2. Auditoría del repositorio

Documentada en detalle en
[docs/mssql/POSTGRESQL_AUDITORIA_FINAL.md](../../../archive/postgresql/docs/POSTGRESQL_AUDITORIA_FINAL.md).

Resumen:

- Runtime PG en composes activos: **0**. Los dos composes activos
  (`docker-compose.mssql.yml`, `docker-compose.prod-mssql.yml`) no
  incluyen ningún servicio PG.
- Referencias PG restantes en el repo: 7 archivos (`docker-compose.yml`
  legacy, `.env.example`, `README.md`, `scripts/init-multi-db.sh`, las
  3 `schema.prisma` con `provider="postgresql"`).
- `ticket-service/src/routes/adminRoutes.ts` menciona PG **solo en
  comentarios** que explican la equivalencia T-SQL / PG SQL. El código
  real es T-SQL.
- `ticket-service/scripts/seedHistoricalTickets.js` ya estaba
  documentado como legacy en su propio `LEGACY_README.md`.

## 3. Backups finales (parte I y K)

### PostgreSQL — histórico permanente

**VPS**: `/root/backups/postgresql-final-retired/20260915T203658Z/`

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `auth_db.custom.dump` | 18139 | `b08181f42b2d4dcc8008a212d85dce0c85e72b4361397abb22033ca9eae7f8b1` |
| `catalog_db.custom.dump` | 16545 | `bb3aad80a2c691d939494003ef5aabfde25d684cf667b673452404756ef9de7c` |
| `ticket_db.custom.dump` | 22664 | `ff4105b84e9734e308d952da3a4696dfc3958c72892efec548ae6a3aa01eb413` |
| `auth_db.sql` | 45269 | `c6ff3056924571e3ab453edf8923e3e58c25a0593c1875bc71ffec6170b95b25` |
| `catalog_db.sql` | 24838 | `578360cbe49708d97b10a362fc1921577ddefaa2ca84aaf5328381de88e24188` |
| `ticket_db.sql` | 56112 | `4cd7637f3baedc57e426f254062aa572b16b899c7b95ba3d99edd756c26d9f33` |

Permisos: `chmod 600 root:root`. `pg_restore -l` confirma TOC 26/29/47
entradas.

**Local**: `backups/postgresql-final-retired-local-20260915T204733Z/`
en el directorio del proyecto (dentro de `backups/`, ignorado por
`.gitignore`). 3 `.custom.dump` (50318 / 17841 / 46813 bytes) + 3 `.sql`.
TOC 26/29/40 entradas.

### MSSQL — respaldo pre-destrucción

- Diarios generados por `scripts/backup-mssql.sh` en
  `/var/backups/servicedesk-mssql/daily/`.
- Copia canónica en `/root/backups/mssql/20260915T203753Z/`:
  - `auth_db-20260915T203753Z.bak` (602 112 B, `d6a50de2…`)
  - `catalog_db-20260915T203753Z.bak` (602 112 B, `a8037c3d…`)
  - `ticket_db-20260915T203753Z.bak` (618 496 B, `14cf05d3…`)
- `RESTORE VERIFYONLY` sobre los 3: "The backup set on file 1 is valid".

## 4. Pruebas MSSQL previas al borrado

### 4.1 Verificación de cero dependencia (parte J)

Los 3 microservicios en producción usan `DATABASE_URL` con `scheme =
sqlserver` y host `mssql:1433`. Sin conexiones a puerto 5432 en
`sd-auth`, `sd-catalog`, `sd-ticket`. `sd-postgres` sin conexiones
establecidas visibles.

### 4.2 Restore drill (parte L)

Restauración de los 3 `.bak` diarios sobre bases nuevas `*_verify`,
distintas de producción. Filas verificadas post-restore:

| DB verify | Tabla | Filas restauradas | Filas producción |
|---|---|---:|---:|
| `auth_db_verify` | `users` | 16 | 16 |
| `catalog_db_verify` | `services` | 8 | 8 |
| `catalog_db_verify` | `locations` | 23 | (n/a) |
| `catalog_db_verify` | `knowledge_articles` | 28 | 28 |
| `ticket_db_verify` | `tickets` | 13 | 13 |
| `ticket_db_verify` | `ticket_events` | 37 | (n/a) |
| `ticket_db_verify` | `attachments` | 7 | 7 |
| `ticket_db_verify` | `email_outbox` | 22 | (n/a) |

Las 3 bases `_verify` se DROPearon al terminar. Sin residuos.

### 4.3 Smoke producción (parte M)

`https://servicedesk-uta.site`

| Endpoint | HTTP | Content-Type | Bytes |
|---|---:|---|---:|
| `/` (SPA) | 200 | `text/html` | 807 |
| `/mis-aceptados` (SPA fallback) | 200 | `text/html` | 807 |
| `/api/catalog/services` | 200 | `application/json` | 4116 |
| `/api/tickets/my` (con JWT dueño) | 200 | `application/json` | 7158 |
| `/api/tickets/history/<TID>` (con JWT dueño) | 200 | `application/json` | 1748 |
| `/api/tickets/<TID>/attachments/<AID>` (con JWT dueño) | 200 | `image/jpeg` | 20490 |

Endpoints protegidos sin token: 401 correcto. Frontend cache con hash
Vite `index-B6aM42JF.js`.

## 5. Eliminación local (parte G)

```
docker stop sd-postgres                                 # → sd-postgres
docker rm   sd-postgres                                 # → sd-postgres
docker volume rm servicedesk-microservices_postgres-data
```

Post-estado local:

- `docker ps` — 0 postgres, 6 servicios MSSQL sanos.
- `docker volume ls | grep servicedesk-microservices_postgres` — sin
  resultado.
- Otros volúmenes PG de proyectos ajenos (`asistencia_*`,
  `proyectosmetodologiascrum_*`, `trasnporte_*`) intactos.

## 6. Eliminación VPS (partes N y O)

```
docker stop sd-postgres                                 # → sd-postgres
docker rm   sd-postgres                                 # → sd-postgres
docker volume rm servicedesk-uta_postgres-data          # → volumen borrado
```

Backup previo del `.env.mssql`:
`/opt/servicedesk-uta/.env.mssql.pre-fase-N-20260915T205210Z` (`chmod 600`).

Depuración de `.env.mssql` (parte P):

```
sed -i '/^POSTGRES_/d' /opt/servicedesk-uta/.env.mssql
```

Elimina las 4 líneas `POSTGRES_HOST`, `POSTGRES_PORT`,
`POSTGRES_SUPERUSER`, `POSTGRES_SUPERUSER_PASSWORD`. Todas eran
variables muertas: el compose productivo no las lee.

## 7. Cambios en el docker-compose

- `docker-compose.yml` → renombrado a `docker-compose.legacy-pg.yml`,
  con banner *"⛔ LEGACY — NO EJECUTAR"* en la cabecera.
- `docker-compose.mssql.yml`, `docker-compose.prod-mssql.yml`: sin
  cambios (ya eran MSSQL-only). Verificación:
  `docker compose --env-file .env.mssql -f docker-compose.prod-mssql.yml
  config | grep -iE "postgres|5432"` → 0 líneas.

## 8. Validación post-eliminación (partes Q, R, S)

`docker ps` VPS:

```
NAMES        STATUS
sd-ticket    healthy
sd-frontend  unhealthy (HEALTHCHECK preexistente — sirve 200)
sd-gateway   healthy
sd-catalog   healthy
sd-auth      healthy
sd-mssql     healthy
```

`docker volume ls` VPS: `servicedesk-uta_mssql-data`,
`servicedesk-uta_ticket-uploads`. Sin `postgres-data`.

Los servicios NO fueron reiniciados durante la fase (se validó que
siguen sanos tras el retiro del `sd-postgres`). Un `docker compose
restart` completo se reserva para una ventana de mantenimiento
programada; la evidencia actual demuestra que los servicios no
dependen de PG para operar.

## 9. Pruebas de persistencia (parte S) — post-retiro

Contadores en la producción MSSQL (idénticos a pre-retiro):

| DB | Tabla | Filas |
|---|---|---:|
| auth_db | `users` | 16 |
| catalog_db | `services` | 8 |
| catalog_db | `knowledge_articles` | 28 |
| ticket_db | `tickets` | 13 |
| ticket_db | `ticket_events` | 37 |
| ticket_db | `attachments` | 7 |

`docker volume ls | grep ticket-uploads` → intacto, 7 archivos
adjuntos físicos en el volumen.

## 10. Auditoría final (parte T)

Referencias PG restantes en el repositorio tras Fase N:

- `docker-compose.legacy-pg.yml` — banner LEGACY, no ejecutable en el
  flujo actual.
- `scripts/legacy/init-multi-db.sh` — banner LEGACY.
- `{auth,catalog,ticket}-service/prisma/schema.pg.legacy.prisma` —
  provider PG guardado como legacy; no lo lee ni `prisma generate`
  (el nombre no es el default) ni ningún Dockerfile activo.
- `{auth,catalog,ticket}-service/Dockerfile` (sin sufijo) — variante
  PG legacy; los composes activos referencian `Dockerfile.mssql`.
- `ticket-service/scripts/seedHistoricalTickets.js` — ya marcado como
  legacy en `LEGACY_README.md`.
- `ticket-service/src/routes/adminRoutes.ts:290–296` — comentarios PG
  → T-SQL. El código real es T-SQL.
- Reportes de fases previas `FASE_E`..`FASE_M`,
  `docs/mssql/RETIRO_POSTGRESQL.md`,
  `docs/mssql/GUIA_OFICIAL_MSSQL.md`,
  `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md`,
  `ticket-service/scripts/LEGACY_README.md` — todos histórico, sin
  editar.

**Runtime PG activo (local + VPS + compose oficial + `DATABASE_URL` +
tests oficiales): 0.**

## 11. Documentación creada

- [docs/mssql/POSTGRESQL_AUDITORIA_FINAL.md](../../../archive/postgresql/docs/POSTGRESQL_AUDITORIA_FINAL.md)
- [docs/mssql/ARQUITECTURA_FINAL.md](../mssql-migration/ARQUITECTURA_FINAL.md)
- [docs/mssql/POSTGRESQL_RETIRADO.md](../../../archive/postgresql/docs/POSTGRESQL_RETIRADO.md)
- Este reporte.

## 12. Archivos modificados

- `docker-compose.yml` → renombrado a `docker-compose.legacy-pg.yml`,
  banner LEGACY.
- `scripts/init-multi-db.sh` → movido a `scripts/legacy/init-multi-db.sh`,
  banner LEGACY.
- `.env.example` — bloque PG reemplazado por bloque MSSQL.
- `README.md` — 4 lugares actualizados a "SQL Server 2022 :1433" y
  nota de retiro con enlace a `POSTGRESQL_RETIRADO.md`.
- `{auth,catalog,ticket}-service/prisma/schema.prisma` — contenido del
  `schema.mssql.prisma` (provider `sqlserver`). El PG original se
  guardó como `schema.pg.legacy.prisma`.

En el VPS, adicional:

- `/opt/servicedesk-uta/.env.mssql` — 4 líneas `POSTGRES_*` removidas.
  Backup: `.env.mssql.pre-fase-N-20260915T205210Z`.

## 13. Archivos eliminados

**Local**:

- Contenedor `sd-postgres` (postgres:16-alpine).
- Volumen `servicedesk-microservices_postgres-data`.

**VPS**:

- Contenedor `sd-postgres` (postgres:16-alpine).
- Volumen `servicedesk-uta_postgres-data`.
- 4 líneas `POSTGRES_*` de `.env.mssql`.

**Nada más se eliminó.** Backups PG (custom + SQL + checksums),
documentación previa y schemas `.pg.legacy.prisma` se conservan.

## 14. Archivos conservados como legacy

- `docker-compose.legacy-pg.yml`
- `scripts/legacy/init-multi-db.sh`
- `{auth,catalog,ticket}-service/prisma/schema.pg.legacy.prisma`
- `{auth,catalog,ticket}-service/Dockerfile` (variantes PG sin sufijo)
- `ticket-service/scripts/seedHistoricalTickets.js` (+
  `LEGACY_README.md`)
- Reportes históricos de fases E–M.

## 15. Estado final

- **Local**: SQL Server ONLY. PostgreSQL retirado.
- **VPS**: SQL Server ONLY. PostgreSQL retirado.
- **Backups PG:** conservados como archivo histórico permanente
  (VPS y local, con SHA-256 y `.gitignore`).
- **Tests locales:** 293/293 verdes (auth 26 + catalog 52 + ticket 215)
  — sin regresiones respecto a Fase L/M.
- **Producción:** `https://servicedesk-uta.site` responde 200 en los
  endpoints críticos, imágenes cargan por endpoint autenticado, el
  frontend sirve el bundle nuevo `index-B6aM42JF.js`.

## 16. Aviso de seguridad

Durante la parte J de prechecks, un `sed` orientado a URL Postgres no
matcheó el DSN SQL Server (que usa formato `sqlserver://host;user=X;
password=Y` sin `@`), y el tool output de esa sesión mostró las 3
contraseñas de `auth_user`, `catalog_user`, `ticket_user` en claro. Se
recomienda rotarlas en `.env.mssql` del VPS + `docker compose up -d`
sobre los 3 microservicios. En este documento no se repiten. La
contraseña del usuario `sa` de MSSQL no fue afectada y no aparece.

## 17. Pendientes no bloqueantes

- `HEALTHCHECK` de `sd-frontend`: sigue reportando `unhealthy` pese a
  servir HTTP 200. Preexistente a Fase N. Se corregirá en una fase
  futura de higiene de Dockerfiles.
- Rotación de las 3 contraseñas de usuario de aplicación (§16).
- `location /uploads/` de nginx en el VPS: código muerto tras Fase L.
  Sin urgencia.
- Paquete `cloudinary` sin instalar en `sd-ticket`: `STORAGE_MODE=
  cloudinary` cae a `local` — comportamiento intencional actualmente,
  ver Fase M.

---

**REGLA DE TERMINACIÓN cumplida.** El proyecto puede desarrollarse,
correr sus tests, levantar Docker (dev y prod), ejecutar producción y
tomar backups sin necesitar PostgreSQL. La única vía para consultar
datos previos al cutover es restaurar los `.custom.dump` conservados,
descrito en [docs/mssql/POSTGRESQL_RETIRADO.md](../../../archive/postgresql/docs/POSTGRESQL_RETIRADO.md).

NO se hizo git commit. NO se hizo git push.
