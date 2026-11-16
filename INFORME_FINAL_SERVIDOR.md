# Informe final — Servidor nuevo e infraestructura (ServiceDesk UTA)

**Fecha:** 2026-11-15 · **Referencia:** Ubuntu Server 24.04 LTS + Docker Engine ≥ 28 + Compose v2 + nginx del host + certbot + UFW + systemd. **Instalación en Ubuntu real: BLOCKED** (sin VM ni servidor disponibles desde este equipo); todo lo verificado es **simulación local en Docker Desktop**.

## 1. Arquitectura (`deploy/server/compose.yaml`)

- Redes: `data` (interna, sin Internet: SQL Server + 3 microservicios), `app` (gateway + microservicios, egreso para SSO/SMTP/FCM), `edge` (gateway + frontend). Solo gateway y frontend publican puertos, **únicamente en 127.0.0.1**; nginx del host es la única entrada pública (80 → 301 → 443).
- SQL Server 2022 CU27-GDR1 fijado por digest, usuario `mssql` (uid 10001), volúmenes separados (`mssql-system`, `mssql-data`, `mssql-tlog`, `mssql-backup`), 1433 **no publicado**, `MSSQL_PID` obligatorio y validado contra `SERVER_PURPOSE`.
- Microservicios Node 22.23 (LTS) sin root (`setpriv` → `node`; gateway `USER node`), `no-new-privileges`, límites de memoria/CPU, logs json rotados (20 MB × 5), healthchecks de **readiness** (consulta real a la base; ticket-service también el volumen de imágenes; gateway los tres servicios).
- `PRISMA_ACCEPT_DATA_LOSS=false`: un cambio de esquema con pérdida de datos hace fallar el arranque en vez de borrar columnas. `RUN_SEED` solo en el primer arranque del modo limpio.
- Volumen `ticket-uploads` para imágenes (incluido en los backups).

## 2. Instalador (`scripts/install-server.sh`)

Modos excluyentes `--mode clean` / `--mode restore --from <dir>`; `--dry-run`, `--generate-secrets`, `--yes`, `--test-mode`, `--nginx-tls`, `--skip-*`. Valida: secretos presentes, fuertes y distintos entre sí, `JWT_SECRET` ≥ 32, edición SQL coherente con el propósito, dominio sin protocolo, SSO completo o ausente, SMTP/FCM coherentes, `INITIAL_ADMIN_EMAIL`; guardas contra reinstalar encima de datos o restaurar sin `--replace`; estado en `.install-state`. Endurece el host (daemon.json, UFW 22/80/443, SSH solo con clave si hay clave autorizada, logrotate), construye imágenes, levanta SQL Server, crea bases/logins (`mssql-init`, idempotente, re-mapea usuarios tras un RESTORE), arranca servicios, bootstrap del admin (contraseña temporal en archivo 0600), smoke, nginx, timers de backup, verificación final.

## 3. Verificación de hoy (local, Docker)

| Comprobación | Resultado |
|---|---|
| Simulación completa `new-server-simulation.sh` desde el paquete generado con el código final (guardas, instalación limpia con Developer/pruebas, arquitectura, readiness y recuperación ante caída de SQL, nginx + TLS con la plantilla real, E2E, backup, persistencia restart/down-up, restauración en otro proyecto con Express, guardas de modo) | **PASS 61/61** |
| E2E funcional en modo producción (`smoke-e2e.mjs`) | **PASS 105/105** |
| Esquema: `tickets.location` → `NVarChar(255)` e índice `tickets_resolved_by_id_idx` | PASS: aplicados por `prisma db push` en el laboratorio (base existente con datos) y en la instalación limpia/restaurada de la simulación |
| nginx: `nginx -t`, HSTS, CSP, `/uploads/` 404, `/auth/callback` al backend, límite de login | PASS |
| Impresión real de un reporte con CSP (Chrome headless a través de nginx/TLS) | PASS (0 violaciones) |
| Docker Desktop se cerró durante la sesión; al volver, el laboratorio se recuperó solo (`restart: unless-stopped`) | observado |
| Ubuntu 24.04 real: systemd, certbot, UFW, SSH, logrotate, `docker.service` | **BLOCKED** |

## 4. Procedimiento de instalación real (resumen; detalle en `docs/installation/MANUAL_INSTALACION_NUEVO_SERVIDOR.md`)

1. Ubuntu Server 24.04 x86_64, ≥ 4 GB RAM (8 recomendados), 2 vCPU, 20 GB libres en `/var/lib/docker`; usuario administrativo con clave SSH.
2. Docker Engine + Compose v2 desde el repositorio oficial.
3. Copiar `servicedesk-uta-server-1.0.0-rc6.tar.gz` + `.sha256`, verificar y extraer en `/opt/servicedesk`.
4. `cp .env.example deploy/server/.env`; editar `PUBLIC_DOMAIN`, `MSSQL_PID`, `SERVER_PURPOSE`, `INITIAL_ADMIN_EMAIL`, SSO (`MICROSOFT_*` con tenant GUID y redirect `https://<dominio>/auth/callback`), SMTP, FCM; `--generate-secrets` rellena contraseñas y JWT.
5. `sudo scripts/install-server.sh --mode clean --generate-secrets` (o `--mode restore --from <backup>`).
6. DNS → `certbot certonly --webroot -w /var/www/certbot -d <dominio>` → `scripts/install-server.sh --nginx-tls`.
7. Leer y borrar `deploy/server/.initial-admin-secret`; primer login y cambio de contraseña; `manage-user.sh set-role` / `set-block`.
8. Backups externos (`/etc/servicedesk/backup.env`, clave Restic, custodios, `restic-init`), primer backup y drill.
9. `scripts/operations/smoke-server.sh`, `server-health.sh`, prueba de reinicio y de usuarios.

## 5. Decisiones y datos que faltan

Dominio y DNS; edición/licencia de SQL Server; tenant GUID, client id/secret y Redirect URI nueva en Azure; SMTP institucional; cuenta de servicio Firebase; bucket B2 y custodios; logotipos oficiales; texto aprobado de los términos; ventana de corte y autorización para migrar datos del VPS anterior (`--mode restore` desde un backup verificado, con rollback = VPS anterior intacto).
