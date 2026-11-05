# Fase F — Reporte

> **VEREDICTO: FASE F = BLOQUEADA**
>
> El precheck F0 detiene la ejecución. **Ningún dato productivo fue tocado.**
> **VPS intacto. PostgreSQL productivo intacto. SQL Server institucional
> no contactado.** Cero commits, cero pushes.

## 1. Objetivo
Migración controlada de PostgreSQL del VPS al SQL Server institucional
UTA, con backup, validación, switch de `DATABASE_URL`, smoke E2E y
rollback listo.

## 2. Prerrequisitos — Precheck F0

Regla del proyecto: *"No continuar si falta alguno."*

| # | Prerrequisito | Estado | Detalle |
|---|---|---|---|
| 1 | Host MSSQL UTA | ❌ BLOCKED | `.env.uta` no existe. El DBA no ha entregado FQDN/IP. |
| 2 | Puerto | ❌ BLOCKED | Depende de (1). |
| 3 | Tipo de autenticación | ❌ BLOCKED | No confirmado con el DBA (SQL Auth vs Windows/Kerberos). |
| 4 | Usuario | ❌ BLOCKED | Sin credencial entregada. |
| 5 | Contraseña por canal seguro | ❌ BLOCKED | Sin credencial entregada. |
| 6 | `auth_db` existe/autorizado | ❌ BLOCKED | No verificado. |
| 7 | `catalog_db` existe/autorizado | ❌ BLOCKED | No verificado. |
| 8 | `ticket_db` existe/autorizado | ❌ BLOCKED | No verificado. |
| 9 | Acceso de red desde VPS | ❌ BLOCKED | No probado (`nc -vz <host> <port>` requiere host real). |
| 10 | TLS / certificado definido | ❌ BLOCKED | Sin cert ni política; `trustServerCertificate` sin decidir. |
| 11 | Collation confirmada | ❌ BLOCKED | Recomendada `SQL_Latin1_General_CP1_CI_AS`, no confirmada por DBA. |
| 12 | Ventana de mantenimiento | ❌ BLOCKED | No agendada. |
| 13 | Autorización explícita para migrar | ❌ BLOCKED | El usuario no autorizó tocar VPS ni UTA en este turno. |
| 14 | Rollback definido | ✅ PASS | `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md` Fase 13. |

**Resultado F0**: 1 PASS / 13 BLOCKED → **DETENERSE**.

## 3. Servidor destino
No identificado. Ninguna conexión establecida al SQL Server UTA. `DESTINO
VALIDADO = NO`.

## 4. Backup
No ejecutado. Regla del proyecto: *"antes de tocar cualquier sistema,
crear backup... NO continuar si algún backup está incompleto"*. Como F0
está bloqueado, no procede backup productivo desde el VPS.

**Estado del PostgreSQL productivo**: intacto en el VPS. **No se abrió
sesión SSH en esta conversación.**

Notar: existen los `pg_dump` **locales** de Fase D en
`scratchpad/pg-dumps/` (auth_db 208 KB, catalog_db 28 KB, ticket_db
216 KB) — pero son del **PostgreSQL local de dev**, no del productivo
del VPS. **No sirven como backup de producción**.

## 5. Conteos PG
No capturados en esta fase. Los conteos productivos requieren SSH al
VPS o `pg_dump` productivo — ambos suspendidos por F0.

## 6. Conteos MSSQL
No hay MSSQL UTA al que consultar. Los conteos del **lab local**
(`sd-mssql-lab`, con datos de Fase D) siguen consistentes, pero no
representan una migración productiva.

## 7. Comparación
No ejecutada. Requiere ambos lados (PG productivo + MSSQL UTA) — falta
el lado UTA.

## 8. UUID
Sin comparar (misma razón).

## 9. Fechas
Sin comparar (misma razón).

## 10. Relaciones
Sin comparar (misma razón).

## 11. DeviceToken
El schema MSSQL (`ticket-service/prisma/schema.mssql.prisma`) ya
contempla `DeviceToken` con `token @db.NVarChar(512) @unique`. Cuando el
DBA UTA autorice, la migración cargará los tokens FCM reales del VPS.

## 12. EmailOutbox
El schema MSSQL contempla `EmailOutbox` con `htmlBody/textBody
@db.NVarChar(Max)` y `status @db.NVarChar(16)`. Recomendación (para
cuando Fase F se ejecute): migrar los registros históricos tal cual;
**NO reenviar** correos `pending` viejos automáticamente.

