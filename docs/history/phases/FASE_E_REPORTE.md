# Fase E — Reporte

## 1. Estado inicial

Repositorio con Fases B (schemas MSSQL), C (stack completo MSSQL) y D
(migración PG → MSSQL en laboratorio) ya cerradas. La aplicación funciona
sobre PostgreSQL en producción (`sd-postgres`) y sobre SQL Server 2022 en
laboratorio (`sd-mssql-lab`). Datos productivos intactos, VPS intacto, SQL
Server institucional aún no contactado.

## 2. Archivos revisados (READ-ONLY)

- `docker-compose.yml` — stack PG productivo.
- `docker-compose.mssql.yml` — stack lab MSSQL (Fases B+C).
- `.env`, `.env.example`, `.env.mssql`, `.env.mssql.example` — sólo se
  inventarió el conjunto de variables (nunca se imprimieron valores).
- `auth-service/prisma/schema.prisma` (PG) y `schema.mssql.prisma` (SQL Server).
- `catalog-service/prisma/schema.prisma` y `schema.mssql.prisma`.
- `ticket-service/prisma/schema.prisma` y `schema.mssql.prisma`.
- `auth|catalog|ticket-service/Dockerfile`, `Dockerfile.mssql`, `docker/entrypoint.mssql.sh`.
- `auth|catalog|ticket-service/src/domain/enums.ts`.
- `scripts/init-mssql-lab.sql`, `scripts/init-mssql-lab.sh`.
- Scripts de Fase B/C/D en el scratchpad
  (`migrate-pg-to-mssql.js`, `migration-ws/migrate.js`,
  `smoke-mssql-http.js`, `compare-pg-vs-mssql.js`, `e2e-mssql-lab.js`).

## 3. Cambios realizados

**Ninguno** sobre archivos de producción o de fases anteriores. Solo se
crearon archivos nuevos (Sección 4). Ni un `sed`, ni un `Edit` sobre PG,
schema PG, docker-compose productivo o `.env` productivo.

## 4. Archivos nuevos (creados en Fase E)

- `.env.uta.example` — plantilla del perfil de conexión al SQL Server UTA
  con placeholders vacíos (nunca contiene credenciales reales).
- `docs/mssql-uta/REQUISITOS_DBA.md` — checklist único para la reunión con
  el DBA institucional: datos que se necesitan, permisos, colación, red,
  backups, contactos.
- `docs/mssql-uta/CHECK_CONSTRAINTS.md` — DDL de todos los `CHECK`
  constraints por columna-enum + `filtered unique index` sobre `users.ms_oid`.
- `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md` — plan de 13 fases para la
  ventana de mantenimiento única VPS → UTA (backup, dump, migración,
  smoke, invalidar sesiones, switch DATABASE_URL, rollback).
- `scripts/check-uta-mssql.js` — script Node **100 % READ-ONLY** de
  validación de conectividad al SQL Server UTA (o al lab en dry-run).
  Incluye guardarraíl regex que aborta si algún `INSERT|UPDATE|DELETE|
  TRUNCATE|DROP|CREATE|ALTER|EXEC|MERGE|GRANT|REVOKE|DENY` aparece en el
  SQL. Solo lee `sys.databases`, `INFORMATION_SCHEMA.TABLES`,
  `fn_my_permissions`, `SERVERPROPERTY`, y `COUNT_BIG(*)` sobre tablas.
- `FASE_E_REPORTE.md` — este documento.

## 5. Variables necesarias

Definidas en `.env.uta.example`. El DBA UTA debe proveer los valores para:

| Variable | Uso |
|---|---|
| `UTA_MSSQL_HOST` | Servidor SQL |
| `UTA_MSSQL_PORT` | TCP (default 1433) |
| `UTA_MSSQL_USER` / `UTA_MSSQL_PASSWORD` | Cuenta única (forma A), o |
| `UTA_AUTH_USER/PASSWORD`, `UTA_CATALOG_USER/PASSWORD`, `UTA_TICKET_USER/PASSWORD` | Cuentas por base (forma B) |
| `UTA_MSSQL_ENCRYPT` | `true` obligatorio |
| `UTA_MSSQL_TRUST_SERVER_CERTIFICATE` | según cert del server |
| `UTA_AUTH_DB` / `UTA_CATALOG_DB` / `UTA_TICKET_DB` | nombres reales de las 3 bases |
| `UTA_MSSQL_SCHEMA` | default `dbo` |
| `UTA_MSSQL_APP_NAME` | aparece en `sys.dm_exec_sessions` |
| `UTA_MSSQL_CONNECT_TIMEOUT` | timeout de login (default 15 s) |

