# Fase S — Backups externos cifrados, Restic y recuperación

Escrito para: el responsable del proyecto y quien opere o audite el servidor nuevo.
Fecha: 2026-11-05 · Rama `Develop` · **Sin commit, sin push, VPS anterior sin tocar, ninguna conexión externa.**

## 1. Objetivo

Proteger `auth_db`, `catalog_db`, `ticket_db`, las imágenes adjuntas y la configuración necesaria con copias **cifradas** fuera del servidor. El sistema debe poder reconstruirse completo en otro servidor aunque el original se pierda. Destino previsto: Backblaze B2 (API S3) con Restic. Pruebas: MinIO local.

## 2. Diagnóstico del sistema anterior (Fase P/R)

| Elemento | Estado encontrado | Decisión |
|---|---|---|
| `scripts/backup-mssql.sh` | Correcto: 3 `.bak` con CHECKSUM, VERIFYONLY, SHA-256 e imágenes en `tar.gz`. **Sin cifrado**; copia externa por `rsync` nunca configurada; retención por días; manifest en texto | **Reutilizado y ampliado** (§4). Se retira `rsync`: no cifra, no tiene retención ni deduplicación y nunca se usó |
| `scripts/restore-mssql.sh` | Correcto (MOVE, CHECKDB, remapeo de usuarios) | Reutilizado. Se factorizó el `RESTORE … WITH MOVE` en `sd_restore_database` (lib común) y se admite el formato nuevo |
| `check-backup.sh`, `alert.sh`, `alert@.service` | Correctos | Ampliados: Restic, motivo concreto, webhook, latido |
| systemd | Backup diario + verificación cada 6 h | Se mantienen; se añaden verificación de datos, retención y restore drill |
| Volumen de imágenes | Nombre distinto en cada entorno (`servicedesk_ticket-uploads`, `servicedesk-microservices_mssql-lab-uploads`; en el VPS, `servicedesk-uta_ticket-uploads`) | Se **detecta** del montaje real `/app/uploads` del contenedor; Restic lee el volumen directamente |
| Adjuntos | `file_path` = nombre de archivo; el lab tiene 7 filas y 10 archivos (3 huérfanos) | Se documentan y no se borran |
| MinIO | **Imágenes oficiales retiradas** de Docker Hub y quay.io (2025) | Laboratorio con `bitnamilegacy/minio:2025.4.22` (MinIO RELEASE.2025-04-22, congelada; solo laboratorio) |
| Recovery model | Laboratorio en **FULL** sin backups de log (el log crece sin límite). El servidor nuevo ya usa **SIMPLE** (mssql-init) | Sin cambios en el lab. Riesgo anotado (§11) |

## 3. Arquitectura

```text
SQL Server ─► BACKUP DATABASE ×3 WITH CHECKSUM (sin compresión SQL si hay Restic)
           ─► existe y tamaño > 0 ─► RESTORE VERIFYONLY WITH CHECKSUM ─► SHA-256
           ─► conteos de 13 tablas (antes y después) + 14 relaciones
imágenes   ─► lista SHA-256 de cada archivo (el volumen NO se copia al disco local)
config     ─► .env del servidor, compose, .install-state, nginx, systemd, daemon.json, parámetros SQL
           ─► manifest.json ─► SHA256SUMS ─► .complete
           ─► RESTIC (contenedor restic/restic:0.18.0): comprime, deduplica y cifra (AES-256-CTR + Poly1305)
           ─► S3 por TLS (B2 en producción · MinIO en laboratorio)
           ─► verificación: SHA256SUMS releído del repositorio = local, 3 bases, nº de imágenes
```

Snapshot con rutas fijas: `/servicedesk-backup/` (el conjunto) y `/servicedesk-backup/uploads/` (el volumen real, en solo lectura). Etiquetas: `servicedesk` y `backup-id=<ID>`. Host lógico estable: `RESTIC_SNAPSHOT_HOST`.

## 4. Archivos

**Creados**

