# Informe final — Backups y recuperación (ServiceDesk UTA)

**Fecha:** 2026-11-15 · **Alcance:** laboratorio local (Docker). **Backblaze B2 real: BLOCKED** (sin credenciales); nada externo se declara activo.

## 1. Arquitectura implementada (Fase S, verificada hoy)

- `scripts/backup-mssql.sh` genera un **conjunto** con identificador: `BACKUP DATABASE … WITH CHECKSUM, COMPRESSION` de `auth_db`, `catalog_db` y `ticket_db` + `RESTORE VERIFYONLY WITH CHECKSUM` + SHA-256 de cada `.bak`; `manifest.json` (id, bases, tamaños, hashes, conteos de 13 tablas, 14 relaciones lógicas), `uploads.sha256` (cada imagen) y la configuración recuperable; `SHA256SUMS` del conjunto.
- `scripts/backup/restic-backup.sh` sube el conjunto **y el volumen real de imágenes** a un repositorio **Restic** (cifrado AES-256 en el cliente; el bucket solo recibe paquetes cifrados), lo etiqueta y **verifica el snapshot leyendo del repositorio** (SHA256SUMS idéntico, 3 bases, nº de imágenes).
- Retención `restic-retention.sh` 14 diarios / 8 semanales / 12 mensuales, con salvaguardas (no se aplica sin snapshot reciente ni con el último incompleto). `restic-check.sh` rápido / 5 % / completo. `restore-drill.sh` restaura en un SQL Server efímero y compara CHECKDB, conteos, relaciones e imágenes.
- Dos secretos distintos: credenciales S3 (`/etc/servicedesk/backup.env`, 600) y clave Restic (`RESTIC_PASSWORD_FILE`, 600) con **dos custodios** (`restic-keys.sh`: clave independiente del custodio, rotación/revocación de la del servidor).
- Programación systemd: backup diario 03:15, verificación, retención, drill mensual, `servicedesk-alert@` ante cualquier fallo (código 3 = sin copia externa).

## 2. Resultados de hoy (local)

| Comprobación | Resultado |
|---|---|
| `backup-mssql.sh` + `check-backup.sh` en la simulación de servidor nuevo | PASS |
| Restauración en otro proyecto Docker con credenciales nuevas y SQL Server Express: 3 bases + imágenes, conteos = origen, login, imagen servida | PASS |
| Simulación DR completa `backup-dr-simulation.sh` (Restic + MinIO aislado): 60 comprobaciones (TLS, usuario S3 limitado, 8 diagnósticos de error, snapshot cifrado verificado, deduplicación, ningún texto plano en el bucket, retención 14/8/12 sobre 400 snapshots sintéticos, manipulación detectada, custodia y rotación de claves, drill PASS y drill negativo, **desastre: servidor nuevo desde el paquete + clave del custodio → 3 bases, 10 imágenes SHA-256 idénticas, login, historial**, persistencia, backup desde el servidor recuperado, sin secretos en logs, origen intacto) | **PASS 60/60** (2.ª ejecución; la 1.ª dio 59/60 por una interferencia del propio auditor, documentada en `AUDITORIA_GENERAL_SERVICEDESK_UTA.md` §12b) |
| Backblaze B2: bucket, Application Key, `restic-init`, primer backup y restauración real | **BLOCKED** (credenciales e institución) |
| Custodios designados | BLOCKED (decisión institucional) |

## 3. RPO: análisis y decisión pendiente

Modelo actual: bases en `RECOVERY SIMPLE` (lo fija `deploy/server/mssql-init/init.sql`) y **backup FULL diario** → pérdida máxima teórica de **24 h** de transacciones (tickets, eventos, constancias). Las imágenes se respaldan con el mismo conjunto.

Opciones si la institución exige menos pérdida:

| Opción | RPO | Cambios necesarios | Riesgo |
|---|---|---|---|
| A. FULL diario + `BACKUP DATABASE … WITH DIFFERENTIAL` cada 6 h (sigue en SIMPLE) | ≤ 6 h | nuevo timer + script de diferencial; restauración FULL + último DIFF; retención por conjunto | bajo (no cambia el modelo de recuperación) |
| B. `RECOVERY FULL` + log cada 15 min | ≤ 15 min, punto en el tiempo | cambiar `init.sql`, timer de `BACKUP LOG`, gestión del crecimiento del `.ldf`, restauración encadenada con `NORECOVERY`, drill de la cadena | medio: una cadena rota deja el log creciendo sin control; exige monitoreo |

Recomendación: definir primero el RPO aceptable con la FISEI. Para un servicio de mesa de ayuda con decenas de tickets diarios, la opción A suele bastar y mantiene la operación simple; la B solo si se exige recuperación punto en el tiempo. **No se implementó ninguna de las dos sin esa decisión**; la actual (24 h) queda documentada.

## 4. Procedimiento de alta de B2 (cuando existan credenciales)

1. Crear bucket privado y Application Key limitada al bucket (nunca la Master Key) — `docs/operations/CONFIGURACION_BACKBLAZE.md` §1–4.
2. Completar `/etc/servicedesk/backup.env` (600) con endpoint, bucket y claves S3; generar la clave Restic con `scripts/backup/restic-init.sh --generate-password` y entregarla a los dos custodios (`docs/operations/CUSTODIA_CLAVE_BACKUPS.md`).
3. `scripts/backup/restic-test-connection.sh` → `restic-init.sh` → `systemctl start servicedesk-backup.service` → `scripts/operations/check-backup.sh`.
4. **Obligatorio antes de declarar activos los backups externos**: `scripts/backup/restore-drill.sh` con la clave del custodio, y una restauración completa en otro equipo (`docs/operations/RESTAURACION_SERVIDOR_NUEVO.md`).

## 5. Procedimiento de recuperación

Ver `MANUAL_RECUPERACION.md` (resumen operativo) y `docs/operations/RESTAURACION_SERVIDOR_NUEVO.md` (detalle). Un `RESTORE VERIFYONLY` nunca se considera suficiente: la recuperación se valida con CHECKDB, conteos, relaciones, login, tickets, historial, imágenes (SHA-256) y reportes.

## 6. Pendientes

- B2 real, custodios, decisión de RPO (sección 3).
- Monitoreo externo del latido (`BACKUP_HEARTBEAT_URL`, opcional) para detectar un servidor caído que ya no ejecuta backups.
- Repetir la simulación DR en el servidor real (Ubuntu) con el repositorio B2 antes de la puesta en marcha.
