# Retiro de PostgreSQL en 4 etapas (Sprint F)

Con SQL Server como motor único, PostgreSQL deja de tener un rol activo en
el runtime. Su retiro se hace **por etapas**, no en un solo golpe, para
mantener rollback disponible durante el periodo de estabilidad.

**Regla operativa**: PostgreSQL NO recibe nuevas escrituras desde el momento
en que se ejecuta la Etapa 1. Sólo lecturas para comparación y, en el peor
caso, retorno al servicio (rollback).

---

## Etapa 1 — PostgreSQL presente pero fuera del runtime

**Cuándo**: inmediatamente después de la ventana de switch VPS PG→MSSQL.

**Qué se hace**:
1. El compose productivo pasa a ser `docker-compose.prod-mssql.yml`.
2. El compose `docker-compose.yml` (PG) **no se ejecuta más**, pero el
   archivo se conserva en el repo.
3. El contenedor `sd-postgres` se detiene:
   ```bash
   docker compose -f docker-compose.yml stop postgres
   ```
   Sus datos permanecen intactos en el volumen `postgres-data`.
4. Los servicios Node ya no tienen `postgresql://...` en su entorno.

**Estado**: rollback disponible en < 5 min (`docker compose -f docker-compose.yml up -d`).

**Duración recomendada**: primer día del switch.

## Etapa 2 — SQL Server como único motor operativo

**Cuándo**: días 1-7 después del switch.

**Qué se hace**:
1. Monitoreo intensivo del stack MSSQL (CPU/RAM/disk/latencias/logs).
2. Backups diarios MSSQL corriendo por systemd timer (ver
   `GUIA_OFICIAL_MSSQL.md` §3.4).
3. Al menos un `RESTORE VERIFYONLY` diario automático.
4. Comparación semanal manual: `docker exec sd-postgres psql -c "SELECT
   COUNT(*)..."` vs `docker exec sd-mssql sqlcmd -Q "SELECT COUNT(*)..."`.
   Debe seguir siendo *snapshot inmóvil* del lado PG (sin escrituras nuevas).
5. Cualquier defecto detectable en producción se documenta como incidencia,
   no se hace rollback si es cosmético.

**Trigger de rollback**: sólo si un defecto crítico (login roto, pérdida
de datos, historial inconsistente) no se resuelve en < 30 min. En ese
caso:
```bash
docker compose -f docker-compose.prod-mssql.yml stop auth-service catalog-service ticket-service api-gateway
docker compose -f docker-compose.yml up -d
```

**Duración recomendada**: 7 días completos sin incidencias críticas.

## Etapa 3 — PostgreSQL apagado, listo para retirar

**Cuándo**: día 8 en adelante, si Etapa 2 no gatilló rollback.

**Qué se hace**:
1. Ya no hay razón operativa para conservar `sd-postgres` corriendo.
2. Comprobar que ningún servicio activo lo consume:
   ```bash
   docker exec sd-auth env | grep DATABASE_URL     # → sqlserver://…
   docker exec sd-catalog env | grep DATABASE_URL  # → sqlserver://…
   docker exec sd-ticket env | grep DATABASE_URL   # → sqlserver://…
   ```
3. Anotar la fecha oficial de retiro en el reporte
   `FASE_F_MIGRACION_DEFINITIVA_MSSQL.md` §14.
4. Deshabilitar el compose PG del arranque:
   ```bash
   # Renombrar preserva el archivo en el repo pero lo saca del path habitual.
   mv docker-compose.yml docker-compose.pg-legacy.yml
   ```
   (o mantener el nombre y confiar en que nadie lo levante — cuestión de
   política del equipo).
5. Emitir un `pg_dump` FINAL (archivo `.dump` con checksum SHA-256)
   guardado en `/var/backups/servicedesk-legacy-pg/YYYY-MM-DD-final/`.
   Retención mínima: **1 año**.

**Estado**: PG queda “dormido”. El volumen `postgres-data` sigue existiendo
pero el contenedor no se levanta.

## Etapa 4 — Retiro definitivo

**Cuándo**: sólo después de:
- ≥ 30 días naturales desde Etapa 3.
- 0 incidencias que hayan requerido rollback.
- Backups MSSQL restaurados exitosamente al menos 2 veces (drill de DR).
- Confirmación por escrito del owner del proyecto (Tomás Solís).

**Qué se hace**:
1. `docker volume rm postgres-data` — sólo tras confirmar que el
   `pg_dump` FINAL de Etapa 3 se conserva **fuera** del VPS (copia offline
   y/o storage externo).
2. Eliminar del repo:
   - `docker-compose.pg-legacy.yml` (o `docker-compose.yml`, según se haya
     renombrado en Etapa 3).
   - `scripts/init-multi-db.sh`.
   - `scripts/migrate-areas-catalog.sql`, `scripts/migrate-areas-ticket.sql`.
   - `ticket-service/scripts/seedHistoricalTickets.js` (marcado legacy en
     Sprint F).
   - `catalog-service/prisma/schema.prisma` — se conservó en git durante
     la transición pero ya no aporta valor.
3. Simplificar `.env.example` retirando las variables `POSTGRES_*`.
4. Actualizar `README.md` para que la única sección de setup sea la MSSQL.
5. Documentar la fecha oficial en `FASE_F_MIGRACION_DEFINITIVA_MSSQL.md`
   §15.

**Nota**: Fase 4 **NO se ejecuta desde Sprint F**. Sólo se planifica.

---

## Checklist para cerrar el retiro

- [ ] Etapa 1 ejecutada — compose MSSQL en producción, PG detenido.
- [ ] Etapa 2 completada — 7 días sin rollback, backups verificados.
- [ ] Etapa 3 ejecutada — pg_dump FINAL con SHA-256, PG deshabilitado.
- [ ] 30 días adicionales sin incidencias.
- [ ] DR drill: restore MSSQL exitoso × 2.
- [ ] Autorización del owner.
- [ ] Etapa 4 ejecutada — volumen y archivos legacy eliminados; README y
      `.env.example` actualizados.
