# Fase T — Bloques de la FISEI, aceptación digital, reportes institucionales e imágenes

**Fecha:** 2026-11-05 · **Rama:** `Develop` · **Estado:** sin commit, sin push y sin despliegue.

**Resultado:** lo implementado funciona de extremo a extremo en local, con datos copiados del laboratorio y en un servidor simulado. Quedan requisitos **BLOCKED** porque dependen de un dispositivo Android, de Firebase y SMTP reales, de los logotipos oficiales y de un Ubuntu real. El sistema **no está declarado listo para producción**. La tabla completa está al final.

| Prueba | Resultado |
|---|---|
| Pruebas unitarias e integración | **447/447** (auth 72, catálogo 71, tickets 270, gateway 3, frontend 31) |
| Migración y flujo real sobre copia del laboratorio, en Chrome | **31/31** |
| Simulación de servidor nuevo (instalación, arquitectura, E2E, backup, restauración) | **61/61**, con E2E **105/105** |
| Backups cifrados y recuperación (regresión de la Fase S) | **60/60** |

---

## 1. Diagnóstico inicial

- **Técnicos:** no existía ninguna clasificación por bloque físico.
- **Aceptación:** al validar, el usuario solo generaba un evento en el historial. No había términos, casilla ni constancia independiente.
- **Reportes:** solo existía el reporte individual por técnico. No incluía validación digital, nombre de la solución ni ubicación.
- **Imágenes:** los 7 adjuntos del laboratorio eran PNG sintéticos de 1×1 píxel. Eso explica por qué "no se veían" en el laboratorio, aunque el servidor respondiera 200.

## 2. Problemas encontrados

Problemas reales de la aplicación, ya corregidos:

| Problema | Consecuencia | Corrección |
|---|---|---|
| Comparación de GUID sensible a mayúsculas; SQL Server puede devolverlos en mayúsculas | 403 al dueño legítimo de un ticket o adjunto | `sameId` en la autorización y comprobación de adjuntos sin distinguir mayúsculas |
| `CREATE TRIGGER` no puede ejecutarse dentro del lote de Prisma | Las aceptaciones habrían quedado deshabilitadas (503) | Creación con `EXEC(N'…')`, con prueba propia. Lo detectó el arranque real |
| Enlace a un ticket que no está en la lista del usuario | El administrador no veía nada ni ningún mensaje | Se consulta al backend: abre el ticket o muestra el error |
| Botón de Microsoft bloqueado tras un 502 temporal | No se podía iniciar sesión sin recargar | Reintento de la configuración |
| Gráficos: dona sin dibujar al 100 %, eje Y con números repetidos | Datos mal representados | `chartMath.ts`, con pruebas |
| Período mostrado con un día menos en Ecuador | Fechas incorrectas | El día de calendario ya no se convierte a hora local |
| Impresión: dos diálogos, ventanas adicionales, palabras y tablas partidas | PDF con aspecto defectuoso | Impresión en marco oculto y columnas de ancho fijo |

Errores de las propias pruebas, que no afectaban a la aplicación: `docker kill` no activa la política de reinicio, `compose stop mssql` detiene también a los servicios dependientes, y una simulación huérfana se solapó con otra y produjo un resultado falso de "10 fallos", que se descartó. Se corrigieron y se repitió con una sola simulación.

**Dirección de diseño de los reportes:** se probó un rediseño, pero el usuario pidió conservar el formato que tenía en el VPS, añadiendo solo lo nuevo. El rediseño se retiró. Los cambios de la pantalla **Bloques** (solo asignar) y **Reportes** (una sola pantalla) también son decisiones suyas.

## 3. Arquitectura modificada

- **auth-service:** columna `fisei_block` en `users`, filtros en `GET /technicians` y `PATCH /technicians/:id/block` solo para administradores.
- **ticket-service:** tablas `acceptance_terms` y `solution_acceptances`, triggers de inmutabilidad, y rutas `GET /acceptance-terms`, `GET /:id/acceptances` y `GET /admin/reports/block`. `user-accept` y `user-reject` exigen casilla y versión de términos.
- **frontend:** módulo único de documentos imprimibles, impresión en marco oculto, formulario único de Reportes y modal de revisión de la solución.
- **Bases de datos:** no se añadió ninguna dependencia de PostgreSQL; se sigue usando solo SQL Server.

### Cambio en el inicio de sesión de Microsoft (aprobado)