| Archivo | Función |
|---|---|
| `scripts/lib/backup.sh` | Carga de `backup.env` sin evaluarlo; `sd_restic`: contenedor fijado, secretos por nombre de variable y archivo de solo lectura, límite de tiempo y limpieza; clasificación de errores; conteos, relaciones y adjuntos (SQL común); latido |
| `scripts/backup/restic-init.sh` | Genera la clave (no la muestra); inicializa (v2) sin reinicializar nunca |
| `scripts/backup/restic-test-connection.sh` | Diagnóstico con el estado de cada variable (nunca su valor) y el motivo exacto |
| `scripts/backup/restic-backup.sh` | Sube un conjunto verificado y verifica el snapshot |
| `scripts/backup/restic-check.sh` | `--quick` (antigüedad), estándar (5 % de los datos), `--full`, `--unlock` |
| `scripts/backup/restic-retention.sh` | 14/8/12 con salvaguardas previas y verificación posterior |
| `scripts/backup/restic-restore.sh` | Restaura **solo archivos** en un directorio nuevo y verifica todo |
| `scripts/backup/restic-keys.sh` | Claves de custodios, verificación, revocación y rotación |
| `scripts/backup/restore-drill.sh` | Restauración de prueba en SQL Server efímero o en la instancia |
| `deploy/backup/backup.env.example` | Plantilla de `/etc/servicedesk/backup.env` |
| `deploy/backup-lab/compose.yaml`, `lab.sh` | MinIO de laboratorio (TLS, red interna, bucket privado, usuario limitado) |
| `deploy/systemd/servicedesk-backup-{verify,retention}.{service,timer}`, `servicedesk-restore-drill.{service,timer}` | Programación nueva |
| `scripts/testing/backup-dr-simulation.sh`, `scripts/testing/dr-validate.mjs` | Simulación completa de la fase y validación funcional del servidor recuperado |
| `docs/operations/BACKUPS_MSSQL.md`, `CONFIGURACION_BACKBLAZE.md`, `CUSTODIA_CLAVE_BACKUPS.md`, `RETENCION_BACKUPS.md`, `ALERTAS_BACKUPS.md`, `RESTAURACION_SERVIDOR_NUEVO.md` | Documentación |

**Modificados**

| Archivo | Cambio |
|---|---|
| `scripts/backup-mssql.sh` | Reescrito sobre la base anterior: ID de ejecución, espacio, `manifest.json`, conteos, imágenes, configuración, Restic, códigos 0/1/3/4, rotación local |
| `scripts/restore-mssql.sh` | `db/` y `uploads/` como directorio; usa `sd_restore_database` |
| `scripts/lib/common.sh` | `SD_QUERY_CONTAINER`, `sd_restore_database`; `die` ya no imprime el código de salida en el mensaje |
| `scripts/operations/check-backup.sh`, `alert.sh` | Formato nuevo, Restic, motivo por código, webhook |
| `deploy/systemd/servicedesk-backup{,-check}.service`, `alert@.service` | `SD_BACKUP_ENV`, `UMask`, descripciones |
| `scripts/install-server.sh` | `/etc/servicedesk/backup.env` (600), imagen de Restic, 5 timers, avisos |
| `scripts/build-server-package.sh` | Archivo `VERSION`; excluye el laboratorio, `*.pass` y `backup.env` |
| `scripts/testing/new-server-simulation.sh` | Ruta `sets/` del formato nuevo |
| `.env.example` | `BACKUP_LOCAL_KEEP`, `BACKUP_SQL_COMPRESSION`, `BACKUP_REQUIRE_OFFSITE`, `DRILL_MODE`, `BACKUP_ALERT_WEBHOOK_URL`; fuera `BACKUP_OFFSITE_RSYNC_TARGET` y retención por días |
| `.gitignore` | `*.pass`, `backup.env`, `backups/` |
| Documentación | `README`, `CONTEXTO_MAESTRO`, `REQUISITOS_SERVIDOR`, `INSTALACION_SERVIDOR_NUEVO`, `CONFIGURACION_PRODUCCION`, `RESTAURACION_Y_ROLLBACK`, `PROBLEMAS_FRECUENTES`, `ESTADO_SEGURIDAD`, `scripts/README`, `deploy/README` |

