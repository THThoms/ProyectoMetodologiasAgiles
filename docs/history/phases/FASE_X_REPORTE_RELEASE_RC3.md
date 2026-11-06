# Fase X — Preparación segura para push y release RC3

**Fecha:** 2026-11-05. **Sin push, sin commits nuevos, sin reescritura de historial y sin tocar el VPS.**

> **Nota:** este reporte describe la primera versión del RC3. El paquete definitivo y su SHA-256 están en `FASE_X_REPORTE_FINAL_RC3.md`.

**Documento interno.** No contiene valores secretos, pero describe hallazgos de seguridad. No debe distribuirse, y no forma parte del paquete RC3.

## Resumen

| Pregunta | Respuesta |
|---|---|
| ¿RC3 listo para instalar en un servidor de pruebas? | **Sí.** Instalación limpia, persistencia y restauración probadas desde el propio paquete. |
| ¿Listo para producción? | **No.** Faltan los bloqueantes de la sección 9. |
| ¿Se puede hacer push ya? | **No se recomienda** hasta poner el repositorio en privado y cerrar lo urgente del VPS. |
| ¿Hay secretos reales en lo ya público? | **Ninguno reconocible como de producción**, salvo las 9 contraseñas demo. Son graves si esas cuentas siguen activas en el VPS. |

---

## 1. Repositorio y commits

| Dato | Valor |
|---|---|
| Rama actual | `consolidacion/fases-q-r-s-t`, sin rama remota |
| `Develop` | `7c5620b`, igual que `origin/Develop` |
| Remoto `origin` | GitHub, **público**. Creado en 2026-04, último push en 2026-09-06 |
| Forks y clones | 0 forks. 3 clones (3 únicos) en la ventana de tráfico de GitHub (14 días) |
| Árbol de trabajo | 16 archivos sin confirmar: los de esta fase (sección 6), este reporte incluido |

| Hash | Commit |
|---|---|
| `2677287` | `chore(repo): archivar PostgreSQL y retirar archivos obsoletos` |
| `360ef4d` | `feat(security): reforzar autenticacion y autorizacion por areas` |
| `e0c5bdf` | `feat(tickets): agregar aceptacion digital y reportes por bloque` |
| `c05ddf5` | `feat(mobile): agregar proyecto Android con Capacitor` |
| `795a596` | `feat(backups): implementar respaldos cifrados y recuperacion MSSQL` |
| `b755adf` | `feat(deploy): preparar arquitectura e instalador del nuevo servidor` |
| `3debdca` | `docs: documentar instalacion, operacion e historial de fases` |
| `d2c8e7d` | `docs(security): agregar auditoria del VPS anterior` |
| `ddac5a1` | `docs: agregar reporte de consolidacion de fases` |

### Cómo poner el repositorio en privado (manual)

1. Abre el repositorio en GitHub con la cuenta propietaria.
2. Ve a **Settings → General**, baja hasta **Danger Zone**.
3. Pulsa **Change visibility → Change to private** y confirma escribiendo el nombre del repositorio.
4. Comprueba desde una ventana de incógnito que la URL ya no abre.

**Esto no borra lo ya descargado.** Quien lo clonó mientras era público conserva una copia completa, así que privatizar no sustituye a la rotación.

---

## 2. Auditoría de todo el historial

**Alcance:** todas las referencias: 38 commits y 972 archivos históricos (blobs), incluidas las remotas y las referencias locales de herramientas (`refs/agents`, `refs/codex`).

**Métodos:** Gitleaks v8.24.3 con `--redact`, un escáner propio por categoría y una comparación por igualdad con los 10 a 13 valores sensibles de los `.env` locales. Ningún valor se imprimió ni se guardó.

**Gitleaks:** 3 coincidencias, todas locales y ninguna real.

| Regla | Archivo | Commit | Valoración |
|---|---|---|---|
| `generic-api-key` (2) | `README.md:121` | `40d4e89` | Texto de ejemplo, en una referencia local |
| `generic-api-key` | `scripts/testing/backup-dr-simulation.sh:91` | `795a596` | Secreto incorrecto a propósito, para probar el rechazo |

### No se encontró en ningún commit

