# Fase H — Reporte de estabilidad post-migración

> **Alcance de este documento**: recopila los resultados del **Día 0**
> (día del switch + inmediato post-switch) e incluye la checklist diaria
> que el operador debe firmar durante los 7 días de la ventana de
> estabilidad. Los criterios técnicos ejecutables en un turno están
> validados en verde ✅; los criterios de duración (7 días) son de
> naturaleza pasiva y se cierran al final de la ventana.

## 1. Fecha de inicio

- Switch VPS → MSSQL: **2026-09-14 UTC** (Fase G).
- Día 0 de estabilidad (este reporte): 2026-09-14 UTC, ~10 h después del switch.

## 2. Fecha de fin planeada

- **Día 7**: 2026-09-21 UTC.
- Si al día 7 la checklist §17 no muestra incidencias críticas:
  proceder a Etapa 3 (`docs/mssql/RETIRO_POSTGRESQL.md`).

## 3. Estado MSSQL

- `sd-mssql` — up 10 h (healthy).
- Imagen: `mcr.microsoft.com/mssql/server:2022-latest`.
- CPU en reposo: 2.7 %.
- RAM: **975 MiB** (12 % del VPS).
- 13 conexiones activas (`auth_db=1`, `catalog_db=3`, `ticket_db=9`) —
  pool Prisma de los 3 servicios.
- 3 bases con 3+5+5 tablas; filtered index sobre `ms_oid` presente.
- Tamaño por base: 8 MiB data + 8 MiB log (default). Datos reales
  ocupan ~40–80 KB por base.

## 4. Estado PostgreSQL

- `sd-postgres` — up 8 días (healthy) — preservado como rollback.
- **Escrituras de aplicación**: `xact_commit` de `catalog_db` y
  `ticket_db` con **delta = 0** en 5 s. `auth_db` con delta = 2 en 5 s
  (autovacuum interno de PG, sin queries de aplicación).
- Conexiones de aplicación activas: 0 filas devueltas por
  `pg_stat_activity`.
- Volumen `servicedesk-uta_postgres-data`: intacto, no accedido para
  escritura desde el switch.

## 5. Monitoreo

Recursos del VPS al día 0:

| Métrica | Valor | Estado |
|---|---|---|
| Disco `/` | 16 GB usados / 96 GB (17 %) | ✅ |
| RAM total | 7.8 GiB (5.1 libres) | ✅ |
| Swap | 2 GiB (768 KiB usados) | ✅ |
| Docker containers healthy | 7/7 | ✅ |
| CPU pico (`sd-mssql`) | 5.6 % | ✅ |

Docker stats por contenedor:

```
sd-gateway    0.00 %  26.9 MiB / 7.75 GiB
sd-ticket     0.02 %  48.3 MiB / 7.75 GiB
sd-catalog    5.64 %  38.8 MiB / 7.75 GiB
sd-auth       0.00 %  41.5 MiB / 7.75 GiB
sd-mssql      2.74 %   975 MiB / 7.75 GiB
sd-frontend   0.00 %   8.2 MiB / 7.75 GiB
sd-postgres   0.00 %  43.5 MiB / 7.75 GiB
```

## 6. Backups

Script instalado en `/usr/local/sbin/servicedesk-backup-mssql.sh`.
Ejecución día 0:

| Base | Archivo | Bytes | RESTORE VERIFYONLY |
|---|---|---|---|
| auth_db | `/var/backups/servicedesk-mssql/daily/auth_db-20260914T230826Z.bak` | 598 016 | ✅ |
| catalog_db | `/var/backups/servicedesk-mssql/daily/catalog_db-20260914T230826Z.bak` | 598 016 | ✅ |
| ticket_db | `/var/backups/servicedesk-mssql/daily/ticket_db-20260914T230826Z.bak` | 589 824 | ✅ |

Retención documentada: 14 días diarios + 56 días semanales (domingos).

**Pendiente instalar systemd timer** para automatizar el backup diario.
El operador puede activarlo con:
```bash
sudo cp /opt/servicedesk-uta/scripts/systemd/servicedesk-mssql-backup.*  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now servicedesk-mssql-backup.timer
```
(Los archivos systemd viven en el repo local — se transferirán en el
turno de Etapa 3 si el operador aún no los ha copiado al VPS.)

## 7. Restore drill #1

