# FASE P — Auditoría del VPS y comparación con el entorno local

**Fecha:** 2026-11-04 (VPS en CET, UTC+1)
**VPS:** `vmi3560421` · `<IP_VPS>` · `/opt/servicedesk-uta` · `https://servicedesk-uta.site`
**Local:** Windows 11, Docker Desktop 29.5.3, rama `Develop` (sin commits nuevos desde 7c5620b)
**Tipo de operación:** **solo lectura** en el VPS. No se reinició, modificó, borró ni desplegó nada. No se consultaron las bases de datos.

Escrito para: el equipo del proyecto (Tech Lead + docente supervisor).

**Este documento no contiene** contraseñas, JWT, tokens FCM, credenciales SMTP o Cloudinary, connection strings ni secretos. Las credenciales se compararon solo mediante un hash truncado, sin mostrar valores.

---

## 1. Resumen ejecutivo

| Área | Estado | Comentario |
|---|---|---|
| Aplicación en producción | 🟢 Funciona | 6 servicios arriba, web y API responden, TLS válido |
| Código VPS vs local | 🟢 Coinciden | 89/93 archivos idénticos; las 4 diferencias son esperadas |
| Entorno local | 🟢 Funciona | Stack MSSQL reconstruido, smoke 22/22, tests 293/293 |
| **Backups de producción** | 🔴 **No funcionan** | **Último backup: 15-sep-2026.** El timer diario ejecuta el script antiguo de PostgreSQL y falla todos los días |
| **Login "Microsoft simulado"** | 🔴 **Crítico** | Endpoint sin contraseña activo en el código desplegado |
| **Credenciales SQL** | 🔴 Sin rotar | Las 3 contraseñas expuestas en la Fase N siguen iguales |
| Compose legacy en el VPS | 🟠 Riesgo | `docker-compose.yml` (PostgreSQL) sigue en el directorio del proyecto |
| Healthcheck frontend | 🟡 Cosmético | Causa confirmada en local y en el VPS |
| Certificado TLS | 🟡 Vigilar | Vence el 5-dic-2026; `certbot.timer` activo |
| APK Android | ⚪ No verificado | Bundle correcto; falta la prueba en un dispositivo físico |

## 2. Alcance y método

- Acceso SSH con la contraseña de root facilitada por el operador. Se leyó desde un archivo temporal y se borró al terminar. No aparece en ningún comando ni salida.
- Clave de host verificada: `SHA256:J2X6lFWVVl0VZ3C6Pp6rO0fKzJB/tyC1dBbglwu6QbI`, la misma registrada en `known_hosts`.
- Comandos utilizados: `docker ps/volume ls/exec` (solo lectura), `systemctl`, `journalctl`, `ls`, `stat`, `md5sum`, `grep`.
- Comprobación externa por HTTPS desde la máquina local.
- **No se hizo:** consultas a SQL Server, login contra producción, pruebas del endpoint simulado, ni ningún cambio de configuración.

## 3. Estado del VPS

### 3.1 Sistema

| Dato | Valor |
|---|---|
| Uptime | **El VPS se reinició el 2026-11-04 a las 22:27 CET**, aproximadamente 1 minuto antes de la auditoría; el reinicio anterior fue el 18-oct |
| Disco `/` | 96 GB, 19 GB usados (20 %) |
| RAM | 7.9 GB, 6.5 GB disponibles |
| nginx (host) | `active` |
| Certificado | Let's Encrypt (YE2), vence el **2026-12-05 22:20 GMT**; `certbot.timer` activo (próxima ejecución el 05-nov 07:14) |

El reinicio no se originó en esta auditoría. Probablemente se lanzó desde el panel del proveedor. **Todos los servicios volvieron solos** gracias a `restart: unless-stopped`.

### 3.2 Contenedores

| Contenedor | Estado | Imagen |
|---|---|---|
| `sd-mssql` | healthy | `mcr.microsoft.com/mssql/server:2022-latest` |
| `sd-auth` | healthy | `servicedesk-microservices-auth-service-mssql` |
| `sd-catalog` | healthy | `servicedesk-microservices-catalog-service-mssql` |
| `sd-ticket` | healthy | `servicedesk-microservices-ticket-service-mssql` |
| `sd-gateway` | healthy | `servicedesk-microservices-api-gateway` |
| `sd-frontend` | **unhealthy** (sirve HTTP 200, ver §6.5) | `servicedesk-microservices-frontend` |
| `sd-mssql-init` | Exited (0), job de inicialización | — |