Claves privadas, service accounts de Firebase, claves de API de Google, JWT literales, secretos de Microsoft, contraseñas SMTP reales, claves Restic, credenciales B2 reales ni contraseñas SSH.

**Límite de esta comprobación:** las contraseñas de SQL Server del VPS y la de root no existen localmente, así que no se pudieron comparar por igualdad. Según la Fase N y la Fase P se expusieron en una salida de herramienta y en un chat, no en Git, y la búsqueda por patrón no halló ninguna en el historial.

### Hallazgos en lo ya público (`origin/Develop`)

| Categoría | Archivo | Primer commit | Detalle | Acción |
|---|---|---|---|---|
| **Contraseñas demo** | `auth-service/prisma/seed.ts` | `1b1c797` | 9 valores, uno de cuenta administradora | **Desactivar las cuentas en el VPS** |
| **Contraseñas demo** | `README.md` | `1b1c797` | 9 valores; ya no están en la punta de la rama | Igual |
| **Contraseñas demo** | `frontend/src/pages/Login.tsx` | `1b1c797` | 3 valores; ya no están en la punta | Igual |
| **Contraseña demo** | `.claude/settings.json` | `07fb867` | 1 valor en una regla de permisos; sigue en la punta | Retirar el archivo del control de versiones |
| Datos personales | `auth-service/prisma/seed.ts` | `1b1c797` | 16 correos, 3 con formato de cuenta real; nombres de personas | Valorar saneamiento |
| Falso positivo | `passwordSecurity.ts` y su prueba | `e1a14b3` | La lista de contraseñas **prohibidas** incluye una igual a una demo | Ninguna |
| Marcadores | `.env.example` | `4328f45` | Valores de ejemplo; `b755adf` los elimina | Ninguna |
| Marcador | `README.md` (`JWT_SECRET`) | `5b51010` | Texto legible de ejemplo, distinto del local | Comprobar que no se usara en el VPS |
| Marcadores | `*/tests/setup-env.ts` | `e1a14b3`, `c7d1fa6` | Credenciales ficticias de prueba | Ninguna |

### Hallazgos solo locales (commits aún sin subir)

| Categoría | Archivo | Commit | Detalle | Acción |
|---|---|---|---|---|
| Host y huella SSH del VPS | `docs/history/phases/FASE_P_AUDITORIA_VPS_Y_LOCAL.md` | `d2c8e7d` | Nombre de host y huella de la clave | Sección 3 |
| Host del VPS | `CONTEXTO_MAESTRO` y `FASE_G`, `K`, `M`, `N` | `3debdca` | Nombre de host | Sanear antes de un push público |
| Contraseñas demo | `docs/history/mssql-migration/GUIA_OFICIAL_MSSQL.md` | `3debdca` | 4 valores | Sanear antes de un push público |
| Patrón de contraseña demo | `docs/operations/GESTION_USUARIOS.md` | `3debdca` | 1 valor; corregido sin confirmar | Incluir en el próximo commit |
| Marcadores de laboratorio | `docs/history/config/env.mssql.example` | `3debdca` | Valores tipo "cambiar" | Ninguna |
| Valores de prueba | `new-server-simulation.sh`, `backup-dr-simulation.sh`, `deploy/backup-lab/lab.sh` | `b755adf`, `795a596` | Ficticios o del laboratorio S3 | Ninguna |
| **`.env.mssql` real del laboratorio** | `refs/agents/…` | `40d4e89`, `dbf3dba` | 5 valores reales del laboratorio, en el `.env.mssql` guardado en esos checkpoints | Borrar esas referencias (requiere autorización) |
| **IP del VPS** | 15 documentos antiguos en `refs/agents/…` | `40d4e89` | Solo en esas referencias locales | Igual |

**Importante:** `refs/agents` y `refs/codex` no se suben con un push normal de rama, pero **sí con `git push --mirror`**. No debe usarse ese comando en este repositorio.

### Qué necesita rotación y qué saneamiento