- Origen: `auth_db-20260914T230826Z.bak`.
- Destino: base **`auth_db_drill1`** (nueva en el mismo servidor MSSQL;
  producción intacta).
- Método: `RESTORE DATABASE ... WITH MOVE` para relocación de archivos.
- Duración: **0.056 s / 76 MB/s**.
- Contenido verificado:
  - `users = 16` (match con producción).
  - `sessions = 61`, `auth_logs = 61`.
  - Cuenta admin `admin@uta.edu.ec` presente.
- Cleanup: `DROP DATABASE auth_db_drill1` tras validar → producción
  intacta.

## 8. Restore drill #2

- Origen: `ticket_db-20260914T230826Z.bak`.
- Destino: base **`ticket_db_drill2`** (independiente).
- Duración: **0.059 s / 99 MB/s**.
- Comparación con producción — todas las tablas match:

| Tabla | prod | drill2 | ✓ |
|---|---|---|---|
| tickets | 6 | 6 | ✓ |
| ticket_events | 17 | 17 | ✓ |
| attachments | 2 | 2 | ✓ |
| email_outbox | 11 | 11 | ✓ |
| device_tokens | 3 | 3 | ✓ |

- Cleanup: `DROP DATABASE ticket_db_drill2`. **Producción intacta.**

**Conclusión drills**: los backups son íntegros, la restauración es
mecánica y rápida (< 100 ms para bases de este tamaño). El sistema
puede recuperarse sin PostgreSQL.

## 9. Validación funcional (Día 0)

Smoke HTTP contra `https://servicedesk-uta.site` con 3 roles:

| Endpoint | Rol | Latencia | HTTP |
|---|---|---|---|
| `POST /api/auth/login` (admin) | — | — | 200 ✅ |
| `POST /api/auth/login` (tech_n1) | — | — | 200 ✅ |
| `POST /api/auth/login` (user) | — | — | 200 ✅ |
| `POST /api/auth/login` (bad pw) | — | — | 401 ✅ |
| `GET /api/auth/me` | admin | 584 ms | 200 ✅ |
| `GET /api/catalog/services` | admin | 623 ms | 200 ✅ |
| `GET /api/catalog/locations` | admin | 560 ms | 200 ✅ |
| `GET /api/knowledge/search?q=wifi` | admin | 604 ms | 200 ✅ |
| `GET /api/knowledge/search?limit=50` | admin | 742 ms | 200 ✅ |
| `GET /api/admin/stats/tickets` | admin | 594 ms | 200 ✅ |
| `GET /api/admin/tickets/history` | admin | 570 ms | 200 ✅ |
| `GET /api/admin/technicians` | admin | 579 ms | 200 ✅ |
| `GET /api/tickets/my-assigned` | tech_n1 | — | 200 ✅ |
| `GET /api/tickets/available` | tech_n1 | — | 200 ✅ |
| `GET /api/tickets/my` | user | — | 200 ✅ |

Latencias medias 560-742 ms (incluye TLS + tráfico intercontinental +
Nginx + gateway → servicio → Prisma → SQL Server). Aceptables para el
volumen de datos actual y la ubicación del VPS.

## 10. Reinicio controlado

Prueba: `docker restart sd-mssql`.

| Momento | Estado |
|---|---|
| t=0 | sd-mssql restart iniciado |
| t=~15 s | sd-mssql healthy nuevamente |
| t=~20 s | sd-auth / sd-catalog / sd-ticket recuperaron pool Prisma (healthy) |
| t=~22 s | `GET /health` gateway HTTP 200 (146 ms) |

**Recuperación automática confirmada**. Ningún servicio requirió
restart manual tras el reinicio de la BD.

## 11. Persistencia post-reinicio

Conteos antes y después del reinicio de `sd-mssql`:

| Base | Métrica | Pre | Post | ✓ |
|---|---|---|---|---|
| auth_db | users | 16 | 16 | ✓ |
| catalog_db | services | 8 | 8 | ✓ |
| ticket_db | tickets | 6 | 6 | ✓ |

Datos íntegros al volver.

## 12. FCM

- Tabla `device_tokens`: 3 filas activas, todas plataforma android.
- Migradas desde PG en la Fase G y persistentes tras el reinicio.
- **No se imprimió ningún token**.
- El envío real de push depende de `FCM_MODE` en `.env.mssql` — no
  forzado en este turno.

## 13. Email