## 6. Estado de conexión UTA

**No probada aún** — no hay datos del DBA. Sin embargo, el script
`scripts/check-uta-mssql.js` está listo. Cuando el DBA entregue las
credenciales, la comprobación se ejecuta con:
```bash
# Copiar .env.uta.example a .env.uta y rellenar sin commitear.
node scripts/check-uta-mssql.js
```
El script imprime host:port, versión SQL Server, colación, permisos,
presencia de las 3 bases y conteo de sus tablas — todo sin escribir un byte.

En modo `--target=lab` se puede validar el propio script contra
`sd-mssql-lab` (dry-run) antes de apuntarlo a la UTA.

## 7. Estado de las 3 bases

- **Laboratorio** (`sd-mssql-lab`): 3 bases funcionales con datos migrados
  de Fase D, 15 tablas, filtered index aplicado.
- **UTA**: sin verificar. El plan asume que **el DBA las creará** en Fase F
  con colación `SQL_Latin1_General_CP1_CI_AS` (documentado en
  `REQUISITOS_DBA.md`).

## 8. Collation

- Recomendada: `SQL_Latin1_General_CP1_CI_AS`.
- Motivo: el código de la app asume case-insensitive; se documentó tras
  eliminar `mode: "insensitive"` en Prisma en Fase B.
- El script `check-uta-mssql.js` compara la colación real del servidor y las
  bases con la recomendada, emite advertencia si difieren. **Nunca ejecuta
  `ALTER DATABASE`.**

## 9. Permisos

Documentados en `REQUISITOS_DBA.md`:

- **Durante bootstrap** (una vez): `db_ddladmin` o `db_owner` para permitir
  `CREATE/ALTER TABLE` (Prisma db push).
- **Operación normal**: `db_datareader` + `db_datawriter`.
- Cero permisos server-level (no se usa `xp_cmdshell`, ni Linked Servers,
  ni SQL Agent).

El script `check-uta-mssql.js` invoca `sys.fn_my_permissions` a nivel server
y database, e imprime los permisos disponibles para que el equipo verifique
que el DBA entregó exactamente lo pedido.

## 10. Prisma

- Provider `sqlserver` — confirmado en los 3 `schema.mssql.prisma`.
- `prisma validate` pasa en los 3 schemas.
- `prisma generate` produce clientes correctos en los 3 servicios.
- `@db.UniqueIdentifier` presente para todos los UUIDs (auth: 6, catalog: 10,
  ticket: 18 columnas).
- `@db.NVarChar(Max)` para columnas text (auth: 1, catalog: 3, ticket: 9).
- `@db.NVarChar(<n>)` para columnas con longitud (auth: 4, catalog: 8,
  ticket: 24).
- `KnowledgeKeyword` presente en `catalog-service/prisma/schema.mssql.prisma`
  (1:N reemplazando `String[]`).
- `DeviceToken` presente en `ticket-service/prisma/schema.mssql.prisma` con
  `token @db.NVarChar(512) @unique`.
- `Session.token @db.NVarChar(2048) @unique` — compatible con JWT HS256.
- Filtered unique index sobre `users.ms_oid` documentado en
  `CHECK_CONSTRAINTS.md`; el entrypoint del auth-service lo aplica en cada
  boot (idempotente).

## 11. Seguridad

**Nada expuesto**:
- El diagnóstico de `.env*` sólo listó **nombres de variables** y su estado
  (`<present>` / `<empty>`). Ningún valor.
- `scripts/check-uta-mssql.js` no imprime la contraseña ni la connection
  string; sólo host, puerto, usuario, banderas de encrypt y trust.
- `docs/*.md` no contiene ningún secreto.
- `.env.uta.example` con placeholders vacíos.
- El script tiene un guardarraíl regex que rechaza cualquier SQL con
  DML/DDL antes de enviarlo al server.