## 13. Attachments
El schema MSSQL contempla `Attachment.imageUrl` como string. La
migración solo copiaría URLs — **nunca binarios ni Base64**. Cloudinary
seguirá intacto.

## 14. Sesiones
No invalidadas. La regla F9 se ejecutaría **después** de comprobar la
migración; F0 bloquea antes de llegar allí.

## 15. Cambio de producción
No ejecutado. `DATABASE_URL` de `auth-service`, `catalog-service` y
`ticket-service` en el VPS sigue apuntando a `sd-postgres`. **Docker
Compose productivo intacto.**

## 16. Smoke test
No ejecutado contra UTA (no hay UTA). El último smoke verde
(60/60 asserts) fue el de Fase D contra el **lab local**.

## 17. Resultado
**FASE F = BLOQUEADA**. Ejecución detenida en F0 por prerrequisitos
faltantes. Ningún dato productivo modificado. Ninguna sesión
invalidada. Ningún `.env` productivo tocado.

## 18. Incidencias
- **Incidencia única**: falta la entrega de credenciales y bases por
  parte del DBA de la UTA. Está fuera del alcance técnico del equipo
  del ServiceDesk resolverlo desde el código; requiere coordinación
  institucional.

## 19. Rollback
- No aplica: no hubo cambio que revertir.
- El **plan de rollback preparado** en Fase E
  ([docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md](../institucional-uta/PLAN_CAMBIO_PRODUCCION.md)
  Fase 13) sigue vigente para cuando Fase F pueda ejecutarse.

## 20. Estado final
- **Producción VPS**: intacto (`sd-postgres` + 5 servicios PG viviendo
  su vida como siempre).
- **SQL Server institucional UTA**: no contactado. Cero paquetes TCP
  enviados desde este entorno.
- **Laboratorio MSSQL** (`sd-mssql-lab`): sigue funcionando con la
  copia migrada de Fase D — no está afectado por este bloqueo.
- **Repo**: cero archivos modificados en esta fase; cero archivos
  creados aparte de este reporte.
- **Secretos**: ninguno impreso, ninguno reenviado, ninguno filtrado.

---

## Qué se necesita para desbloquear Fase F

En orden estricto:

1. **Reunión con el DBA UTA** con la checklist
   `docs/mssql-uta/REQUISITOS_DBA.md` en la mano.
2. Recibir del DBA, por canal seguro (Bitwarden compartido, KeePass
   con clave via SMS, sobre en persona):
   - `UTA_MSSQL_HOST`, `UTA_MSSQL_PORT`
   - Cuenta(s) con permisos DDL para bootstrap + DML para operación
   - Nombres reales de las 3 bases (`UTA_AUTH_DB`, etc.)
   - Cert TLS o autorización de `TrustServerCertificate=true`
3. **Copiar `.env.uta.example` a `.env.uta`** (no commitear) y
   rellenar.
4. Correr `node scripts/check-uta-mssql.js` — debe imprimir conexión
   OK + `sys.databases` con las 3 bases + collation.
5. Desde el VPS, `nc -vz <UTA_HOST> <UTA_PORT>` — debe devolver
   `succeeded`.
6. Acordar **ventana de mantenimiento** (~2 h, madrugada preferible).
7. Solicitar autorización explícita del owner del proyecto (Tomás
   Solís) para ejecutar Fase F contra producción real.

Cuando los 7 puntos estén cumplidos, la Fase F se reintenta desde F0.
En ese momento el precheck marcará **13/14 PASS** (el 13 exige
autorización durante el turno de ejecución).

## Siguiente acción recomendada

Enviar `docs/mssql-uta/REQUISITOS_DBA.md` al DBA institucional (por
email formal o ticket interno) y agendar reunión. Todo el código,
schemas MSSQL, scripts de migración, smoke tests y plan de rollback
**ya están listos** en el repo (Fases B, C, D, E). Cuando lleguen los
datos, Fase F se puede ejecutar en < 2 horas siguiendo
`docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md`.

---

**NO SE MIGRARON DATOS PRODUCTIVOS.**
**PRODUCCIÓN VPS INTACTA.**
**SQL SERVER UTA NO TOCADO.**
**NINGÚN SECRETO EXPUESTO.**
**CERO COMMITS, CERO PUSHES.**