Antes de recibir el documento de esta fase se añadió una cookie `state` a OAuth (`auth-service/src/security/oauthState.ts`).

- **Justificación técnica:** es la protección estándar contra la falsificación de solicitudes en el flujo de login. Sin ella, un tercero podría completar el callback con un código suyo.
- **Relación con la instrucción:** el documento pide no modificar el flujo SSO salvo justificación comprobable, así que se sometió a decisión.
- **Decisión:** el usuario indicó mantener la protección. No se tocaron credenciales ni variables de Azure, y no se introdujo ningún login simulado.

## 4. Archivos creados

| Área | Archivos |
|---|---|
| Bloques | `auth-service/tests/technicianBlocks.test.ts`, `frontend/src/pages/AdminBloques.tsx` |
| Aceptación | `ticket-service/src/domain/acceptanceTerms.ts`, `ticket-service/src/services/acceptanceService.ts`, `ticket-service/tests/digitalAcceptance.test.ts`, `frontend/src/components/SolutionAcceptanceModal.tsx` |
| Reportes | `ticket-service/src/services/blockReportService.ts`, `ticket-service/tests/blockReport.test.ts`, `frontend/src/lib/institutionalReport.ts`, `frontend/src/components/reports/ReportUi.tsx`, `frontend/src/components/reports/BlockReportView.tsx`, `frontend/tests/institutionalReport.test.ts` |
| Gráficos y login | `frontend/src/components/charts/chartMath.ts`, `frontend/src/lib/authConfig.ts`, `frontend/tests/chartMath.test.ts`, `frontend/tests/authConfig.test.ts`, `auth-service/src/security/oauthState.ts` |
| Pruebas E2E | `scripts/testing/browser-ui-check.mjs`, `scripts/testing/lab-copy-migration-test.sh` |
| Arquitectura del servidor | `*/src/health/readiness.ts`, `scripts/operations/server-health.sh`, `docs/installation/REQUISITOS_NUEVO_SERVIDOR.md`, `CONFIGURACION_RED.md`, `CONFIGURACION_NGINX.md`, `CONFIGURACION_SQL_SERVER.md`, `SEGURIDAD_SERVIDOR.md`, `RECUPERACION_SERVIDOR.md`, `docs/architecture/ARQUITECTURA_NUEVO_SERVIDOR.md`, `docs/operations/MONITOREO_SERVIDOR.md` |

## 5. Archivos modificados

| Área | Archivos |
|---|---|
| Esquemas | `auth-service/prisma/schema.prisma` y `schema.mssql.prisma`; `ticket-service/prisma/schema.prisma` y `schema.mssql.prisma` |
| auth-service | `src/routes/authRoutes.ts`, `src/domain/enums.ts` |
| ticket-service | `src/routes/assignmentRoutes.ts`, `adminRoutes.ts`, `ticketRoutes.ts`; `src/services/areaService.ts`, `authClient.ts`, `technicianReportService.ts`; `src/index.ts`; `tests/uploadAndLifecycle.test.ts`, `ticketAttachmentServe.test.ts` |
| frontend | `src/pages/AdminReporteTecnicos.tsx`, `MisTickets.tsx`, `MisTicketsAceptados.tsx`, `Login.tsx`; `src/components/TicketHistoryModal.tsx`, `Layout.tsx`, `charts/*`; `src/App.tsx` |
| Operación | `scripts/operations/manage-user.sh`, `scripts/install-server.sh`, `scripts/lib/common.sh`, `scripts/backup-mssql.sh`, `restore-mssql.sh`, `backup/restore-drill.sh`, `deploy/server/compose.yaml`, `deploy/nginx/servicedesk.conf.template`, `.env.example` |
| Pruebas | `scripts/testing/smoke-e2e.mjs`, `new-server-simulation.sh` |

`uploadAndLifecycle.test.ts` se adaptó al contrato nuevo (casilla y términos) conservando sus comprobaciones. No se eliminó ninguna prueba para ocultar un error.

## 6. Cambios en las tres bases SQL Server

Todos son aditivos. Se aplican con `prisma db push` sin pérdida de datos.

| Base | Cambio |
|---|---|
| `auth_db` | Columna `users.fisei_block` (`NVARCHAR(16)`, nula). **Ningún técnico se clasifica automáticamente.** |
| `catalog_db` | Sin cambios. |
| `ticket_db` | Tabla `acceptance_terms` (versión, título, texto, SHA-256). Tabla `solution_acceptances` (constancias independientes, no un booleano). Triggers `INSTEAD OF UPDATE, DELETE` en ambas, que rechazan cambios incluso como `sa`. |