No hay ningún contenedor de PostgreSQL. **PostgreSQL sigue retirado.**

### 3.3 Volúmenes

`servicedesk-uta_mssql-data`, `servicedesk-uta_mssql-log`, `servicedesk-uta_mssql-secrets` y `servicedesk-uta_ticket-uploads`, este último con **7 archivos**, la misma cantidad que en la Fase M/N. Todos intactos.

### 3.4 Almacenamiento de imágenes

`STORAGE_MODE=cloudinary` está configurado, pero el paquete `cloudinary` **no está instalado** en `sd-ticket`. En la práctica el almacenamiento es local. Es el mismo comportamiento documentado en las fases L–N.

### 3.5 Comprobación pública (HTTPS)

| Ruta | Resultado |
|---|---|
| `/` y `/mis-aceptados` | 200 `text/html` |
| `/api/catalog/services` | 200 JSON (4116 B) |
| `/api/tickets/my` sin JWT | 401 (correcto) |
| `/api/auth/config` | `ssoConfigured: true`, `devLoginEnabled: false`, `microsoftSimulateEnabled: true` |
| Bundle servido | `assets/index-B6aM42JF.js` |

## 4. Comparación VPS ↔ local

Se compararon por MD5 93 archivos: todo el código fuente `.ts`/`.tsx` de los 5 proyectos, los `package.json`, los schemas Prisma, `docker-compose.prod-mssql.yml`, los Dockerfiles y `frontend/nginx.conf`.

| Resultado | Archivos |
|---|---:|
| Idénticos | **89** |
| Distintos | 1 |
| Solo en local | 3 |

- **Distinto:** `ticket-service/prisma/schema.prisma`. En el VPS es una versión anterior, aunque también con `provider = "sqlserver"`. **Sin impacto**: `Dockerfile.mssql` lo reemplaza por `schema.mssql.prisma` durante el build, y ese archivo es idéntico al local. El contenedor en ejecución tiene las 7 columnas `NVarChar(24)` de la Fase K.
- **Solo en local:** los 3 `schema.pg.legacy.prisma`. Esperado, porque son archivos históricos que no se usan en runtime.
- **Frontend:** producción sirve `index-B6aM42JF.js`, que coincide con `frontend/dist` local y con el bundle del APK de la Fase O.

**Conclusión: producción ejecuta el mismo código que tu repositorio local.** No hay cambios locales pendientes de desplegar ni cambios en el VPS que falten en local, salvo la configuración propia del servidor (`.env.mssql`, nginx del host, systemd).

### 4.1 Archivos que solo existen en el VPS (configuración del servidor)

- `/opt/servicedesk-uta/docker-compose.yml` y `docker-compose.override.yml`: **el compose antiguo de PostgreSQL**. En local se renombró a `docker-compose.legacy-pg.yml`, pero en el VPS conserva su nombre original (ver §6.4).
- `/opt/servicedesk-uta/.env`: archivo de entorno antiguo (permisos 600).
- `/opt/servicedesk-uta/.env.mssql` (en uso, 600) y `.env.mssql.pre-fase-N-20260915T205210Z` (backup, 600).
- `/opt/servicedesk-uta/.backups/pre-fase-M-*`.
- `/usr/local/sbin/servicedesk-backup.sh` (PostgreSQL), `servicedesk-backup-mssql.sh` (MSSQL) y `servicedesk-logrotate-authlogs.sh`.
- Unidades systemd `servicedesk-backup.{service,timer}` y `servicedesk-logrotate.{service,timer}`: **no están en el repositorio**.

## 5. Entorno local

| Comprobación | Resultado |
|---|---|
| Stack | `docker-compose.mssql.yml`. **Las imágenes locales eran del 14-sep, anteriores a la Fase L/M**; se reconstruyeron con `--build` sin tocar volúmenes |
| Contenedores | `sd-mssql-lab`, `sd-auth-mssql`, `sd-catalog-mssql`, `sd-ticket-mssql`, `sd-gateway-mssql` healthy; `sd-frontend-mssql` unhealthy (misma causa, §6.5) |
| URLs | Frontend `http://localhost:13000`, gateway `http://localhost:18080` |
| Tests unitarios | **293/293** (auth 26, catalog 52, ticket 215) |
| TypeScript | Limpio en auth, catalog, ticket, gateway y frontend |
| Smoke E2E | **22/22**: health, SPA, dev-login de 5 roles, catálogo, creación de ticket con imagen, URL autenticada, 401/200/200/403, técnico DTIC acepta y ve la imagen |
| Navegador | La pantalla de login renderiza correctamente (captura con Chrome headless) |