**Eliminados**

`docs/operations/BACKUPS.md`, sustituido por `BACKUPS_MSSQL.md`. Nunca estuvo en Git.

**Base de datos:** ningún cambio de esquema ni de datos en la aplicación. El laboratorio de origen solo se **leyó** (BACKUP DATABASE); se comprobó al final que sus conteos y su lista de bases no cambiaron.

## 5. Restic

- **Ejecución:** imagen oficial fijada `restic/restic:0.18.0` (`sha256:4cf4a61e…6120`), en un contenedor efímero. Es el mismo binario en el servidor, en la restauración y en las pruebas, y no hay que instalarlo en el host.
- **Secretos:** se pasan como `-e NOMBRE` (el valor nunca está en la línea de comandos) y la clave como archivo montado en solo lectura. El contenedor arranca con `--cap-drop ALL` y solo las capacidades de lectura y escritura de archivos, más `no-new-privileges`.
- **Comprobación previa acotada:** Restic reintenta los errores del backend durante muchos minutos, así que la comprobación previa tiene un límite (90 s por defecto) y elimina el contenedor al agotarlo.
- **Códigos de error:** `E_REPO_PASSWORD`, `E_REPO_CREDENTIALS`, `E_REPO_UNREACHABLE`, `E_REPO_TLS`, `E_REPO_NOT_INIT`, `E_REPO_LOCKED` y otros. Todos verificados provocando cada error (§10).
- **Variables:** `RESTIC_REPOSITORY` (o `B2_S3_ENDPOINT` + `B2_BUCKET` + prefijo), `RESTIC_PASSWORD_FILE`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `B2_REGION` (sin valor inventado), `RESTIC_SNAPSHOT_HOST`, retención y latido. Se exige `https://` (http solo con `RESTIC_ALLOW_HTTP=true` en laboratorio) y permisos 600 en los archivos de secretos.

## 6. MinIO (laboratorio)

Proyecto `sdbackuplab`, aislado:

| Aspecto | Configuración |
|---|---|
| Red | **Interna**: sin salida a Internet, comprobado |
| Puertos | Ninguno publicado |
| Volumen | Propio |
| TLS | CA autofirmada generada para la prueba |
| Bucket | `servicedesk-backups-lab`, privado |
| Usuario | `restic-lab`, con política limitada a ese bucket, como una Application Key de B2 |
| Bucket ajeno | `otro-proyecto`, para probar el aislamiento |
| Credenciales | Generadas en un directorio privado fuera de Git; nunca se muestran |

## 7. Cifrado

- **Cliente:** Restic cifra **antes** de enviar (AES-256-CTR + Poly1305-AES; clave derivada con scrypt).
- **Prueba de cifrado en reposo** sobre el almacenamiento crudo de MinIO:
  - Ninguno de estos textos del backup aparece: el ID del conjunto, `LOCAL_VERIFIED`, `fk_events_without_ticket`, `SQL_Latin1_General_CP1_CI_AS` y la firma PNG `IHDR` (presente en los 10 archivos del volumen).
  - **Control positivo:** un objeto subido en claro **sí** se detecta, lo que demuestra que la búsqueda funciona.
- **Manipulación:** al sobrescribir paquetes del repositorio, `restic check --read-data` lo detecta y la restauración se rechaza (`--verify`).
- **Separación de secretos:** la clave Restic y las credenciales S3 son secretos distintos y viven fuera de `deploy/server/.env` y fuera de Git.

## 8. Retención

`forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --keep-last 1 --group-by host,paths` y `prune` semanal.

Probado con **400 snapshots diarios sintéticos** fechados entre dic-2025 y nov-2026:

| Comprobación | Resultado |
|---|---|
| Snapshots conservados | **400 → 29** |
| Cubiertos los últimos 14 días, 8 semanas y 12 meses | Sí |
| Snapshots de más de 12 meses | 0 |
| Último snapshot conservado | Sí |
| Último snapshot antiguo | No se aplica la retención |
| Último snapshot incompleto | No se aplica la retención |

## 9. systemd y alertas

| Unidad | Programación |
|---|---|
| Backup | Diario 03:15 |
| Verificación | Cada 6 h |
| Retención | Domingo 04:30 |
| Revisión del 5 % de los datos | Domingo 05:30 |
| Restore drill | Día 1 de cada mes, 06:00 |

Todas con `Persistent=true` y `OnFailure=servicedesk-alert@`. `systemd-analyze verify` sin errores y calendarios válidos (Ubuntu 24.04 en contenedor).

Las alertas indican el motivo por código (espacio, VERIFYONLY, checksum, credenciales, repositorio, S3, drill…). Se envían al journal y a un archivo de log, y opcionalmente por correo, webhook y latido externo. No dependen del sistema de backup ni contienen secretos.

## 10. Pruebas

### 10.1 Simulación completa (`scripts/testing/backup-dr-simulation.sh`)

Ejecución final en una sola pasada: **60 OK · 0 fallos**. Origen: el SQL Server Developer y el volumen de imágenes del laboratorio, solo leídos. Destino: MinIO local. Recuperación: proyecto Docker nuevo `sddrsim`, instalado desde el paquete, con SQL Server **Express**.

| Paso | Comprobado (PASS) |
|---|---|
| 1. S3 de laboratorio | TLS, bucket privado, usuario limitado; red interna **sin salida a Internet** (comprobado) |
| 2. Repositorio | Accesible sin inicializar (código 10) → `init` v2 → `init` idempotente → conexión correcta (0) |
| 3. Diagnóstico | Clave Restic incorrecta → `E_REPO_PASSWORD`. Secreto S3 incorrecto, usuario inexistente y bucket ajeno → `E_REPO_CREDENTIALS`. Endpoint inexistente → `E_REPO_UNREACHABLE`. CA no confiable → `E_REPO_TLS`. `http://` → rechazado. Configuración incompleta → rechazada. Sin contenedores huérfanos |
| 4. Backup | Exit 0; 3 × `BACKUP … WITH CHECKSUM` + `RESTORE VERIFYONLY`; SHA-256; `manifest.json` válido y sin secretos ni correos; configuración solo en el repositorio cifrado; `last-status=OK`; `check-backup.sh`; `restic-check` rápido, 5 % y completo |
| 5. Deduplicación | 1.º: 1 447 460 bytes subidos; 2.º: **416 602** (29 %) |
| 6. Cifrado en reposo | 0 coincidencias de 5 marcadores en claro; control positivo detectado |
| 7. Retención | 400 → 29; 14 días, 8 semanas y 12 meses cubiertos; nada de más de 12 meses; salvaguardas de último snapshot antiguo e incompleto |
| 8. Manipulación | `check --read-data` la detecta; la restauración se rechaza |
| 9. Custodia | Clave del custodio añadida; clave del servidor rotada; la anterior revocada; la del custodio sigue funcionando |
| 10. Restore drill | **PASS** en SQL Server efímero aislado: CHECKDB, 13 conteos, 14 relaciones, 10 imágenes con SHA-256; limpieza completa. Drill con datos alterados → **FAIL** con los 2 motivos |
| 11. **Desastre** | Servidor nuevo con **solo** el paquete, las credenciales S3 y la **clave del custodio**. Detalle en §10.1.1 |
| 12. Continuidad | Reinicio del servidor recuperado: datos idénticos. Reinicio de MinIO: el repositorio persiste. El servidor recuperado hace su propio backup cifrado |
| 13. Secretos y origen | Ninguna clave, credencial S3 ni contraseña en logs, estados, informes ni manifest. Laboratorio de origen **intacto** (conteos y lista de bases) |

