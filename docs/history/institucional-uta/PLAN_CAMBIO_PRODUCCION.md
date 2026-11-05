# Plan de cambio a producción — PostgreSQL VPS → SQL Server UTA

Este plan describe la ventana de mantenimiento única para pasar el
ServiceDesk UTA desde `sd-postgres` en el VPS al SQL Server institucional de
la UTA. Se ejecuta **solo después** de la Fase E validada y con confirmación
del DBA.

**Duración estimada**: 90–150 minutos. Se recomienda ejecutar en horario
extra-académico (madrugada de sábado o domingo).

**Personas necesarias**: dev on-call del ServiceDesk, DBA UTA, admin del VPS.

**Rollback**: en cada fase se documenta cómo revertir. Hasta la fase 10 el
rollback es inmediato (PG productivo sigue vivo). A partir de la 10, revertir
implica volver a apuntar los servicios al PG viejo (< 5 min).

---

## Fase 1 — Backup PostgreSQL productivo

**Duración**: 5-10 min.
**Comandos** (desde el VPS):
```bash
mkdir -p /root/backups/pre-mssql-migration
cd /root/backups/pre-mssql-migration
docker exec sd-postgres pg_dump -U postgres -F c auth_db    > auth_db.dump
docker exec sd-postgres pg_dump -U postgres -F c catalog_db > catalog_db.dump
docker exec sd-postgres pg_dump -U postgres -F c ticket_db  > ticket_db.dump
sha256sum *.dump > sha256.txt
```

**Verificación**: los 3 dumps deben tener tamaño > 0 y sha256sum estable.
**Rollback**: no aplica — es un backup adicional al que ya hace el sistema.

## Fase 2 — Detención controlada del tráfico

**Duración**: 1-2 min.
**Objetivo**: dejar de aceptar mutaciones para que el dump refleje un estado
consistente. Los tickets en vuelo (aceptación, resolución) podrían perderse
si no.

**Opciones** (elegir una):
- A) Bajar el frontend: `docker compose stop frontend` — deja de servir la
  SPA pero los técnicos con la SPA cargada podrían seguir enviando requests.
- B) Poner Nginx en modo maintenance: devuelve 503 en `/api/*`. Recomendado.
- C) Bajar el gateway: `docker compose stop api-gateway`. Corte total.

**Recomendación**: **B** — se muestra una página de mantenimiento y ningún
request muta la BD.

**Rollback**: revertir la config de nginx y `nginx -s reload`.

## Fase 3 — pg_dump productivo (SIN escrituras)

**Duración**: 5-10 min (según tamaño; con 15 MB actual son segundos).
**Comandos**:
```bash
cd /root/backups/pre-mssql-migration
# Dump plano con INSERTs (portable a MSSQL).
docker exec sd-postgres pg_dump -U postgres --data-only --column-inserts \
    --no-owner --no-acl auth_db     > auth_db.data.sql
docker exec sd-postgres pg_dump -U postgres --data-only --column-inserts \
    --no-owner --no-acl catalog_db  > catalog_db.data.sql
docker exec sd-postgres pg_dump -U postgres --data-only --column-inserts \
    --no-owner --no-acl ticket_db   > ticket_db.data.sql
```

**Verificación**: revisar cabecera de cada `.data.sql` y confirmar que las
tablas del schema Prisma están presentes.

**Rollback**: no aplica.

## Fase 4 — Transferencia segura al equipo con acceso UTA

**Duración**: 2-5 min.
**Objetivo**: mover los dumps a la máquina que ejecutará la migración
(típicamente la del dev on-call, con conectividad al SQL Server UTA).

**Métodos aceptables** (por orden):
1. `scp` sobre SSH con clave (`scp -i ~/.ssh/vps root@vps:/root/backups/pre-mssql-migration/* ./`).
2. Copiar a un bucket privado cifrado.
3. Nunca: adjuntar por email o subir a un servicio público.

**Verificación**: comparar sha256sum tras la transferencia.

## Fase 5 — Preparación SQL Server UTA

**Precondiciones**:
- Bases `auth_db`, `catalog_db`, `ticket_db` creadas por el DBA con collation
  recomendada.
- Credenciales entregadas por canal seguro.
- Conectividad desde la máquina de trabajo validada con
  `node scripts/check-uta-mssql.js` sin errores.

**Pasos**:
```bash
# 1. .env.uta lleno con datos reales (nunca commitear).
# 2. Aplicar schema con Prisma db push contra las 3 bases:
docker run --rm -v $(pwd):/app -w /app --env-file .env.uta \
    -e DATABASE_URL="$UTA_AUTH_DATABASE_URL" \
    node:20 bash -c "cd auth-service && npx prisma db push --schema=prisma/schema.mssql.prisma"
# (repetir para catalog-service y ticket-service)
# 3. Aplicar el filtered index + CHECK constraints (docs/mssql-uta/CHECK_CONSTRAINTS.md).
```

**Verificación**:
```bash
node scripts/check-uta-mssql.js  # confirma las 15 tablas creadas.
```

**Rollback**: el DBA hace `DROP DATABASE` sobre las 3 bases y se recomienza.

## Fase 6 — Migración de datos

**Duración**: 10-30 min según volumen.

