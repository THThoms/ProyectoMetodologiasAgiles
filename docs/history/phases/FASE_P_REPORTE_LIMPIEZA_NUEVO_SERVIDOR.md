# FASE P — Limpieza, organización y preparación para un servidor nuevo

**Fecha:** 2026-11-04 · **Rama:** `Develop` (sin commit, sin push)
**Alcance:** repositorio local y entornos Docker locales aislados. **El VPS no se tocó** (sin SSH en esta fase; solo peticiones HTTP públicas de lectura).
**Motor:** SQL Server 2022, único. PostgreSQL retirado.

Escrito para: el equipo del proyecto (Tech Lead y docente supervisor). Sin secretos.

---

## 1. Resultado

| Bloque | Estado |
|---|---|
| Repositorio organizado (raíz compacta, historial archivado, PostgreSQL aislado) | ✅ |
| Corrección de seguridad del login simulado, dev-login y cuentas demo (backend + tests) | ✅ |
| Compose de producción nuevo, mssql-init, nginx, systemd, backup, restore, instalador, paquete | ✅ |
| Simulación local de servidor nuevo (limpio + restauración) | ✅ **30/30** |
| E2E funcional sobre la instalación de producción simulada | ✅ **58/58** |
| Tests unitarios | ✅ **301/301** |
| **Servidor nuevo listo para producción** | ⛔ **NO**: bloqueantes B1–B3 (§11) |

## 2. Arquitectura final

Sin cambios funcionales: gateway → auth, catalog y ticket → SQL Server 2022 (3 bases). Novedades del servidor nuevo (`deploy/server/compose.yaml`):
- Redes `data` (interna, sin Internet), `app` y `edge`. SQL Server sin puerto publicado; gateway y frontend solo en `127.0.0.1`.
- SQL Server **sin root** (uid 10001) con un único volumen en `/var/opt/mssql`.
- Edición obligatoria (`MSSQL_PID`), límites de memoria, rotación de logs y healthchecks a `127.0.0.1`.
- `NODE_ENV=production` en todos los servicios, `RUN_SEED=false` y `PRISMA_ACCEPT_DATA_LOSS=false` por defecto.

Detalle: `docs/architecture/ARQUITECTURA_SERVICEDESK.md`.

## 3. Estructura resultante

```text
api-gateway/ auth-service/ catalog-service/ ticket-service/ frontend/
deploy/   server/{compose.yaml,mssql-init/} nginx/ systemd/ README.md
scripts/  install-server.sh backup-mssql.sh restore-mssql.sh build-server-package.sh
          operations/ testing/ lib/ legacy/ init-mssql-lab.{sh,sql} README.md
docs/     architecture/ installation/ operations/ security/ troubleshooting/ history/ CONTEXTO_MAESTRO_SERVICEDESK.md
archive/  postgresql/ (README de advertencia)
backups/  (ignorado)   release/ (ignorado)
.env.example  .gitignore  compose.yaml  docker-compose.prod-mssql.yml  README.md
```

Las carpetas de los microservicios **no se movieron** (romperían Dockerfiles y contextos de build). `docker-compose.prod-mssql.yml` y `scripts/init-mssql-lab.*` siguen en su sitio porque el compose del VPS actual los referencia y la fase prohíbe modificarlo.

## 4. Archivos movidos (40 entradas, registro en `docs/history/MOVIMIENTOS_FASE_P.json`)

| Grupo | Origen → destino |
|---|---|
| 14 reportes de fase (E…O + auditoría P) | raíz → `docs/history/phases/` (nombres conservados; enlaces internos reescritos) |
| Docs de la migración MSSQL | `docs/mssql/{GUIA_OFICIAL_MSSQL,ARQUITECTURA_FINAL,RETIRO_POSTGRESQL}.md` → `docs/history/mssql-migration/` |
| PostgreSQL | `docker-compose.legacy-pg.yml`, 3 `Dockerfile` PG, 3 `schema.pg.legacy.prisma`, `init-multi-db.sh`, `migrate-areas-*.sql` (sintaxis PG), `POSTGRESQL_*.md` → `archive/postgresql/` |
| SQL Server UTA (Fase E, descartado) | `docs/mssql-uta/*`, `.env.uta.example`, `check-uta-mssql.js` → `docs/history/institucional-uta/` |
| Configuración superada | `.env.mssql.example` (consolidado en `.env.example`), `docker-compose.mssql.yml` (sustituido por `compose.yaml`) → `docs/history/config/` |
| Utilidades antiguas | `scripts/init-db.sh`, `verificar_proyecto.bat` → `scripts/legacy/` |