#### 10.1.1 Detalle del paso 11 (desastre)

| Comprobación | Resultado |
|---|---|
| Snapshot recuperado | Es el último, con `manifest.json` idéntico |
| Configuración restaurada | Íntegra |
| Instalación | En modo restauración, con credenciales nuevas |
| Conteos de las 13 tablas | `users=11 services=13 routing_rules=11 locations=24 knowledge_articles=34 knowledge_keywords=186 tickets=9 ticket_events=24 attachments=7 device_tokens=1 email_outbox=13`, iguales al backup |
| Relaciones | Íntegras |
| Imágenes | 10 |
| Validación funcional por el gateway | Login con contraseña temporal → cambio obligatorio → login; 9 tickets; historial con eventos; 3 imágenes servidas idénticas al origen (SHA-256); 401 sin token |
| Drill en modo instancia | PASS, con las bases principales intactas |
| **RTO medido** | **125 s** (descarga + instalación + restauración), con bases pequeñas de laboratorio |

### 10.2 Otras pruebas

| Prueba | Resultado |
|---|---|
| Tests unitarios (sin cambios en la aplicación) | **372/372 PASS**: auth 57, catalog 67, ticket 242, frontend 6 |
| No regresión: simulación de servidor nuevo de las Fases P/R (`new-server-simulation.sh`, con el formato de backup nuevo) | **37/37 PASS** · E2E **82/82 PASS** |
| `bash -n` en todos los scripts | PASS |
| ShellCheck 0.10 (`-S warning`) | Sin errores. 5 avisos revisados e intencionados |
| `systemd-analyze verify` de las 11 unidades + calendarios | PASS |
| Deduplicación (medida) | Con compresión de SQL Server cada backup subía 2,1 MB (sin deduplicación). Sin compresión SQL y con Restic comprimiendo: 1,4 MB el primero y **0,4 MB** los siguientes. De ahí `BACKUP_SQL_COMPRESSION=auto` |

### 10.3 Incidencias encontradas y corregidas durante las pruebas

1. **Deduplicación casi nula (diseño):** con compresión de SQL Server, el 2.º backup subía el 99 % del 1.º. Se añadió `BACKUP_SQL_COMPRESSION=auto` y la comprobación ahora exige menos de la mitad. Resultado: 29 %.
2. **Restic se quedaba reintentando** durante muchos minutos ante credenciales inválidas, y matar el cliente dejaba el contenedor vivo. Ahora la comprobación previa tiene un límite de tiempo, el contenedor tiene nombre y se elimina, y se reconoce el texto real del error de firma S3.
3. `sd_restic` y `sd_restic_preflight` **reactivaban `set -e`** dentro de la función y anulaban el `set +e` de quien las llamaba. Corregido.
4. `tr | head` con `pipefail` **mataba en silencio** la generación de claves (SIGPIPE). Corregido en todos los puntos.
5. Conflicto de *collation* al leer `sys.databases`. Corregido con `COLLATE DATABASE_DEFAULT`.
6. `die` mostraba el código de salida dentro del mensaje. Corregido.
7. **Errores de mi arnés:**
   - `tar` interpretaba `C:` como un host remoto (faltaba `--force-local`).
   - Algunas comprobaciones daban OK con valores vacíos.
   - Un `\n` literal introducido al editar.
   - El instalador del servidor "nuevo" heredó `SD_ENV_FILE` apuntando al `.env` del laboratorio. Se comprobó que el archivo **no se modificó** (fecha del 13-sep y secretos intactos): el instalador solo genera claves vacías y se detuvo en la validación. Además, el **instalador ahora se niega** a usar un `SD_ENV_FILE` heredado del entorno.
8. Dos órdenes de limpieza con `rm` dentro de un contenedor de laboratorio fueron bloqueadas por la protección del entorno de trabajo. Se reescribieron sin borrados.

## 11. Riesgos pendientes

