# Plan de finalización — ServiceDesk UTA

**Fecha:** 2026-11-15. Estado por fase del plan maestro, con lo hecho en local y lo que depende de recursos externos. Leyenda: PASS · FAIL · BLOCKED · NOT TESTED.

| Fase | Estado | Hecho | Pendiente / bloqueo |
|---|---|---|---|
| 1 Consolidación | PASS | Rama de trabajo `consolidacion/fases-q-r-s-t` (7593bbb) con todos los cambios **sin commitear**; `microservicios` (3cebd1c, pushed el 10-nov) es su versión saneada **sin** estas correcciones; `consolidacion/limpia` idéntica a `microservicios`; `Develop` = 7c5620b. Documentación revisada; `__DR_RESULT__` resuelto con evidencia (DR 60/60) | Commit de los cambios (requiere autorización); decidir si `microservicios` se actualiza con un nuevo saneado |
| 2 Auditoría y seguridad | PASS | `INFORME_FINAL_SEGURIDAD.md`; dependencias actualizadas (nodemailer 10, msal-node 7, react-router 7, vite 7, zod 3.25) con regresión completa | zod 4 (tarea controlada); incidente VPS/GitHub (procedimiento listo, sin ejecutar) |
| 3 Funcionalidad | PASS | Tickets, bloques, DTIC, aceptación digital, reportes e imágenes verificados (558 tests, smoke 48/48, E2E 105/105); nuevos: resolución/asignación condicionadas, `includeInactive` solo admin, recordatorios de validación, worker de correo, etiquetas de estado, caché de revocación 5 s | Logotipos y términos aprobados (institución) |
| 4 Integraciones | BLOCKED | Código y configuración listos; Redirect URI, SMTP, FCM y B2 documentados | Credenciales y pruebas reales |
| 5 Backups | PASS (laboratorio) / BLOCKED (B2) | DR 60/60; análisis de RPO en `INFORME_FINAL_BACKUPS.md` | B2, custodios, decisión de RPO |
| 6 Android | PASS (build) / NOT TESTED (dispositivo) | APK debug versionCode 2 verificado con aapt2 | Dispositivo físico, keystore de release, dominio definitivo |
| 7 Infraestructura | PASS (simulación) / BLOCKED (Ubuntu real) | Simulación 61/61 incluida restauración | VM o servidor Ubuntu 24.04 |
| 8 Instalador | PASS | Modos clean/restore, guardas, secretos, nginx, systemd; paquete **RC6** reproducible | — |
| 9 Pruebas completas | PASS (local) | `INFORME_FINAL_PRUEBAS.md` | Las que exigen recursos externos |
| 10 Preparación final | PASS | Paquete RC6, manuales e informes | — |
| 11 Instalación nueva | BLOCKED | Procedimiento en `docs/installation/MANUAL_INSTALACION_NUEVO_SERVIDOR.md` | Servidor, dominio, licencia, credenciales, autorización |
| 12 Migración y puesta en marcha | BLOCKED | Procedimiento en `docs/operations/MANUAL_RECUPERACION.md` §4 (migración desde el VPS) | Autorización, ventana de corte |

## Orden recomendado de las acciones externas

1. Autorizar el commit de los cambios locales (y opcionalmente un nuevo saneado hacia `microservicios`).
2. Hacer privado el repositorio público y ejecutar el procedimiento del incidente del VPS (`INFORME_FINAL_SEGURIDAD.md` §4).
3. Conseguir servidor Ubuntu 24.04, dominio, licencia de SQL Server, tenant/Redirect URI, SMTP, Firebase, B2.
4. Instalar RC6 en modo limpio para pruebas de aceptación (SQL Server Developer con `SERVER_PURPOSE=pruebas`), probar SSO real web y Android, SMTP, FCM, reportes impresos.
5. Decidir RPO; configurar B2 y custodios; drill de restauración real.
6. Ventana de corte: backup verificado del VPS, `--mode restore` en el servidor definitivo (edición licenciada), validación, cambio de DNS, VPS anterior intacto como rollback.
7. APK de release firmada y pruebas en dispositivo.