Secretos que la app usa (todos siguen intactos y confidenciales):
- `JWT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `SMTP_PASS`, `CLOUDINARY_API_SECRET`,
  `FCM_PRIVATE_KEY`, passwords PostgreSQL, `MSSQL_SA_PASSWORD`. Ninguno se
  imprimió, se copió, se transmitió, ni se referenció con valor real en esta
  fase.

## 12. Tests

Ejecutados tras crear los archivos de Fase E, con el schema MSSQL activo en
los clientes Prisma generados:

| Servicio | Test Suites | Tests |
|---|---|---|
| auth-service | 2 passed | **26 / 26** ✅ |
| catalog-service | 3 passed | **52 / 52** ✅ |
| ticket-service | 13 passed | **204 / 204** ✅ |
| **Total** | **18 passed** | **282 / 282** ✅ |

`prisma validate` y `prisma generate` OK en los 3 servicios (schema
`schema.mssql.prisma`).

## 13. Riesgos

1. **CHECK constraints no aplicados aún**: si el DBA olvida ejecutar el DDL
   post-`db push`, los campos-enum quedarían sin validación server-side.
   Riesgo bajo porque la app siempre valida con Zod, pero conviene aplicarlo
   como red de seguridad institucional.
2. **Filtered index sobre `users.ms_oid`**: Prisma no lo genera. El
   entrypoint del auth-service lo crea automáticamente al boot en el lab,
   pero en producción UTA hay que asegurarse de que la primera vez que se
   levante el contenedor tenga permisos DDL (o aplicarlo a mano).
3. **Colación distinta**: si UTA usa `SQL_Latin1_General_CP1_CS_AS` (case
   sensitive), las búsquedas KB / tickets pierden case-insensitivity.
   Mitigación: pedir CI en la creación de las 3 bases (documentado).
4. **Cert autofirmado UTA**: si la UTA aún no publica su CA interna, habrá
   que `trustServerCertificate=true` — aceptable para conexión interna, pero
   documentar la excepción.
5. **Windows / Prisma / TLS**: el bug conocido en Prisma-SQLServer bajo
   Windows con `trustServerCertificate=true` obliga a correr Prisma dentro
   de un contenedor Linux (documentado en Fase B). El VPS ya usa Linux
   nativo, así que en producción no aplicará.
6. **Coexistencia PG + MSSQL durante el rollback window**: durante 14 días
   post-migración se preserva el PG viejo. Requiere disco extra en el VPS
   (~15 MB × 3 = trivial).

## 14. Requisitos pendientes del DBA

- [ ] Confirmar existencia (o instrucción para crear) las 3 bases
      `auth_db`, `catalog_db`, `ticket_db`.
- [ ] Colación `SQL_Latin1_General_CP1_CI_AS`.
- [ ] Cuenta(s) con `db_owner` (bootstrap) → `db_datareader`+`db_datawriter`
      (operación) sobre las 3 bases.
- [ ] Host, puerto, credenciales entregados por canal seguro.
- [ ] Confirmar conectividad de red desde el VPS
      (`<IP_VPS>` → `UTA_MSSQL_HOST:UTA_MSSQL_PORT`).
- [ ] Certificado TLS del servidor (o autorización para
      `TrustServerCertificate=true`).
- [ ] Política institucional de backups (o autorización para hacer backup
      adicional desde el ServiceDesk).
- [ ] Contacto de emergencia del DBA para la ventana de mantenimiento.

## 15. Qué falta para Fase F

Fase F = **ejecución de la migración real VPS → UTA**. Se puede lanzar
cuando:
1. El DBA UTA entrega los datos listados en Sección 14.
2. Se ejecuta `node scripts/check-uta-mssql.js` con `.env.uta` real y
   devuelve conexión exitosa a las 3 bases.
3. Se acuerda ventana de mantenimiento (~2 h).
4. El plan `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md` se ejecuta paso a
   paso con revisión punto por punto.

Todo el código necesario ya está en el repo: el `docker-compose.mssql.yml`
puede adaptarse trivialmente a un `docker-compose.uta.yml` cambiando
`sqlserver://mssql:1433;…` por `sqlserver://<UTA_HOST>:<PORT>;…`.

## 16. Confirmación explícita

**NO SE MIGRARON DATOS PRODUCTIVOS.**

- PostgreSQL VPS: intocado.
- SQL Server UTA: no se ha contactado siquiera (host aún desconocido).
- Azure, Firebase, Cloudinary, SMTP: intactos.
- `docker-compose.yml` productivo: intacto.
- `.env` productivo: intacto.
- Ninguna sesión invalidada, ningún ticket modificado, ningún usuario
  creado/borrado.
- Cero commits, cero pushes.