Enlaces Markdown: 51 revisados, 1 roto. Ya lo estaba antes: el reporte J apuntaba al scratchpad de una sesión antigua.

## 5. Archivos eliminados

| Archivo | Justificación |
|---|---|
| `auth-service;C/` | Carpeta **vacía** (0 archivos, incluidos ocultos), sin git ni referencias; creada el 2026-09-12 por un comando mal formado. Nada que comparar por hash ni que respaldar. `rmdir` (solo funciona si está vacía) tras verificar el sistema |
| `scripts/backup-mssql.sh` (versión F/H) | **Sobrescrito por error** al escribir la versión nueva. No estaba en git. Sin impacto operativo: la versión anterior sigue instalada en el VPS (`/usr/local/sbin/servicedesk-backup-mssql.sh`) y la nueva la sustituye funcionalmente, incluido el modo heredado `MSSQL_CONTAINER=sd-mssql` |

No se borró ningún backup, imagen adjunta, volumen del laboratorio ni artefacto Android. `node_modules`, `dist`, `.gradle`, `*.tsbuildinfo` y el APK se identificaron como generados, están ignorados por Git y excluidos del paquete, y **se conservan** en local (el APK es el de Fase O, pendiente de probar en dispositivo).

## 6. Clasificación (resumen de la matriz)

| Clase | Elementos |
|---|---|
| A. Código activo | 5 componentes (`src/`, `prisma/schema*.prisma`, `docker/entrypoint.mssql.sh`, `Dockerfile.mssql` / `Dockerfile`) |
| B. Configuración activa | `compose.yaml`, `docker-compose.prod-mssql.yml` (VPS), `.env.example`, `.gitignore`, `frontend/{capacitor.config.ts,nginx.conf}`, `frontend/android/` |
| C. Documentación vigente | `README.md`, `docs/{architecture,installation,operations,security,troubleshooting}`, `docs/CONTEXTO_MAESTRO_SERVICEDESK.md`, `scripts/README.md`, `deploy/README.md` |
| D. Instalación | `deploy/**`, `scripts/{install-server,backup-mssql,restore-mssql,build-server-package}.sh`, `scripts/operations/`, `scripts/lib/` |
| E. Pruebas | `*/tests/`, `scripts/testing/` |
| F. Histórico | `docs/history/**`, `archive/postgresql/**`, `scripts/legacy/`, `ticket-service/scripts/seedHistoricalTickets.js` (se conserva en su sitio porque `Dockerfile.mssql` copia `scripts/`) |
| G. Duplicado | `schema.prisma` ≡ `schema.mssql.prisma` (idénticos, verificado con `diff`; se mantienen porque el Dockerfile copia el segundo sobre el primero) |
| H. Generado | `node_modules/`, `dist/`, `android/**/build`, `.gradle/`, `*.tsbuildinfo`, `release/` |
| I. Innecesario confirmado | `auth-service;C/` (eliminado) |
| Configuración del asistente | `.claude/settings*.json`: solo listas de permisos. Conservado, excluido del paquete |
| Archivos reales con secretos | `.env` (antiguo, aún con variables `POSTGRES_*` muertas) y `.env.mssql` (lab). **No se movieron ni copiaron**; ahora ignorados por Git |

## 7. Cambios de código (todos compatibles con el VPS actual)

| Archivo | Cambio |
|---|---|
| `auth-service/src/config/env.ts` | `devLoginEnabled` y `microsoftSimulateEnabled` = `false` siempre con `NODE_ENV=production`; opt-in fuera de producción |
| `auth-service/src/routes/authRoutes.ts` | `/microsoft-simulate` → 404 si está deshabilitado; `/config` informa el valor real |
| `auth-service/src/index.ts` | Log de arranque de los mecanismos de login y aviso si se pidieron en producción |
| `auth-service/prisma/seed.ts` | Cuentas demo solo con `SEED_DEMO_USERS=true` y fuera de producción; administrador inicial `INITIAL_ADMIN_*` con política |
| `*/docker/entrypoint.mssql.sh` | `RUN_SEED` y `PRISMA_ACCEPT_DATA_LOSS` (por defecto `true` = comportamiento histórico); `--skip-generate` |
| `frontend/src/pages/Login.tsx` | Si falla la carga de la configuración, no asume que el login simulado existe |
| `auth-service/tests/insecureLoginGuard.test.ts` (nuevo), `tests/setup-env.ts` | 8 tests de bypass bloqueado |
| `.gitignore` | `.env.*`, `**/.env*` (excepto `.env.example`), `release/`, claves y certificados |