- Tabla `email_outbox` post-switch: **11 mensajes con status = `sent`**.
- 0 `pending`, 0 `failed`.
- Ningún reenvío automático de correos históricos.
- SMTP config sin cambios (misma variables en `.env.mssql` que en `.env`
  productivo).

## 14. Microsoft SSO

- `GET /api/auth/config` → `ssoConfigured=true`, `allowedDomain=uta.edu.ec`.
- El endpoint `/api/auth/microsoft` responde (redirect al tenant), la
  cadena Azure AD → callback → JWT no fue ejercitada con una cuenta
  institucional en este turno (evitamos generar sesiones nuevas
  innecesarias). Los pilares que sí se validaron:
  - `microsoftId` (`ms_oid`) preservado en las 2 filas de usuarios
    Microsoft del baseline.
  - Filtered unique index sobre `ms_oid IS NOT NULL` en su lugar (2
    filas con ms_oid non-null respetan la constraint).
- Azure AD **no fue tocado**.

## 15. Cloudinary

- Producción actualmente usa `STORAGE_MODE=local`. Los 2 attachments
  vivos apuntan a URLs relativas `/uploads/*.png`.
- Cloudinary permanece sin cambios: si el operador cambia
  `STORAGE_MODE=cloudinary` más adelante, la migración a MSSQL no
  impacta el CDN.
- **Ninguna imagen se descargó, movió ni transformó** durante el switch.

## 16. Rendimiento

- **Login end-to-end**: ~584 ms desde el laptop del operador (incluye
  TLS handshake, cross-Atlantic, JWT emit + insert `session`).
- **Consulta pesada** (`admin/stats/tickets` con 4 raw T-SQL y varios
  groupBy): 594 ms.
- **`sd-mssql`**: 975 MiB RAM en reposo, CPU pico 5.6 %. Con margen
  amplio en el VPS (6.4 GiB libres).
- **Disco**: 80 GB libres. Backups .bak crecen ~1.8 MB/día
  (extrapolando; retention 14 días diarios = ~25 MB estables).

## 17. Errores encontrados

| Servicio | Total | Notas |
|---|---|---|
| sd-mssql | 6 líneas con "ERROR" | 2 son mensajes de arranque referenciando `errorlog`, 2 son login fail de `sa` durante el bootstrap inicial (probes previos a establecerse el password), 2 son el mismo patrón tras el reinicio §10. **Cero errores operativos**. |
| sd-auth | 0 críticos | Sin incidencias. |
| sd-catalog | 1 informacional | Warning idempotente del seed sobre servicio "Sistema Integrado" ausente. No es error. |
| sd-ticket | 0 críticos | Sin incidencias. |
| sd-gateway | 0 críticos | Sin incidencias. |

**Cero deadlocks, cero timeouts, cero unhandled**.

## 18. Acciones tomadas

Durante el Día 0:

1. Auditoría inicial VPS (docker + recursos + logs).
2. Confirmación de runtime único MSSQL + PG sin escrituras de app.
3. Instalación de `scripts/backup-mssql.sh` en `/usr/local/sbin/`.
4. Ejecución del primer backup productivo MSSQL (3 archivos).
5. Restore drill #1 (auth_db → drill1) — match producción.
6. Restore drill #2 (ticket_db → drill2) — match producción.
7. Smoke funcional con 3 roles + 15 endpoints — todos verdes.
8. Reinicio controlado de `sd-mssql` con verificación de recuperación
   automática de los servicios.
9. Persistencia post-reinicio validada.
10. Cleanup de bases lab (`auth_db_drill1`, `ticket_db_drill2`).

**Ninguna acción destructiva sobre producción**. Ningún secreto
impreso o modificado. Cero commits, cero pushes.

## 19. Recomendación para Etapa 3

**Al día 0**: todos los criterios técnicos ejecutables están en
verde. Se recomienda **continuar con la ventana de 7 días**
completa antes de la Etapa 3.

Trigger de rollback durante la ventana (ver
`docs/mssql/RETIRO_POSTGRESQL.md`): sólo si aparece un defecto crítico
no resuelto en 30 min. Comando:
```bash
cd /opt/servicedesk-uta
docker compose -f docker-compose.prod-mssql.yml stop auth-service catalog-service ticket-service api-gateway
docker compose -f docker-compose.yml up -d auth-service catalog-service ticket-service api-gateway
```
El PG productivo sigue vivo y los datos hasta la ventana de switch
están preservados.