| Elemento | ¿Rotar? | Motivo |
|---|---|---|
| 9 contraseñas demo | **Sí, urgente** | Públicas desde al menos 2026-09, con cuenta administradora |
| Contraseñas SQL Server del VPS (`auth_user`, `catalog_user`, `ticket_user`) | **Sí, urgente** | Expuestas en la Fase N y sin rotar en la auditoría del 04/11 |
| Contraseña de root del VPS | **Sí, urgente** | Compartida en un chat |
| `JWT_SECRET` del VPS | **Sí, por precaución** | Sin indicio de exposición, pero su rotación cierra las sesiones emitidas durante el periodo vulnerable |
| Valores de `.env.mssql` del laboratorio | No, salvo que se reutilicen | Solo locales y de laboratorio |
| Credenciales del servidor nuevo | No aplica | El instalador genera valores nuevos e independientes |

| Historial | ¿Sanear? | Recomendación |
|---|---|---|
| Commits locales sin subir (host, huella, demo en documentos) | **Sí, antes de un push público** | Fácil: no se ha publicado. Necesita autorización porque reescribe commits |
| Lo ya público en `origin/Develop` | Opcional | Con la rotación hecha, esos valores no sirven. Reescribirlo requiere `force push` y no alcanza a los clones existentes. Tiene sentido por los datos personales |
| `refs/agents` y `refs/codex` | **Sí** | Borrar las referencias; no afecta a ninguna rama |

---

## 3. Auditoría del commit `d2c8e7d`

Contiene `docs/security/ESTADO_SEGURIDAD_PRE_NUEVO_SERVIDOR.md` y `docs/history/phases/FASE_P_AUDITORIA_VPS_Y_LOCAL.md`. No se borró ni se editó nada de este commit: es evidencia.

| Tipo de información | Presente | Sensibilidad |
|---|---|---|
| Direcciones IP | Sustituida por `<IP_VPS>`; **el dominio sí aparece** | Media |
| Nombre de host del proveedor y huella SSH | Sí | Media |
| Puertos | Gateway y frontend accesibles sin TLS; estado del 1433 | **Alta**, combinado con lo demás |
| Configuración de seguridad | Acceso SSH por contraseña de root, reglas del firewall sorteadas por Docker, vencimiento del certificado | **Alta** |
| Rutas internas | Directorio de la aplicación, scripts en `/usr/local/sbin`, `.env` y sus copias, carpeta de backups | Media |
| Vulnerabilidades sin corregir | Login simulado activo, cuentas demo, backups rotos desde septiembre, credenciales sin rotar | **Crítica** |
| Credenciales directas | **Ninguna.** Solo se indica qué existe y qué está sin rotar | — |
| Referencias indirectas | Nombres de contenedores y usuarios SQL; método de comparación por hash | Baja |

**Recomendación:**

- **Fuera de lo distribuible:** ambos documentos. Ya no están en RC3.
- **Fuera de cualquier repositorio público:** ambos, mientras el VPS siga sin corregir. Juntos forman una guía de ataque contra un servidor activo.
- **Dónde conservarlos:** en un repositorio privado o un almacén interno de acceso restringido.
- **Otros documentos** con parte de esta información: `CONTEXTO_MAESTRO_SERVICEDESK.md` y los reportes de las Fases P y R.

---

## 4. Producción anterior

Sin conexión al VPS en esta fase. **El último estado conocido es del 2026-11-04;** puede haber cambiado.

| Tema | Corregido en local y RC3 | Pendiente en el VPS |
|---|---|---|
| Login simulado | Bloqueado en código; 404 comprobado | **Desactivar.** Revisar además sus usos en `auth_logs` |
| Cuentas demo | RC3 no las contiene; la simulación confirma que no existen | **Desactivar o cambiar las contraseñas.** Desplegar código no las borra |
| Credenciales SQL Server | El instalador genera otras, independientes | **Rotar** |
| Contraseña de root y SSH | El instalador prepara el acceso por clave | **Rotar** y pasar a clave SSH |
| Puertos 8080 y 3000 | Solo en `127.0.0.1` | **Restringir** |
| Backups diarios | Corregidos y probados | **Reparar.** Sin copias desde el 15-sep según la auditoría |
| Compose de PostgreSQL residual | Fuera del paquete | **Renombrar** |

**Prioridad recomendada:** primero un backup, luego el login simulado y las cuentas demo, después la rotación de credenciales. Ninguna de estas acciones se ha ejecutado.

---

## 5. Paquete RC3