## 8. Instalador y paquete

- `scripts/install-server.sh --mode clean|restore [--from DIR] [--generate-secrets] [--dry-run] [--yes] [--replace] [--nginx-tls] [--project] [--test-mode]`. Pasos: preflight → validación del `.env` (CONFIGURADA/VACÍA/AUSENTE, política de contraseñas, `MSSQL_PID` bloqueante) → guardas de modo → build → SQL Server (comprueba la edición real) → datos → servicios (con seed solo en el primer arranque del modo limpio) → healthchecks → smoke → nginx → systemd.
- `scripts/backup-mssql.sh` / `restore-mssql.sh` / `operations/{smoke-server,manage-user,check-backup,alert}.sh`.
- **Paquete:** `release/servicedesk-uta-server-1.0.0-rc1.tar.gz`, 524 KB, 198 archivos.
  SHA-256 `bcd1e82747d14a0e2af86deb2fd6753a4ea8846357b2e17f704967a5bf01e701`, con `MANIFEST.md` y `FILES.txt`.
  Verificado: sin `.env` reales, claves, APK, `node_modules`, backups, historial ni PostgreSQL; los 12 valores secretos de los `.env` locales aparecen 0 veces.

## 9. Pruebas

### 9.1 Regresión (local)

| Prueba | Resultado | Histórico |
|---|---|---|
| auth-service | **34/34** | 26 (+8 de Fase P) |
| catalog-service | **52/52** | 52 |
| ticket-service | **215/215** | 204 en J → 215 en L/M (11 del endpoint de adjuntos) |
| **Total** | **301/301** | 282 (J) → 293 (M/N) → 301 |
| `prisma validate` (`schema.prisma` y `schema.mssql.prisma`) ×3 | ✅ | |
| `prisma generate` ×3 | ✅ | |
| `npm run build` auth/catalog/ticket/gateway | ✅ | |
| Frontend `tsc -b && vite build` | ✅ | |
| `docker compose config` (lab y servidor) | ✅; `MSSQL_PID` vacío bloquea el compose | |

### 9.2 Simulación de servidor nuevo (`scripts/testing/new-server-simulation.sh`)

Instalada **desde el paquete extraído** en un directorio vacío, en proyectos Docker aislados (`sdsimclean`, `sdsimrestore`), con secretos nuevos generados por el instalador y **SQL Server Express Edition (64-bit)**. Resultado final, en una sola pasada: **30/30**.

| Área | Comprobado |
|---|---|
| Paquete | SHA-256, sin `.env` |
| Guardas | Sin `--mode` → rechazado; `MSSQL_PID=Developer` → BLOQUEADO; vacío → BLOQUEADO; reinstalar limpio encima → rechazado; restaurar sin `--replace` → rechazado |
| Modo limpio | 3 bases + 3 logins, servicios 6/6 healthy (frontend incluido), smoke 15/15, sin cuentas demo, filtered index `ms_oid`, RECOVERY SIMPLE ×3 |
| nginx (plantilla real, TLS autofirmado, nginx 1.27) | `nginx -t`, smoke 14/14 por HTTPS, `/uploads/` → 404, HSTS |
| E2E (58 asserts) | Bypass 404, login local ×5, catálogo, ubicaciones, knowledge (staff/403), ticket con 2 imágenes, enrutamiento por área, aceptar, contribuir, reescalar a la otra área, aceptar en destino, resolver con KB nuevo, `pendiente_validacion`, 403/403/400, rechazo → `en_proceso`, KB buscable, resolver con KB existente, aceptación → `resuelto`, 409, historial `CREATED→ACCEPTED→CONTRIBUTED→ESCALATED→ACCEPTED→RESOLVED→USER_REJECTED_RESOLUTION→RESOLVED→USER_ACCEPTED`, imágenes 401/200 (bytes íntegros)/200/200/403, estadísticas, resumen de técnicos, historial admin, EmailOutbox (registros en modo `log`), DeviceToken alta/lista/baja |
| Backup | 3 `.bak` verificados (sin compresión en Express) + uploads (2 imágenes) + SHA-256; `check-backup` OK; sin copia externa → código 3 |
| Persistencia | `restart` y `down`/`up` (sin `-v`): 6/6 healthy, conteos idénticos, imagen servida |
| Modo restauración | Credenciales independientes, conteos = origen (`users=5 services=8 kb=28 tickets=1 events=9 attachments=2 outbox=6 devices=1`), login de un usuario restaurado, imagen restaurada servida con JWT, smoke 12/12 |

