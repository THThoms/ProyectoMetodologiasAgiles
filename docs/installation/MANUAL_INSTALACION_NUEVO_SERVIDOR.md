# Manual de instalación — ServiceDesk UTA en un servidor nuevo

Resumen operativo (paquete `servicedesk-uta-server-1.0.0-rc6`). El paso a paso ampliado está en `INSTALACION_SERVIDOR_NUEVO.md`; configuración en `CONFIGURACION_PRODUCCION.md`, `CONFIGURACION_SQL_SERVER.md`, `CONFIGURACION_NGINX.md`, `CONFIGURACION_RED.md`; endurecimiento en `SEGURIDAD_SERVIDOR.md`.

## 0. Antes de empezar: datos que debe entregar la institución

| Dato | Dónde se usa |
|---|---|
| Dominio público con DNS apuntando al servidor | `PUBLIC_DOMAIN`, certificado |
| Edición y licencia de SQL Server (Express/Standard/clave). Developer **solo** con `SERVER_PURPOSE=pruebas` | `MSSQL_PID` |
| Tenant (GUID), client id, client secret y Redirect URI `https://<dominio>/auth/callback` registrada en Azure | `MICROSOFT_*` |
| Correo del administrador inicial (`@uta.edu.ec`) | `INITIAL_ADMIN_EMAIL` |
| SMTP institucional (host, puerto, usuario, contraseña) | `EMAIL_SEND_MODE=smtp`, `SMTP_*` |
| Cuenta de servicio Firebase (si habrá push) | `FCM_*` |
| Bucket B2 + Application Key limitada; dos custodios de la clave Restic | `/etc/servicedesk/backup.env` |
| Logotipos oficiales UTA y FISEI (`frontend/public/branding/uta-logo.png`, `fisei-logo.png`) antes de construir | reportes |

## 1. Servidor

Ubuntu Server 24.04 LTS x86_64, ≥ 4 GB RAM (8 recomendados), 2 vCPU, ≥ 20 GB libres en `/var/lib/docker`, usuario administrativo con clave SSH (`adduser admin && usermod -aG sudo admin`). Docker Engine ≥ 28 y Compose v2 desde el repositorio oficial de Docker.

## 2. Paquete

```bash
sha256sum -c servicedesk-uta-server-1.0.0-rc6.tar.gz.sha256
sudo mkdir -p /opt/servicedesk && sudo tar -xzf servicedesk-uta-server-1.0.0-rc6.tar.gz -C /opt/servicedesk --strip-components=1
cd /opt/servicedesk
```

## 3. Configuración

```bash
cp .env.example deploy/server/.env && chmod 600 deploy/server/.env
```

Editar como mínimo: `PUBLIC_DOMAIN`, `SERVER_PURPOSE`, `MSSQL_PID`, `INITIAL_ADMIN_EMAIL`, `MICROSOFT_*`, `EMAIL_SEND_MODE`/`SMTP_*`, `FCM_MODE`/`FCM_*`. Dejar vacías las contraseñas y `JWT_SECRET` para que `--generate-secrets` las genere (fuertes, distintas, nunca impresas). Nuevas variables (opcionales, con valor por defecto): `SMTP_REQUIRE_TLS`, `EMAIL_OUTBOX_WORKER_INTERVAL_SEC=60`, `VALIDATION_REMINDER_DAYS=3`, `VALIDATION_REMINDER_INTERVAL_MIN=60`.

## 4. Instalación

**Modo A (limpio, sin datos previos):**

```bash
sudo scripts/install-server.sh --mode clean --generate-secrets --dry-run   # revisar
sudo scripts/install-server.sh --mode clean --generate-secrets
```

**Modo B (restauración desde un backup verificado):**

```bash
sudo scripts/install-server.sh --mode restore --from /ruta/al/backup/<STAMP> --generate-secrets
```

El instalador rechaza mezclar modos, reinstalar encima de datos existentes y restaurar sobre datos sin `--replace`. En modo restauración nunca ejecuta seeds. Al terminar ejecuta el smoke, instala nginx (bootstrap HTTP si aún no hay certificado) y los timers de backup.

## 5. HTTPS

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d <dominio>
sudo scripts/install-server.sh --nginx-tls
```

## 6. Administrador y usuarios

```bash
sudo cat deploy/server/.initial-admin-secret && sudo shred -u deploy/server/.initial-admin-secret
scripts/operations/manage-user.sh set-role <correo> technician|dtic|admin
scripts/operations/manage-user.sh set-block <correo> BLOQUE_1|BLOQUE_2|ninguno
```

El primer login obliga a cambiar la contraseña temporal. Los demás usuarios entran por Microsoft (rol `user` inicial) y el administrador les asigna rol y bloque.

## 7. Backups externos

Completar `/etc/servicedesk/backup.env` (creado vacío por el instalador, 600), generar la clave Restic (`scripts/backup/restic-init.sh --generate-password`) y entregarla a los custodios, `restic-test-connection.sh`, `restic-init.sh`, `systemctl start servicedesk-backup.service`, `scripts/operations/check-backup.sh`. Hasta entonces el backup diario termina con código 3 (alerta) y solo queda la copia local. Ver `../operations/CONFIGURACION_BACKBLAZE.md`.

## 8. Verificación final

```bash
scripts/operations/smoke-server.sh
SMOKE_BASE_URL=https://<dominio> scripts/operations/smoke-server.sh
scripts/operations/server-health.sh
sudo reboot   # y repetir smoke: datos e imágenes persisten
```

Probar en el navegador: login local y Microsoft, crear ticket con imágenes, aceptar/resolver/validar, reporte impreso. Android: recompilar el APK con `VITE_API_URL=https://<dominio>` (ver `INFORME_FINAL_ANDROID.md` en la raíz del repositorio).

## 9. Actualizaciones posteriores

Extraer el paquete nuevo sobre `/opt/servicedesk` conservando `deploy/server/.env`, y `docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env up -d --build`. `prisma db push` aplica cambios de esquema compatibles; con pérdida de datos el arranque falla (`PRISMA_ACCEPT_DATA_LOSS=false`) y hay que planificar la migración. Nunca `down -v`.