El ticket de prueba `TK-20261104-001` quedó en la base **del laboratorio local**, no en producción.

## 6. Hallazgos

### 6.1 🔴 CRÍTICO — Producción lleva 7 semanas sin backups

Evidencia:

- `servicedesk-backup.timer` se ejecuta a diario a las 03:00 y lanza `servicedesk-backup.service`.
- Ese servicio ejecuta `/usr/local/sbin/servicedesk-backup.sh`, **el script de `pg_dump` contra `sd-postgres`** (descripción: "Backup diario de PostgreSQL").
- El journal muestra el mismo fallo en cada ejecución registrada (02, 03 y 04-nov, y otra vez tras el reinicio de las 22:27): `ERROR: contenedor sd-postgres no está corriendo. Abort.` → `status=1/FAILURE`.
- En `/var/backups/servicedesk-mssql/daily/` **solo hay `.bak` del 14 y 15 de septiembre**. Ningún backup de SQL Server es posterior al 15-sep-2026.
- El script correcto (`servicedesk-backup-mssql.sh`) está instalado, pero ningún timer lo ejecuta.

Causa: en la Fase N se retiró `sd-postgres`, pero el timer heredado no se reapuntó al script MSSQL. El timer de la Fase H (`servicedesk-mssql-backup.timer`) nunca llegó a instalarse.

**Impacto:** si se perdiera el volumen `mssql-data`, todo lo registrado desde el 15-sep (tickets, eventos, sesiones, outbox) sería irrecuperable.

Acción recomendada (requiere autorización):

1. Ejecutar ya un backup manual con `/usr/local/sbin/servicedesk-backup-mssql.sh` y su `RESTORE VERIFYONLY`.
2. Cambiar `ExecStart` de `servicedesk-backup.service` al script MSSQL, o crear una unidad nueva y deshabilitar la antigua.
3. Versionar las unidades systemd en `scripts/systemd/` dentro del repositorio.
4. Copiar los backups fuera del VPS (hoy viven en el mismo disco que los datos).
5. Configurar una alerta ante fallos del servicio (por ejemplo, `OnFailure=` con correo).

### 6.2 🔴 CRÍTICO — Login "Microsoft simulado" sin contraseña en producción

- `POST /auth/microsoft-simulate` (`auth-service/src/routes/authRoutes.ts:71`) emite un JWT para cualquier correo `@uta.edu.ec` sin pedir contraseña ni pasar por Azure.
- Ninguna variable lo controla: `microsoftSimulateEnabled: true` está fijo en el código (línea 284).
- El código desplegado lo incluye: `/app/dist/routes/authRoutes.js` dentro de `sd-auth` contiene la ruta, y `/api/auth/config` de producción responde `microsoftSimulateEnabled: true`.
- **No se probó contra producción**, porque crearía una sesión real como otro usuario.

**Impacto potencial:** cualquier persona podría obtener una sesión de administrador o de cualquier otro usuario.

Acción recomendada: condicionar el endpoint y el botón de la UI a una variable (por ejemplo `AUTH_MICROSOFT_SIMULATE`), desactivada por defecto. Después, probar en local, desplegar solo `auth-service` y `frontend`, y verificar que en producción el endpoint devuelve 404. Por último, revisar `auth_logs` buscando entradas con `authProvider = microsoft-simulated` en producción, para saber si se ha usado.

### 6.3 🔴 ALTO — Credenciales sin rotar

- `AUTH_DB_PASSWORD`, `CATALOG_DB_PASSWORD`, `TICKET_DB_PASSWORD`: **sin cambios desde la Fase N**. Se comparó por hash contra el backup `.env.mssql.pre-fase-N`. Siguen siendo las mismas que se expusieron en un tool output de la Fase N.
- `MSSQL_SA_PASSWORD`: sin cambios (no estuvo expuesta).
- **Contraseña de root del VPS:** se compartió en el chat de esta sesión. Se recomienda cambiarla y pasar el acceso a clave SSH (y, si es posible, desactivar el acceso por contraseña).