**Probado sobre una copia del laboratorio:** los conteos de las 11 tablas coinciden, no se crearon constancias para tickets antiguos, los 7 adjuntos históricos se siguen sirviendo y el laboratorio de origen no cambió.

## 7. Funcionamiento de los bloques

- El administrador asigna cada técnico en la pantalla **Bloques**, que solo sirve para eso: Bloque 1, Bloque 2 o Sin bloque, con un filtro.
- DTIC no aparece ahí. Si se intenta asignarle un bloque por la API, responde 409.
- El bloque es una clasificación administrativa, no un rol, y **no da ni quita acceso a tickets**: el acceso sigue dependiendo del área y la asignación.

## 8. Funcionamiento de la aceptación digital

1. El técnico registra la solución y el ticket pasa a `pendiente_validacion`. El usuario recibe un aviso.
2. El usuario abre **Revisar y validar la solución** y ve el problema, el trabajo, la solución, las imágenes, el historial y los términos.
3. La casilla es obligatoria. Sin ella, el botón de aceptar está deshabilitado y la API responde 400.
4. **Aceptar:** se guarda una constancia con código único (`VD-AAAAMMDD-XXXXXXXX`), datos del usuario, fecha y hora, versión y SHA-256 de los términos, solución y técnico. El ticket pasa a `cerrado`.
5. **Rechazar:** el motivo es obligatorio. El ticket vuelve a `en_proceso`, se avisa al técnico y queda en el historial.
6. **Vuelve a empezar:** el técnico coloca otra solución y el usuario decide de nuevo. El ciclo se repite las veces necesarias y nunca sobrescribe decisiones anteriores.

**Quién decide:** solo el usuario que creó el ticket. Es la regla confirmada por el responsable del proyecto. Este ciclo completo (rechazo, nueva solución y aceptación) se recorrió en Chrome, y SQL Server conservó las dos decisiones.

**Garantías probadas:** solo decide el dueño autenticado (técnico, DTIC, administrador u otro usuario reciben 403). Una doble aceptación simultánea crea una sola constancia. Si cambió la versión de los términos responde 409. No existe ninguna ruta para modificar o borrar constancias. Si el texto de una versión publicada cambia, las aceptaciones se deshabilitan.

Es una **constancia de aceptación digital**, no una firma electrónica certificada, y el sistema lo indica así. **El texto de los términos v1.0 no ha sido aprobado por la institución.**

## 9. Ejemplo de reporte generado

Pantalla **Reportes**, con un único formulario: con bloque elegido se genera el reporte del bloque; sin bloque y con técnico, su reporte individual. Extracto del PDF con datos ficticios marcados como DEMO:

```
UNIVERSIDAD TÉCNICA DE AMBATO                         REPORTE GENERAL · BLOQUE 1
Facultad de Ingeniería en Sistemas, Electrónica e Industrial

Total de técnicos del bloque 4 · Tickets atendidos 9 · Cerrados 5
Pendientes de aceptación 1 · Rechazados por el usuario 2 · En proceso 3

DEMO Andrea Vaca
Número       Ubicación / laboratorio  Solución utilizada                       Estado
TK-DEMO-001  Laboratorio 1            Reemplazo del cable HDMI del proyector   Cerrado

VALIDACIÓN DIGITAL DEL USUARIO                         ACEPTADO DIGITALMENTE
Nombre: DEMO Docente Luis Cruz · Código: VD-DEMO-0001 · Fecha: 08/10/2026 11:00:00
Técnico responsable: DEMO Andrea Vaca · Versión de los términos: 1.0
```

Sin registro se muestra `PENDIENTE DE VALIDACIÓN DEL USUARIO` o el estado real, sin inventar datos. Un rechazo muestra el motivo, la fecha y el nombre. Los tickets cerrados antes de esta fase salen como `CERRADO SIN CONSTANCIA DIGITAL`.

## 10. Solución aplicada a las imágenes