Usar el script `scratchpad/migration-ws/migrate.js` (validado en Fase D) con
las URLs reales:
```bash
# Ejemplo (variables desde .env.uta y .env productivo del VPS).
docker run --rm --network host \
    -v /path/to/migration-ws:/work -w /work \
    -e PG_AUTH_URL="postgresql://auth_user:<CONTRASEÑA>@<VPS_HOST>:5432/auth_db" \
    -e PG_CATALOG_URL="..." -e PG_TICKET_URL="..." \
    -e MSSQL_AUTH_URL="$UTA_AUTH_DATABASE_URL" \
    -e MSSQL_CATALOG_URL="$UTA_CATALOG_DATABASE_URL" \
    -e MSSQL_TICKET_URL="$UTA_TICKET_DATABASE_URL" \
    node:20 sh -c "npm ci --silent && node migrate.js"
```

**Verificación**: el propio script imprime `origen → destino` por tabla.

**Rollback**: el DBA hace `TRUNCATE` sobre las 3 bases (o `DELETE` respetando
FKs). Repetir Fase 5+6.

## Fase 7 — Comparación estructural

**Duración**: 5 min.
Ejecutar `scratchpad/compare-pg-vs-mssql.js` apuntando a los dos motores
para confirmar equivalencia:
- 8 secciones × N asserts como en Fase D.

**Verificación**: cero diferencias en conteos y en set-equivalence de IDs.

**Rollback**: si hay drift, volver a Fase 6.

## Fase 8 — Smoke test

**Duración**: 3-5 min.
- Levantar temporalmente los 3 servicios Node contra UTA (con
  `docker compose -f docker-compose.mssql.yml` adaptado, o con un compose
  específico UTA).
- Ejecutar `scratchpad/smoke-mssql-http.js` apuntando al gateway.
- Debe pasar 60/60 asserts.

**Rollback**: si falla, apagar los servicios contra UTA. Como aún no se ha
tocado el DNS/nginx, los usuarios siguen sirviéndose desde el stack PG (que
sigue en el VPS, apenas detenido en Fase 2).

## Fase 9 — Invalidar sesiones

**Duración**: 30 segundos.
Ejecutar contra el SQL Server UTA:
```sql
UPDATE dbo.sessions
SET revoked_at = SYSUTCDATETIME()
WHERE revoked_at IS NULL;
```

**Motivo**: aunque los JWT siguen siendo válidos hasta expirar, forzar re-login
es defensa en profundidad. Después de la ventana los usuarios verán la
pantalla de login (~8 h de latencia real en el peor caso, aceptable).

**Rollback**: `UPDATE dbo.sessions SET revoked_at=NULL WHERE …` con la
condición inversa. Prácticamente no necesario.

## Fase 10 — Cambiar DATABASE_URL

**Duración**: 2 min.
En el VPS:
1. Actualizar el archivo de env productivo del compose para que los servicios
   apunten a `sqlserver://...UTA...` en vez de `postgresql://sd-postgres...`.
2. Cambiar la imagen que se levanta si aún estaba con el Dockerfile PG:
   `docker compose -f docker-compose.uta.yml build`.

**Verificación**: `docker compose config` muestra las nuevas URLs (sin
password en el output — pasar `--services` solo).

**Rollback**: revertir el `.env` productivo al valor anterior.

## Fase 11 — Levantar servicios

**Duración**: 3-5 min.
```bash
docker compose -f docker-compose.uta.yml up -d
```

**Verificación**: `docker ps` muestra los 5 servicios `healthy` conectados a
UTA. `curl https://servicedesk-uta.site/api/auth/config` responde 200.

**Rollback**: `docker compose -f docker-compose.yml up -d` (vuelve al stack
PG que sigue disponible con datos consistentes hasta antes de Fase 2).

## Fase 12 — Validación funcional

**Duración**: 10-15 min.
Manual + smoke:
1. Login como admin (cuenta institucional confirmada).
2. Crear un ticket ficticio de laboratorio, aceptarlo, resolverlo.
3. Chequear que las estadísticas admin muestran valores razonables.
4. Verificar que un técnico ve la bandeja completa.
5. Correr `smoke-mssql-http.js` una vez más contra el gateway público.

**Verificación**: 60/60 asserts + revisión manual sin errores.

**Rollback**: si algo crítico se rompe, revertir a Fase 11 con el compose PG.

## Fase 13 — Rollback (contingencia)

Si en cualquier punto entre Fase 5 y Fase 12 se detecta un problema grave:

1. Levantar el stack PG productivo original:
   ```bash
   docker compose -f docker-compose.yml up -d
   ```
2. Restaurar el modo maintenance de nginx (Fase 2) si aún estaba activo.
3. Reactivar tráfico normal (`nginx -s reload`).
4. Documentar el problema y agendar nueva ventana.

El PG productivo debe permanecer intacto durante 14 días después de una
migración exitosa (retención de rollback). Solo después se puede detener el
contenedor `sd-postgres` y liberar el volumen.

---

## Checklist final antes de dar la migración por cerrada

- [ ] `smoke-mssql-http.js` verde (60/60).
- [ ] `compare-pg-vs-mssql.js` verde.
- [ ] `docker ps` muestra 5 servicios `healthy` contra UTA.
- [ ] `curl https://servicedesk-uta.site` responde 200.
- [ ] Login manual OK con al menos una cuenta admin y una cuenta técnico.
- [ ] Backups automáticos configurados contra UTA (`sqlcmd BACKUP DATABASE`) o
      confirmación del DBA de que el respaldo institucional cubre las 3 bases.
- [ ] Alerta a los técnicos (por chat institucional) de que deben re-loguearse.
- [ ] PG productivo pausado pero preservado 14 días.
- [ ] Firebase, Cloudinary, SMTP, Azure siguen intactos (no fueron tocados
      durante la migración).