Acción recomendada: rotar los 3 usuarios con `ALTER LOGIN … WITH PASSWORD`, actualizar `.env.mssql` y recrear solo `sd-auth`, `sd-catalog` y `sd-ticket`, con backup previo. Cambiar la contraseña de root desde el panel o con `passwd` y autorizar la clave pública del operador.

### 6.4 🟠 MEDIO — El compose de PostgreSQL sigue con su nombre original en el VPS

En `/opt/servicedesk-uta` existen `docker-compose.yml` (PostgreSQL) y `docker-compose.override.yml`. Un `docker compose up -d` ejecutado **sin `-f docker-compose.prod-mssql.yml`** levantaría el stack antiguo contra PostgreSQL, que ya no existe, y podría crear contenedores con los mismos nombres.

Acción recomendada: renombrarlos a `*.legacy-pg.yml`, como en local. También se puede retirar `/usr/local/sbin/servicedesk-backup.sh` y el `.env` antiguo, archivándolos.

### 6.5 🟡 BAJO — Healthcheck de `sd-frontend` (causa confirmada)

Dentro de `sd-frontend` (VPS) y de `sd-frontend-mssql` (local): `wget http://localhost/` **falla** y `wget http://127.0.0.1/` **funciona**. `localhost` resuelve a `::1` y `frontend/nginx.conf` solo escucha en IPv4 (`listen 80;`).

Arreglo: usar `http://127.0.0.1/` en el healthcheck de `docker-compose.prod-mssql.yml` y de `docker-compose.mssql.yml`, o añadir `listen [::]:80;` en `nginx.conf`. No afecta al servicio.

### 6.6 🟡 Otros pendientes (sin cambios respecto a la incorporación)

- Todo el trabajo de las fases B–P está **sin commitear** en local, y `.env.mssql` **no está cubierto por `.gitignore`**.
- Los scripts de smoke de las fases C–K se perdieron. Existe un smoke nuevo de 22 asserts en el scratchpad de esta sesión, pendiente de incorporarlo al repositorio.
- Al aceptar la solución, el ticket pasa a `resuelto` y no a `cerrado`, y no se registra un evento `CLOSED`. Hay que decidir si es el comportamiento esperado.
- La tarjeta "Técnicos por bloque" de `AdminStats.tsx` agrupa por nivel N1–N4 y área, no por bloque físico.
- Tickets de smoke de la Fase K en la base de producción.
- `location /uploads/` del nginx del host: código muerto.

## 7. No verificado en esta auditoría

- Conteos de filas en SQL Server de producción (no se consultó la base).
- Estado de `email_outbox` y envío real de correo.
- Envío real de notificaciones FCM.
- Login real con Microsoft SSO (cuenta institucional).
- **APK Android en un dispositivo físico** (Fase O).
- Configuración completa del nginx del host y del firewall (UFW).

## 8. Plan recomendado (por prioridad)

| # | Acción | Dónde | Requiere |
|---|---|---|---|
| 1 | Backup MSSQL manual inmediato + VERIFYONLY | VPS | Autorización |
| 2 | Reapuntar el timer de backups al script MSSQL y versionar las unidades | VPS + repo | Autorización |
| 3 | Desactivar el login "Microsoft simulado" por variable, probar en local y desplegar auth + frontend | repo → VPS | Autorización para desplegar |
| 4 | Revisar `auth_logs` en busca de usos de `microsoft-simulated` | VPS (lectura de BD) | Autorización |
| 5 | Cambiar la contraseña de root y pasar a clave SSH | VPS / panel | El operador |
| 6 | Rotar las contraseñas de `auth_user`, `catalog_user` y `ticket_user` | VPS | Autorización + ventana |
| 7 | `.gitignore` para `.env.*` y commit del trabajo en `Develop` | repo | Autorización |
| 8 | Renombrar el compose legacy en el VPS | VPS | Autorización |
| 9 | Arreglar el healthcheck del frontend | repo → VPS | Autorización |
| 10 | Probar el APK en un dispositivo físico | dispositivo | El operador |

## 9. Higiene de esta auditoría

- No se modificó ningún archivo, servicio, contenedor, volumen ni base de datos del VPS.
- El archivo temporal con la contraseña de root se eliminó al terminar (verificado).
- Ningún valor de `.env`, contraseña, token ni connection string aparece en este documento ni se imprimió en pantalla.
- No se hizo git commit ni git push.