- **Causa de que "no se vieran" en el laboratorio:** los adjuntos eran sintéticos de 1×1.
- **Fallos reales corregidos:** los GUID en mayúsculas producían 403, y los enlaces a tickets fuera de la lista no hacían nada.
- **Comprobado en Chrome real con una foto de 3840×2400:** el usuario, el técnico y el administrador la ven decodificada, la miniatura amplía en el lightbox y el archivo descargado es idéntico (SHA-256).
- **Se mantiene:** rutas autenticadas, sin Base64 en JSON, y adjuntos existentes intactos.
- **Android: sin probar**, por falta de dispositivo y porque el APK anterior no es compatible.

## 11. Pruebas realizadas y resultados

Resultados en la tabla inicial. Detalle de lo comprobado:

- **Copia del laboratorio en Chrome (31/31):** migración, cuentas copiadas, adjuntos, aceptación por interfaz, ciclo completo de rechazo por interfaz, administrador y técnico sin poder aceptar por el usuario (403), constancia en SQL Server, reportes impresos sin abrir ventanas, historial del ticket impreso, y técnico sin acceso al reporte (403).
- **Cuadro de impresión real, en Chrome con ventana:** clic real con el ratón en **Imprimir**, sin interceptar nada. Antes y después hay una sola ventana del navegador, y el cuadro aparece flotando sobre la misma pantalla, con la vista previa del reporte. Se comprobó enumerando las ventanas y mirando la captura.
- **Servidor simulado (61/61):** guardas de licencia, imágenes fijadas, volúmenes y redes aisladas, caída y recuperación de SQL Server, reinicio de procesos, nginx con TLS, `/auth/callback`, inmutabilidad, backup, persistencia y restauración.
- **Bloques con varios técnicos:** sin solapamientos, DTIC fuera y técnico de otro bloque → 404.

**Alcance de cada resultado:** la simulación de 61/61 se ejecutó antes de los últimos ajustes visuales del PDF, que solo cambian el frontend. Esos ajustes sí están cubiertos por las 447 pruebas y por la prueba de 31/31. Los filtros de estado y servicio se comprobaron con pruebas de la API, no haciendo clic en Chrome. El cuadro de impresión se comprobó en Chrome; no se ha probado en otros navegadores.

## 12. Pruebas pendientes

- Impresión en navegadores distintos de Chrome.
- Android: imágenes y aceptación en un dispositivo real, con un APK nuevo.
- Entrega real de notificaciones push (Firebase) y de correo (SMTP).
- Instalación en Ubuntu real con systemd, nginx y certbot reales.
- Inicio de sesión de Microsoft en el dominio definitivo.
- Copias externas reales en Backblaze B2.

## 13. Riesgos conocidos

| Riesgo | Detalle |
|---|---|
| **Inestabilidad del equipo de pruebas** | Windows registra reinicios inesperados (17 en 30 días y otro durante esta fase), sin causa determinada. Las bases superaron `DBCC CHECKDB` tras el reinicio del que se comprobó. |
| **Texto de los términos** | La versión 1.0 no ha sido aprobada por la institución. Publicarla la fija: un cambio posterior debe crear una versión nueva. |
| Límites de los filtros de fecha | Se aplican en UTC: un ticket creado cerca de la medianoche de Ecuador puede caer en el día contiguo. |
| Tamaño de los reportes | Máximo 2000 tickets por bloque y 500 por técnico. |
| "Rechazados" | Cuenta los tickets rechazados **al menos una vez**, y el reporte lo indica. |
| Licencia | Developer solo sirve para pruebas; el instalador la bloquea con `SERVER_PURPOSE=produccion`. |
| VPS actual | No se tocó en esta fase. Mantiene los problemas documentados en las fases anteriores. |

## 14. Pasos necesarios para desplegar en el servidor nuevo

1. **Definir antes:** el texto oficial de los términos. El bloque se mantiene sin limitar el acceso a tickets, como indica el documento de la fase, salvo que el responsable decida otra cosa.
2. Colocar los logotipos oficiales en `frontend/public/branding/` (`uta-logo.png`, `fisei-logo.png`) y regenerar el paquete.
3. Copiar el paquete `release/servicedesk-uta-server-<versión>.tar.gz` y verificar su SHA-256.
4. Preparar el servidor según `docs/installation/REQUISITOS_NUEVO_SERVIDOR.md`.
5. Configurar `deploy/server/.env`, sin transferir secretos por canales inseguros. Registrar la Redirect URI del dominio definitivo en Azure.
6. Ensayar con `sudo scripts/install-server.sh --mode clean --dry-run`. Después, según el caso: `--mode clean --generate-secrets` o `--mode restore --from <conjunto>`. La guía es `docs/installation/INSTALACION_SERVIDOR_NUEVO.md`.
7. Verificar con `scripts/operations/server-health.sh` y `smoke-server.sh`, y asignar los técnicos en **Bloques**.
8. Configurar y probar los backups externos.
9. Reconstruir y probar el APK contra el dominio definitivo.