| Dato | Valor |
|---|---|
| Archivo | `release/servicedesk-uta-server-1.0.0-rc3.tar.gz` |
| **SHA-256** | `f1c1441763df67141d62d92799b3bd49811f1a131465006e6113c9f076f8fbcd` |
| Tamaño | 582 008 bytes |
| Archivos declarados | 225 (lista en `FILES.txt`) |
| Commit base | `ddac5a1` **más 15 archivos sin confirmar**, indicado en el manifiesto |

**Incluye:** los 3 microservicios, gateway, frontend, Dockerfiles, Compose MSSQL, instalador, scripts operativos y de backup, nginx, 11 unidades systemd y documentación de instalación, operación, arquitectura y solución de problemas.

**Excluye, con guardas que abortan el empaquetado si reaparece:**

| Categoría | Archivos |
|---|---|
| Secretos | `.env` reales, claves, keystores, `google-services.json` |
| Compilados y dependencias | `node_modules`, `dist`, APK y proyecto Android |
| Datos | Backups, uploads |
| PostgreSQL | `archive/`, compose y esquemas heredados |
| Auditorías internas | `docs/security/`, `docs/history/`, `CONTEXTO_MAESTRO`, `README.md` del repositorio |
| Laboratorio | `auth-service/prisma/seed.demo.ts`, `seedHistoricalTickets.js`, `init-mssql-lab.*`, `deploy/backup-lab/` |
| Pruebas y herramientas | Todas las carpetas `tests/`, simulaciones, comprobación en navegador, `scripts/build-server-package.sh`, `scripts/README.md`, `frontend/scripts/`, `capacitor.config.ts` |

**Se conserva a propósito:** `scripts/testing/smoke-e2e.mjs` (prueba opcional sin credenciales reales) y `ticket-service/scripts/LEGACY_README.md`, porque el Dockerfile copia esa carpeta. Ese README menciona PostgreSQL solo para indicar que no forma parte del runtime.

---

## 6. Correcciones realizadas (sin confirmar)

| Archivo | Cambio |
|---|---|
| `auth-service/prisma/seed.ts` | Ya no contiene cuentas ni contraseñas; las carga de `seed.demo.ts` solo si existe |
| `auth-service/prisma/seed.demo.ts` (nuevo) | Cuentas del laboratorio. No va en el paquete. El laboratorio se comporta igual |
| `auth-service/tests/seedDemoSeparation.test.ts` (nuevo) | 3 pruebas de esa separación |
| `auth-service/src/services/authService.ts` | Comentario sin nombres de personas |
| `docs/installation/SEGURIDAD_SERVIDOR.md` | Quitado el enlace a la auditoría |
| `docs/installation/INSTALACION_SERVIDOR_NUEVO.md` | Quitados el estado de los backups y las rutas del VPS; ahora usa marcadores |
| `docs/installation/CONFIGURACION_RED.md`, `CONFIGURACION_PRODUCCION.md`, `REQUISITOS_NUEVO_SERVIDOR.md` | Quitados dominio, edición de SQL Server y referencias a la auditoría |
| `docs/architecture/ARQUITECTURA_SERVICEDESK.md` | Quitada la información del VPS |
| `docs/operations/BACKUPS_MSSQL.md`, `GESTION_USUARIOS.md` | Quitados estado del VPS y un patrón de contraseña demo |
| `scripts/build-server-package.sh` | Exclusiones y guardas nuevas |
| `scripts/testing/new-server-simulation.sh`, `lab-copy-migration-test.sh` | Opción `FROM_PACKAGE`: instalar desde un `.tar.gz` existente |

Quedan menciones generales al "VPS anterior" o "servidor anterior" en algunas guías, sin datos que lo identifiquen.

---

## 7. Validación del paquete

Hecha sobre el `.tar.gz` extraído, no sobre el repositorio.