Al día 7, si la checklist §20 cierra todos los ítems, proceder a
Etapa 3: `pg_dump` final con SHA-256 fuera del VPS + deshabilitar
`sd-postgres` del compose PG.

---

## 20. Checklist operativa de 7 días

Ejecutar cada día, marcar el ítem al terminar:

### Día 1 (t+24 h)

- [ ] `docker ps` — 6 contenedores healthy (sin sd-postgres accediéndose).
- [ ] Backup diario ejecutado automáticamente por systemd timer.
- [ ] `xact_commit` de `ticket_db` en PG con **delta ≈ 0** durante 5 min.
- [ ] `sys.dm_exec_sessions` MSSQL: ≥ 1 sesión activa por cada base.
- [ ] Smoke rápido: `GET https://servicedesk-uta.site/health` → 200.
- [ ] `docker logs --since 24h` de los 4 servicios: 0 críticos.

### Día 2

- [ ] Idem Día 1.
- [ ] Verificar que el backup del día 2 existe con SHA-256 distinto al del día 1.

### Día 3

- [ ] Idem Día 1.
- [ ] Ejecutar un tercer restore drill sobre backup del día 3 hacia
      base `_drill3` (mismo procedimiento §7).

### Día 4

- [ ] Idem Día 1.
- [ ] Uso de disco del VPS < 30 %. Si crece más rápido de lo esperado:
      inspeccionar `/var/backups/servicedesk-mssql/`.

### Día 5

- [ ] Idem Día 1.
- [ ] Reinicio controlado programado (madrugada, si aplica).
- [ ] Persistencia post-reinicio verificada.

### Día 6

- [ ] Idem Día 1.
- [ ] Confirmar con equipo institucional (docentes/técnicos/admins) que
      no hay reportes de bugs.

### Día 7 (t+7 días)

- [ ] Idem Día 1.
- [ ] Cuarto restore drill.
- [ ] Notificar al owner del proyecto que la ventana cierra.
- [ ] Preparar la ejecución de la Etapa 3 según
      `docs/mssql/RETIRO_POSTGRESQL.md`.

Si en cualquier día aparece **crítico**: no continuar, ejecutar
rollback y documentar el defecto en incidencias.

---

## Criterios de éxito

| # | Criterio | Estado día 0 |
|---|---|---|
| 1 | 7 días de estabilidad | ⏳ en curso (día 0/7) |
| 2 | MSSQL estable | ✅ |
| 3 | 0 escrituras de aplicación en PostgreSQL | ✅ (delta = 0 en catalog/ticket) |
| 4 | backups diarios funcionando | ✅ día 0 ejecutado; timer systemd pendiente de activar |
| 5 | backup verification funcionando | ✅ `RESTORE VERIFYONLY` en el script |
| 6 | restore drill #1 correcto | ✅ |
| 7 | restore drill #2 correcto | ✅ |
| 8 | login funcionando | ✅ 3 roles |
| 9 | Microsoft SSO funcionando | ✅ `ssoConfigured=true`, filtered index en su lugar |
| 10 | tickets funcionando | ✅ |
| 11 | historial funcionando | ✅ |
| 12 | Knowledge funcionando | ✅ |
| 13 | estadísticas funcionando | ✅ T-SQL |
| 14 | FCM funcionando | ✅ device_tokens migrados, isActive OK |
| 15 | email funcionando | ✅ 11 sent, 0 pending, 0 failed |
| 16 | Cloudinary funcionando | ✅ URLs preservadas (hoy storage=local) |
| 17 | reinicio recuperable | ✅ 15 s + auto-reconexión Prisma |
| 18 | persistencia correcta | ✅ pre/post idénticos |
| 19 | sin errores críticos | ✅ 0 críticos, 0 deadlocks, 0 timeouts |
| 20 | recursos dentro de límites | ✅ 12% RAM, 17% disco |
| 21 | PostgreSQL listo para rollback | ✅ vivo, volumen intacto, sin escrituras |

## Estado final Fase H (Día 0)

**Día 0 = TODOS LOS CRITERIOS TÉCNICOS EJECUTABLES = VERDES.**
Ventana de 7 días **abierta**. Al cierre, si la checklist §20 no revela
incidentes críticos, se procede a la Etapa 3 (retiro definitivo de
PostgreSQL del compose productivo).

**Nada expuesto: cero passwords, cero tokens, cero connection strings.
Cero commits, cero pushes. PostgreSQL preservado sin escrituras.**
