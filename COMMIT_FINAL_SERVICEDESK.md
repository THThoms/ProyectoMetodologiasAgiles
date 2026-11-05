# Commit final — ServiceDesk UTA

Consolidación de las fases Q, R, S y T, con fecha 2026-11-05. **No se hizo push.** El producto no se desplegó, y no se tocaron producción, el VPS ni las bases de datos.

## Rama

- **Rama de trabajo:** `consolidacion/fases-q-r-s-t`, creada desde `Develop` a petición del responsable. No tiene rama remota.
- **`Develop`:** sigue en `7c5620b`, igual que `origin/Develop`.

## Commits

| Hash | Mensaje | Archivos |
|---|---|---|
| `2677287` | `chore(repo): archivar PostgreSQL y retirar archivos obsoletos` | 20 |
| `360ef4d` | `feat(security): reforzar autenticacion y autorizacion por areas` | 52 |
| `e0c5bdf` | `feat(tickets): agregar aceptacion digital y reportes por bloque` | 88 |
| `c05ddf5` | `feat(mobile): agregar proyecto Android con Capacitor` | 57 |
| `795a596` | `feat(backups): implementar respaldos cifrados y recuperacion MSSQL` | 16 |
| `b755adf` | `feat(deploy): preparar arquitectura e instalador del nuevo servidor` | 39 |
| `3debdca` | `docs: documentar instalacion, operacion e historial de fases` | 50 |
| `d2c8e7d` | `docs(security): agregar auditoria del VPS anterior` | 2 |
| (este commit) | `docs: agregar reporte de consolidacion de fases` | 1 |

Antes de este reporte, el total es de 324 archivos, con 30 708 líneas añadidas y 3 635 eliminadas.

La división es por archivo, no por línea. Por eso `360ef4d` incluye el campo de bloque y `e0c5bdf` incluye el aislamiento por áreas: esos cambios comparten archivo con el resto de su commit. Los commits intermedios no están pensados para compilarse por separado; lo verificado es el conjunto.

## Archivos incluidos

| Tema | Dónde está |
|---|---|
| Roles DTIC y Técnicos, seguridad y autorización, Microsoft SSO, sesiones SHA-256 | `360ef4d`, `e0c5bdf` |
| Bloques 1 y 2 | `360ef4d` (campo y asignación), `e0c5bdf` (pantalla y reportes) |
| Aceptación digital y términos versionados | `e0c5bdf` |
| Reportes por técnico y bloque, encabezados institucionales, imágenes | `e0c5bdf` |
| Aplicación Android (sin credenciales) | `c05ddf5` |
| Backups Restic y MinIO | `795a596` |
| Instalador, Docker Compose MSSQL y arquitectura del servidor | `b755adf` |
| Documentación | `3debdca`, `d2c8e7d` |
| Pruebas automatizadas | Junto a cada servicio y en `scripts/testing/` |

También se marcaron como ejecutables los 32 scripts `.sh` y `gradlew`, porque la documentación los invoca directamente en Linux.

## Archivos eliminados del árbol

No se borró nada a mano en este paso. Se confirmaron eliminaciones que ya venían de fases anteriores. Todo sigue accesible en el historial, desde `7c5620b`.

| Archivo | Dónde queda |
|---|---|
| `auth-service`, `catalog-service` y `ticket-service/Dockerfile` | `archive/postgresql/dockerfiles/` |
| `docker-compose.yml` | Sustituido por `compose.yaml`; en el historial |
| `BandejaTickets.tsx`, `PanelTecnico.tsx` | `archive/frontend-legacy/` |
| `scripts/init-multi-db.sh`, `migrate-areas-*.sql` | `archive/postgresql/scripts/` |
| `scripts/init-db.sh`, `verificar_proyecto.bat` | `scripts/legacy/` |
| Pruebas `routingRoutes`, `ticketEscalate`, `ticketLevelRoute` | En el historial |

Esas tres pruebas se retiraron en la Fase R, porque cubrían endpoints por nivel que ya no existen. Ahora esos endpoints responden 410, lo que comprueba `legacyEndpointsGone.test.ts`. No se quitó ninguna prueba para ocultar un error, ni se modificó ninguna durante esta consolidación.

## Archivos excluidos

Quedan fuera por `.gitignore`, y se comprobó que ninguno está en el árbol confirmado:

- `.env`, `.env.mssql` y su copia de seguridad.
- `node_modules/`, `dist/` y cachés de compilación.
- `backups/`.
- `release/`, incluido `servicedesk-uta-server-1.0.0-rc2.tar.gz`, que se conserva como artefacto fuera de Git.
- `google-services.json`, `local.properties` y los artefactos de compilación de Android.

## Ajustes aplicados a documentos antes de confirmar

- La IP del VPS anterior se sustituyó por `<IP_VPS>` en 12 documentos.
- Una contraseña de ejemplo en una URL de `PLAN_CAMBIO_PRODUCCION.md` se sustituyó por `<CONTRASEÑA>`.

No se editó ningún archivo de código, de prueba o de configuración en este paso.

## Pruebas ejecutadas

| Servicio | Resultado |
|---|---|
| auth-service | 72/72 |
| catalog-service | 71/71 |
| ticket-service | 270/270 |
| api-gateway | 3/3 |
| frontend | 31/31 |
| **Total** | **447/447** |

Pruebas de extremo a extremo de la Fase T, ya ejecutadas sobre este mismo código de aplicación: copia del laboratorio 31/31, simulación de servidor nuevo 61/61 (antes de los últimos ajustes visuales del PDF) y backups cifrados 60/60. No se repitieron para los commits.

## Resultado de las verificaciones

| Verificación | Resultado |
|---|---|
| Rama de trabajo correcta | OK |
| 3 esquemas MSSQL con `prisma validate` | OK: válidos, proveedor `sqlserver` e iguales a `schema.prisma` |
| Builds de los 5 componentes | OK |
| `compose.yaml` y `deploy/server/compose.yaml` | OK: `config` válido, con valores de comprobación para el de servidor |
| PostgreSQL no reintroducido | OK: sin dependencias, proveedor ni imagen; solo comentarios, `archive/`, documentos históricos y la guarda del empaquetado |
| Valores reales de `.env` en la punta de la rama | OK: ninguno |
| Claves privadas, JWT y claves de API en los commits | OK: ninguna |
| IP del VPS en los commits | OK: ninguna |
| Archivos prohibidos en el árbol | OK: ninguno |

**Coincidencia aclarada:** `POSTGRES_SUPERUSER_PASSWORD` del `.env` local coincide con el marcador de ejemplo de `.env.example`. Ese marcador ya estaba en `origin/Develop` y `b755adf` lo elimina.

## Estado final de Git

- Rama `consolidacion/fases-q-r-s-t`, con el árbol de trabajo limpio salvo los archivos ignorados.
- **Sin push.** Queda a la espera de autorización.

## Antes de autorizar un push

El repositorio remoto es **público**. El commit `d2c8e7d` agrupa la auditoría del VPS anterior para poder revisarla o dejarla fuera con facilidad. Hay otros documentos que también describen el estado de ese servidor, así que la decisión debe tomarse sobre el conjunto de la documentación.