| Comprobación | Resultado |
|---|---|
| SHA-256 coincide con `.sha256`, y no cambió durante las pruebas | OK |
| `FILES.txt` coincide con el contenido; `MANIFEST.md` y `VERSION` correctos | OK |
| 24 componentes obligatorios presentes | OK |
| Gitleaks sobre el paquete | **0 hallazgos** |
| Valores reales de `.env`, claves, JWT, claves de API y service accounts | 0 |
| IP públicas, host y huella del VPS, rutas internas | 0 |
| Nombres y correos de personas del seed | 0 |
| Contraseñas demo | 1 coincidencia: la lista de contraseñas prohibidas de `passwordSecurity.ts`, que no es una credencial |
| Correos restantes | Genéricos o de ejemplo (`no-reply`, `admin`, `e2e.*`, `ana.perez`…) |
| PostgreSQL en runtime | **No.** Solo comentarios en los esquemas; sin dependencias ni servicios |
| 3 esquemas MSSQL | Válidos, proveedor `sqlserver` e iguales a `schema.prisma` |
| Docker Compose | Válido; 8 servicios y 0 referencias a PostgreSQL |
| Instalador | Sintaxis correcta; rechaza ejecutarse sin `--mode`; 23 de 23 scripts ejecutables |
| Enlaces entre documentos | 0 rotos |

## 8. Pruebas

| Prueba | Resultado | Origen |
|---|---|---|
| Unitarias | **450/450** (auth 75, catálogo 71, tickets 270, gateway 3, frontend 31) | Repositorio, tras el último cambio de código |
| `prisma validate` | 3/3 | Esquemas del paquete |
| `prisma generate` | 3/3 en local, y dentro de cada imagen construida desde el paquete | Ambos |
| Builds | 5/5 en local, y 5 imágenes construidas desde el paquete | Ambos |
| Smoke MSSQL | 14/14 directo y 13/13 por nginx con TLS; 14/14 tras restaurar | **RC3** |
| Instalación limpia simulada | **61/61** | **RC3** |
| Prueba funcional de principio a fin | **105/105** | **RC3** |
| Persistencia | Datos e imagen intactos tras `restart` y `down/up` | **RC3** |
| Restauración | Conteos iguales, login, imágenes y administrador correctos | **RC3** |
| Migración y flujo en Chrome con datos copiados | **32/32** | **RC3** |

**Fallo real encontrado por esta prueba:** la primera versión del RC3 no se instalaba. Se excluyó `ticket-service/scripts/` y el Dockerfile copia esa carpeta. Se corrigió excluyendo solo el archivo de datos. Las cifras anteriores son del paquete corregido.

**Alcance:** los scripts que dirigen las simulaciones se ejecutan desde el repositorio, pero todo lo que instalan y construyen sale del `.tar.gz`. Son simulaciones en Docker Desktop sobre Windows, no un Ubuntu real. El laboratorio no se modificó.

## 9. Bloqueantes

**Para producción en el servidor nuevo:**

- Instalación en Ubuntu real con systemd, nginx y certbot reales.
- Licencia de SQL Server (`MSSQL_PID`).
- Bucket B2, Application Key y custodios de la clave de backups.
- Backup reciente del VPS, necesario para migrar (requiere autorización sobre el VPS).
- Redirect URI del dominio definitivo en Azure y prueba real del login de Microsoft.
- Firebase y SMTP reales.
- APK nuevo y prueba en un dispositivo.
- Logotipos oficiales.
- Aprobación institucional del texto de los términos.

**Para el push:** ver la sección siguiente.

**Sobre el paquete:** RC3 se construyó con 15 archivos sin confirmar. Para que sea reproducible desde Git, hay que confirmarlos y regenerarlo, lo que cambiaría el SHA-256 si cambia el commit base.

## 10. Recomendaciones para el push

En este orden:

1. **Poner el repositorio en privado** (sección 1). Lo puede hacer el propietario ahora mismo.
2. **Corregir lo urgente del VPS** (sección 4), incluida la rotación.
3. **Autorizar el commit** de los 16 archivos sin confirmar.
4. **Decidir sobre `d2c8e7d` y los documentos de `3debdca`:**
   - Con el repositorio privado, pueden subirse tal cual.
   - Si va a seguir público, hay que sacarlos del historial local antes del push, lo que requiere reescribir commits locales con autorización.
5. **Retirar `.claude/settings.json` y `.claude/settings.local.json`** del control de versiones.
6. **Hacer push solo de la rama:** `git push -u origin consolidacion/fases-q-r-s-t`, y fusionar con un pull request. **Nunca `--mirror` ni `--all` sin revisar.**
7. **Borrar `refs/agents` y `refs/codex`**, con autorización.
8. **Valorar el saneamiento de lo ya público** por los datos personales, sabiendo que no alcanza a los clones existentes.