1. **Backblaze B2 real: NOT TESTED.** No se ha creado el bucket ni la Application Key, y no se ha hecho ninguna conexión. **Los backups externos NO están activos.**
2. **Ubuntu real (systemd, permisos 600/700 sobre ext4, `flock`, volumen montado en el contenedor de Restic): NOT TESTED.** Las pruebas corrieron en Windows con Docker Desktop: las unidades se validaron con `systemd-analyze`, pero no se ejecutaron en un systemd real.
3. **Custodia:** la clave solo es segura si los dos custodios existen y la guardan fuera del servidor. Están por designar.
4. **Atacante con root en el servidor:** tiene la Application Key y podría borrar el bucket. Mitigación: regla de versiones de B2 de 30 días y latido externo. Mejora futura: *Object Lock* o una clave sin permiso de borrado.
5. **RPO de 24 h** (backup diario, recovery SIMPLE). El laboratorio está en FULL sin backups de log: el log crece. No se tocó.
6. **Imagen de MinIO congelada** (solo laboratorio). La de Restic está fijada por versión; para producción se recomienda fijarla también por *digest*.
7. **Restore drill `ephemeral`:** necesita unos 2 GB de RAM libres durante unos minutos; si no los hay, usar `DRILL_MODE=instance`.
8. Cada drill mensual descarga el snapshot completo de B2: revisar el coste de descarga.
9. **VPS anterior:** sus backups siguen rotos desde el 15-sep-2026 (no se tocó, por regla).

## 12. Pendiente para conectar Backblaze

[CONFIGURACION_BACKBLAZE.md](../../operations/CONFIGURACION_BACKBLAZE.md):

1. Bucket privado.
2. Región y endpoint exactos.
3. Regla de versiones de 30 días.
4. Application Key limitada al bucket (Read and Write).
5. `/etc/servicedesk/backup.env`.
6. `restic-init.sh --generate-password` y custodia ([CUSTODIA_CLAVE_BACKUPS.md](../../operations/CUSTODIA_CLAVE_BACKUPS.md)).
7. `restic-test-connection.sh` → `restic-init.sh` → test → 0.
8. Primer backup y `restic-check.sh --full`.
9. `restore-drill.sh` → PASS.
10. Verificar la clave de cada custodio.

Solo después de los pasos 8-10 pueden declararse **activos** los backups externos.

## 13. Estado

| Criterio de aceptación | Estado |
|---|---|
| Backup de `auth_db`, `catalog_db`, `ticket_db` | PASS |
| Backup de las imágenes | PASS |
| `RESTORE VERIFYONLY` | PASS |
| SHA-256 | PASS |
| `manifest.json` | PASS |
| Restic configurado | PASS |
| Cifrado comprobado | PASS |
| MinIO funcional | PASS |
| Compatibilidad S3 | PASS |
| Retención diaria, semanal y mensual | PASS |
| systemd preparado | PASS (`systemd-analyze`) · NOT TESTED en un systemd real |
| Alertas preparadas | PASS (códigos probados) · NOT TESTED el envío real por correo o webhook |
| Restore drill completo | PASS |
| Comparación de conteos | PASS |
| Relaciones verificadas | PASS |
| Imágenes recuperadas | PASS |
| Restauración aislada en otro entorno | PASS |
| Documentación | PASS |
| Claves fuera de Git | PASS |
| Ninguna conexión externa | PASS |
| VPS anterior intacto | PASS (no se accedió) |
| **Backblaze B2 real** | **NOT TESTED / BLOCKED**: sin bucket, Application Key ni custodios |
| Ubuntu real | NOT TESTED |

**FASE S = COMPLETADA en el laboratorio.** La cadena completa (backup → cifrado → S3 → retención → restore drill → reconstrucción de las 3 bases, las imágenes y la configuración en otro entorno, con la clave del custodio) está probada de punta a punta.

**Los backups externos NO están activos:** no se ha configurado ni verificado un repositorio B2 real (§12). **El servidor nuevo todavía no está listo para producción.**

Sin commit. Sin push. VPS anterior sin tocar. Ninguna conexión con Backblaze.