El instalador crea o actualiza las tres bases y las migraciones son reproducibles, comprobado en instalación limpia y en restauración.

---

## Estado de cada requisito

| § | Requisito | Estado | Evidencia o motivo |
|---|---|---|---|
| 2 | Campo de bloque asignado por el administrador | **PASS** | Pruebas y E2E en copia |
| 2 | Sin asignación automática | **PASS** | Copia: ningún técnico clasificado al migrar |
| 2 | DTIC independiente | **PASS** | 409 al asignar; fuera de los reportes |
| 2 | Filtro por bloque en pantallas de administración | **PASS** | Chrome |
| 2 | El bloque no es rol ni da acceso | **PASS** | Pruebas; es lo que indica el documento de la fase |
| 3 | Flujo completo de revisión y términos con casilla | **PASS** | Chrome con foto real |
| 3 | Constancia con todos los datos; ticket `cerrado` | **PASS** | Registro leído en SQL Server |
| 3 | Rechazo con motivo y ciclo repetible sin sobrescribir | **PASS** | Chrome: rechazo, nueva solución y aceptación; dos registros en SQL Server |
| 3 | Solo el dueño puede decidir | **PASS** | 403 a los demás roles |
| 3 | Sin presentarlo como firma certificada | **PASS** | Texto y pruebas |
| 3 | Notificación al usuario y al técnico: registro y envío | **PASS** | Salida de correo y envío push con pruebas |
| 3 | Entrega real de correo y push | **BLOCKED** | Requiere SMTP y Firebase reales |
| 4 | Sección de validación digital en reportes | **PASS** | Chrome y PDF |
| 4 | Sin registro: pendiente, sin inventar datos | **PASS** | Pruebas y copia |
| 5 | Reporte por bloque con filtros, en backend | **PASS** | Pruebas de la API; filtros de estado y servicio solo por API |
| 5 | Contenido: totales, actividades, ubicación, solución, historial, validación | **PASS** | PDF en Chrome |
| 5 | General Bloque 1, Bloque 2 e individual | **PASS** | Bloque 1 en Chrome; Bloque 2 e individual por API y PDF |
| 5 | Técnicos no consultan reportes de administración | **PASS** | 403 |
| 6 | Encabezado institucional | **PASS** | PDF |
| 6 | Logotipos oficiales | **BLOCKED** | No existen en el proyecto; no se inventan |
| 6 | Imágenes de referencia | **BLOCKED** | No se recibieron |
| 7 | Imágenes en web: miniatura, lightbox y errores | **PASS** | Chrome con foto de 3840×2400 |
| 7 | Imágenes en Android | **BLOCKED** | Sin dispositivo y sin APK compatible |
| 7 | Sin Base64 ni rutas públicas; adjuntos conservados | **PASS** | Pruebas y copia |
| 8 | Migraciones SQL Server probadas sobre copia | **PASS** | 31/31 |
| 8 | Aceptaciones como registros independientes | **PASS** | Tabla e inmutabilidad probada incluso como `sa` |
| 9 | Permisos en backend; constancia no modificable | **PASS** | Pruebas y triggers |
| 10 | Pruebas unitarias, integración y E2E, con regresión | **PASS** | 447, 105 y 31 |
| 11 | Instalador y paquete preparados, sin desplegar | **PASS** | Simulación 61/61 |
| 11 | Instalación en Ubuntu real | **BLOCKED** | Sin servidor disponible |
| 12 | Este informe | **PASS** | Este documento |
| — | Login de Microsoft real, sin simulación | **PASS** | Sin login simulado; protección `state` aprobada (§3) |
| — | Solo SQL Server | **PASS** | Sin dependencias de PostgreSQL |
| — | Impresión sin ventanas nuevas | **PASS** | Chrome: sin `window.open` y una sola orden |
| — | Un único cuadro de impresión flotante | **PASS** | Chrome con ventana: clic real, una ventana y captura revisada |

Ningún requisito queda en **FAIL**.