Laboratorio existente: migrado a `compose.yaml` con **datos idénticos** (`users=11 services=13 tickets=6 attachments=4` antes y después), 6/6 healthy y smoke del laboratorio 22/22.

### 9.3 Incidencias durante las pruebas (todas resueltas)

1. SQL Server sin root no arrancaba con volúmenes en `data/` y `log/` (*Access is denied*) → volumen único en `/var/opt/mssql`.
2. `docker cp` y GNU tar no aceptan rutas `C:/…` en Git Bash → transferencia por `docker exec … cat` y `tar` por stdin (portable).
3. El curl nativo de Git Bash no escribe en `/dev/null` con `MSYS_NO_PATHCONV` (solo afectaba al arnés).
4. El E2E leía mal la respuesta del EmailOutbox (clave `outbox`): fallo del test, no de la aplicación.
5. `nginx 1.24` (Ubuntu 24.04) no admite `http2 on;` → `listen 443 ssl http2`.

### 9.4 No probado (requiere entorno real o credenciales)

- **Ubuntu 24.04 real:** preflight de SO/root/RAM/disco, instalación de las unidades **systemd**, nginx del host 1.24, certbot y UFW. La simulación usó `--test-mode` en Windows y Docker Desktop.
- **Microsoft SSO real, FCM real y SMTP real:** sin credenciales de prueba. Solo se verificó la configuración (`ssoConfigured=false` y modos `log`/`off`).
- **APK en dispositivo físico** (pendiente desde la Fase O). El bundle del APK es anterior al cambio de `Login.tsx` de esta fase.
- Copia externa por rsync real (sin destino disponible).

## 10. Seguridad

Ver `docs/security/ESTADO_SEGURIDAD_PRE_NUEVO_SERVIDOR.md`. Además de los heredados, la fase detectó y documentó dos **hallazgos nuevos**: **cuentas demo con contraseñas públicas sembradas en cada arranque de producción** y **puertos 8080/3000 del VPS accesibles por HTTP sin TLS**. Ambos quedan corregidos para el servidor nuevo y pendientes en el VPS.

## 11. Bloqueantes y pendientes

| # | Pendiente | Responsable |
|---|---|---|
| B1 | Elegir la edición y licencia de SQL Server (`MSSQL_PID`). Express funcionó en la simulación | Propietario / UTA |
| B2 | Destino de copia externa de backups | Propietario |
| B3 | Backup fresco del VPS para el modo restauración (los automáticos fallan desde el 15-sep) | Operador, con autorización sobre el VPS |
| 4 | Tareas urgentes del VPS (§ final del informe de seguridad) | Operador, con autorización |
| 5 | UI/API de gestión de roles (hoy `manage-user.sh`) | Decisión funcional |
| 6 | Estado final `resuelto` frente a `cerrado` tras `USER_ACCEPTED` | Decisión funcional |
| 7 | Rotulado "Técnicos por bloque" (es nivel·área, no un bloque físico) | Decisión funcional |
| 8 | Probar la instalación en un Ubuntu 24.04 real (systemd, nginx 1.24, certbot) | Operador |
| 9 | Reconstruir el APK para el dominio nuevo y probarlo en un dispositivo | Operador |
| 10 | Commit del trabajo de las fases B–P (nada está en git) | Tech Lead |

## 12. Instalación manual en el otro servidor

`docs/installation/INSTALACION_SERVIDOR_NUEVO.md`, en resumen:

1. Copiar `release/servicedesk-uta-server-1.0.0-rc1.tar.gz` y su `.sha256` → `sha256sum -c`.
2. Preparar Ubuntu 24.04 (actualizar, SSH con clave, UFW 22/80/443) e instalar Docker, nginx, certbot y rsync.
3. `tar -xzf … -C /opt/servicedesk --strip-components=1`
4. `cp .env.example deploy/server/.env` y rellenar dominio, `MSSQL_PID`, admin inicial, SSO/SMTP/FCM y copia externa.
5. `sudo scripts/install-server.sh --mode clean --generate-secrets --dry-run`, y después sin `--dry-run`.
   (Restauración: `--mode restore --from <dir-backup>`.)
6. DNS → `certbot certonly --webroot -w /var/www/certbot -d <dominio>` → `install-server.sh --nginx-tls`.
7. Smoke por el dominio, roles con `manage-user.sh`, prueba en navegador, backup manual y `check-backup.sh`, simulacro de restauración.

**Sin commit. Sin push. VPS sin modificar.**
