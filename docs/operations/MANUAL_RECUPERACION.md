# Manual de recuperación — ServiceDesk UTA

Resumen operativo. Detalle: `RESTAURACION_SERVIDOR_NUEVO.md` (pérdida total), `RESTAURACION_Y_ROLLBACK.md`, `BACKUPS_MSSQL.md`, `CUSTODIA_CLAVE_BACKUPS.md`, `RETENCION_BACKUPS.md`, `ALERTAS_BACKUPS.md`.

## 1. Qué se respalda y dónde

Cada día (03:15) `scripts/backup-mssql.sh` crea un conjunto en `BACKUP_DIR/sets/<id>` con `auth_db`, `catalog_db`, `ticket_db` (`.bak` con CHECKSUM, verificados con `RESTORE VERIFYONLY`), `manifest.json` (conteos y relaciones), `uploads.sha256`, `config/` (el `.env` recuperable) y `SHA256SUMS`; después lo sube **cifrado** con Restic al repositorio S3 junto con el volumen real de imágenes, y verifica el snapshot. Retención 14 diarios / 8 semanales / 12 mensuales. RPO actual: 24 h (ver `../../INFORME_FINAL_BACKUPS.md` §3 para reducirlo).

Secretos necesarios para recuperar (fuera del servidor, con los custodios): clave Restic, credenciales S3 del bucket. Sin la clave Restic **no hay recuperación posible** desde la copia externa.

## 2. Comprobaciones rutinarias

```bash
scripts/operations/check-backup.sh          # último conjunto local + repositorio externo
systemctl list-timers 'servicedesk-*'       # backup, verificación, retención, drill mensual
journalctl -u servicedesk-backup -n 50
scripts/backup/restic-check.sh --quick      # sin opción = subconjunto 5 % · --full = todo
```

El drill mensual (`servicedesk-restore-drill.timer`) restaura el último snapshot en un SQL Server efímero y compara CHECKDB, 13 conteos, 14 relaciones e imágenes; un fallo dispara `servicedesk-alert@`.

## 3. Restaurar en el mismo servidor (base dañada)

```bash
scripts/restore-mssql.sh --from BACKUP_DIR/sets/<id> --dry-run
scripts/restore-mssql.sh --from BACKUP_DIR/sets/<id> --replace --with-uploads
```

Verifica SHA256SUMS y `VERIFYONLY`, restaura las tres bases, re-mapea logins (`mssql-init`), ejecuta CHECKDB y muestra los conteos. Nunca ejecuta seeds. Después: `docker compose … up -d` y `scripts/operations/smoke-server.sh`.

## 4. Pérdida total del servidor (servidor nuevo)

1. Servidor Ubuntu 24.04 + Docker (manual de instalación §1–2); extraer el paquete de la misma versión (o superior).
2. Recuperar el último conjunto desde Restic con la clave del custodio: `scripts/backup/restic-restore.sh --snapshot latest --target /ruta/recuperado` (`--list` muestra los snapshots) (requiere `/etc/servicedesk/backup.env` con las credenciales S3 y `RESTIC_PASSWORD_FILE`).
3. `cp .env.example deploy/server/.env`, completar con la configuración recuperada (`config/` del conjunto) o nuevos secretos; `sudo scripts/install-server.sh --mode restore --from /ruta/recuperado --generate-secrets`.
4. Validar: conteos = `manifest.json`, `scripts/operations/smoke-server.sh`, login de un usuario, un ticket con historial e imágenes (SHA-256 contra `uploads.sha256`), un reporte.
5. DNS → nuevo servidor; certificado (`--nginx-tls`); reactivar backups (`restic-init` no se repite: el repositorio ya existe) y comprobar que el servidor recuperado hace su propio backup.

Este procedimiento es exactamente el que ejecuta `scripts/testing/backup-dr-simulation.sh` (paso 11), verificado 60/60 el 2026-11-15 en laboratorio.

## 5. Migración desde el VPS anterior (corte controlado)

Solo con autorización expresa y ventana de mantenimiento; el VPS anterior **no se apaga ni se modifica** hasta validar el nuevo (es el rollback).

1. En el VPS: backup manual de las tres bases (`/usr/local/sbin/servicedesk-backup-mssql.sh` o el script de este paquete con `MSSQL_CONTAINER=sd-mssql`), `tar` del volumen `servicedesk-uta_ticket-uploads` (`uploads-<fecha>.tar.gz`), SHA-256 de todo.
2. Copiar al servidor nuevo por un canal cifrado (scp/rsync sobre SSH) y verificar los hashes.
3. `sudo scripts/install-server.sh --mode restore --from <dir> --generate-secrets` (edición licenciada, `SERVER_PURPOSE=produccion`). Los logins SQL del VPS no se reutilizan: `mssql-init` re-mapea los usuarios a credenciales nuevas.
4. Validar como en §4.4 y además: usuarios y roles (`manage-user.sh list-staff`), bloques, constancias (`solution_acceptances` inmutables), outbox histórico (no se reenvía: solo se reintentan `pending/failed` con < 3 intentos), tokens FCM.
5. Registrar en Azure la Redirect URI nueva; probar SSO; cambiar DNS; recompilar el APK.
6. Rollback: volver a apuntar el DNS al VPS anterior (sin cambios). Decomisionar el VPS solo después de un periodo de observación y con un backup final custodiado.

## 6. Lo que nunca se hace

`docker compose down -v`; borrar volúmenes `mssql-*` o `ticket-uploads`; restaurar sin verificar hashes; dar por válida una copia externa sin un drill de restauración; compartir la clave Restic por chat o correo.
