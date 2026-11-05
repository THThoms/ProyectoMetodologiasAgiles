# FASE M — Despliegue definitivo del arreglo de imágenes al VPS

**Fecha:** 2026-09-15 (deploy: 22:15 UTC+2)
**VPS:** `<IP_VPS>` — `vmi3560421`
**Proyecto:** `/opt/servicedesk-uta`
**Dominio:** `https://servicedesk-uta.site`
**Motor:** SQL Server 2022 (`sd-mssql`), único runtime. PostgreSQL preservado
como rollback (`sd-postgres`), sin uso ni modificación.
**Ninguna operación destructiva ejecutada.** No se borraron archivos,
no se modificó BD, no se cambió `DATABASE_URL`, no se ejecutó
`docker compose down -v`.
**Ningún secreto, token, contraseña, credencial FCM/SMTP/Cloudinary o
connection string se muestra en este documento.**

Escrito para: el equipo del proyecto (Tech Lead + docente supervisor).
Documenta lo que se cambió en producción, cómo se verificó y qué
falta por hacer manualmente en el navegador.

---

## 1. Causa raíz (recordatorio, ya confirmada en Fase L / diagnóstico)

En producción cada adjunto se persiste como `storage_provider="local"`
con `image_url="/uploads/<file>"`. El navegador emite `<img src="/uploads/<file>">`,
sin `Authorization`. Nginx del host reenvía `/uploads/*` al gateway,
y el gateway **no proxya ese prefijo**; responde `404 application/json`.
El `onError` del `<img>` renderiza el literal `"No disponible"`. Aun si
el gateway lo proxeara, la ruta `/uploads/*` del ticket-service exige
`verifyJwt` y `<img src>` no puede llevar `Authorization: Bearer`.

Refuerza la condición que `STORAGE_MODE=cloudinary` cae silenciosamente
a `local` porque el paquete `cloudinary` no está instalado en el
contenedor. (Se documenta como mejora futura; **no** se toca en Fase M.)

## 2. Solución desplegada

- **Endpoint autenticado nuevo en el ticket-service:**
  `GET /tickets/:id/attachments/:attachmentId`
  con `verifyJwt`, comprobación de dueño / técnico / admin,
  `attachment.ticketId === :id`, `path.basename`, resolución absoluta
  dentro de `env.uploadDir`, `Content-Type` real del `mimeType`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  max-age=300` y streaming con `res.sendFile`.
  (302 al `secure_url` para adjuntos Cloudinary.)
- **Serializador `serializeAttachment(ticketId, a)`** en el
  `storageService`: reescribe `image_url` local a
  `/api/tickets/{ticketId}/attachments/{a.id}` (Cloudinary intacto).
  Aplicado en las respuestas de `GET /tickets/history/:id` y
  `GET /tickets/:id`.
- **Frontend:** componente `AuthenticatedImage` que descarga el binario
  con `Authorization: Bearer` vía Axios `responseType: "blob"`, crea
  un `URL.createObjectURL(blob)` y lo pasa al `<img>`. `TicketHistoryModal`
  usa este componente para miniatura y lightbox. Tarjetas de
  *Mis Aceptados* y filas de *Panel Técnico* clicables (P1). El botón
  secundario pasa de "Ver historial" a "Ver detalle".

## 3. Archivos transferidos al VPS

Transferencia con `pscp` (sin git — `/opt/servicedesk-uta` no es repo).

Backend (`sd-ticket`):

- `ticket-service/src/routes/ticketRoutes.ts`
- `ticket-service/src/services/storageService.ts`
- `ticket-service/tests/ticketAttachmentServe.test.ts`

Frontend (`sd-frontend`):

- `frontend/src/components/AuthenticatedImage.tsx` (nuevo)
- `frontend/src/components/TicketHistoryModal.tsx`
- `frontend/src/pages/MisTicketsAceptados.tsx`
- `frontend/src/pages/PanelTecnicoV2.tsx`

**No se transfirió** ningún archivo del gateway (no requiere cambios,
el endpoint cae bajo `/api/tickets/*` que ya está proxeado), ni del
auth-service, ni del catalog-service, ni ningún `.env`.

Verificación post-transferencia (marcadores presentes en VPS):

```
ticketRoutes.ts:19   import ... serializeAttachment ... from "../services/storageService";
ticketRoutes.ts:746  attachments: ... map(a => serializeAttachment(ticket.id, a))
ticketRoutes.ts:788  router.get("/:id/attachments/:attachmentId", ...)
ticketRoutes.ts:880  attachments: ... map(a => serializeAttachment(ticket.id, a))
storageService.ts:186 export function serializeAttachment(ticketId, a)
TicketHistoryModal.tsx:15 import AuthenticatedImage from "./AuthenticatedImage"
AuthenticatedImage.tsx:41 export default function AuthenticatedImage(...)
MisTicketsAceptados.tsx    role="button" (tarjeta clicable)
PanelTecnicoV2.tsx         import TicketHistoryModal + "Ver detalle"
```

## 4. Backup

Antes de la transferencia se copiaron los archivos existentes a:

```
/opt/servicedesk-uta/.backups/pre-fase-M-20260915T201217Z/
├── ticket-service/src/routes/ticketRoutes.ts
├── ticket-service/src/services/storageService.ts
└── frontend/src/{components/TicketHistoryModal.tsx, pages/{MisTicketsAceptados,PanelTecnicoV2}.tsx}
```

`AuthenticatedImage.tsx` no tenía versión previa (archivo nuevo) y
`ticketAttachmentServe.test.ts` tampoco. Volúmenes Docker y BD no
requieren backup en esta fase — no se tocan.

## 5. Rebuild

```
docker compose --env-file .env.mssql -f docker-compose.prod-mssql.yml \
   build ticket-service frontend
```

Resultado (extracto significativo):

- `servicedesk-microservices-ticket-service-mssql:latest` reconstruido.
- `servicedesk-microservices-frontend:latest` reconstruido (Vite build
  produjo un nuevo `assets/index-B6aM42JF.js`).

Auth, catalog, gateway, mssql, postgres: **no reconstruidos, no
tocados.**

## 6. Restart

```
docker compose --env-file .env.mssql -f docker-compose.prod-mssql.yml \
   up -d --no-deps ticket-service frontend
```

Recreó únicamente `sd-ticket` y `sd-frontend`. Estado final (14 minutos
tras deploy):

```
NAMES         STATUS
sd-ticket     Up healthy
sd-frontend   Up (unhealthy)   ← ver §7.1
sd-gateway    Up 20 hours healthy
sd-catalog    Up 31 hours healthy
sd-auth       Up 31 hours healthy
sd-mssql      Up 21 hours healthy
sd-postgres   Up 8 days healthy
```

### 6.1 Nota sobre `sd-frontend` "unhealthy"

Bandera preexistente (idéntica antes del deploy): el healthcheck del
contenedor usa `wget` contra un puerto que rechaza conexión. Aun así
el nginx interno responde `200 OK` a `HEAD /` desde el propio host y a
cientos de peticiones reales (Censys, Chrome de usuarios, etc.). No es
regresión de Fase M — es un `HEALTHCHECK` del `Dockerfile` mal
configurado que se arreglará en una fase posterior. **La aplicación
funciona.**

## 7. Prueba del endpoint (curl real, desde el VPS)

Se generaron 4 JWT temporales (5 minutos de vida) dentro del contenedor
`sd-ticket`, se guardaron con `chmod 600` en `/root/.fase-m-tokens/`,
se ejecutó `curl -H "Authorization: Bearer …"` sin que el token
apareciera en stdout, y al terminar se borraron los archivos. **Ningún
token se muestra en este documento.**

Ticket real usado: `5e5d24df-0417-410d-baaf-2a74849d5d7d`
(número `TK-20260915-007`).
Attachment usado: `9c629250-8a4b-4320-9ce1-2cca5502e818`
(`image/jpeg`, 20490 bytes en BD).

| Caso | HTTP | Content-Type | Content-Length | nosniff | Cache-Control | Bytes ok |
|---|---:|---|---:|---|---|---|
| Sin `Authorization` | 401 | `application/json` | 34 | sí | — | — |
| Owner (rol `user`, dueño real) | **200** | `image/jpeg` | **20490** | sí | `private, max-age=300` | md5 idéntico al archivo en disco |
| Técnico (rol `tech_n1`, no dueño) | **200** | `image/jpeg` | **20490** | sí | `private, max-age=300` | md5 idéntico |
| Admin (rol `admin`, no dueño) | **200** | `image/jpeg` | **20490** | sí | `private, max-age=300` | md5 idéntico |
| Otro `user` no dueño ni staff | **403** | `application/json` | 52 | sí | — | body `{"error":"No tienes permisos para ver este adjunto"}` |

MD5 comparado extremo a extremo:

```
md5 (bytes servidos)                            = f7d67179f61add8c8341fde55fe10f67
md5 (/app/uploads/1789484544509-2311399159d2.jpg) = f7d67179f61add8c8341fde55fe10f67
```

`file` sobre los bytes servidos: `JPEG image data, JFIF standard 1.01,
… 431x435 …`. La descarga es la imagen original, no un JSON, no un
HTML, no un placeholder.

### 7.1 Ticket con múltiples adjuntos (3 imágenes)

Ticket `835d6100-75a8-4ac3-82af-8342b20ea314` (TK-20260915-004) tiene
3 adjuntos `image/png` de 68 bytes cada uno. Con JWT del dueño:

```
GET /api/tickets/835d6100-…/attachments/2a816328-…  → 200 image/png 68
GET /api/tickets/835d6100-…/attachments/815a3ea3-…  → 200 image/png 68
GET /api/tickets/835d6100-…/attachments/176f95bf-…  → 200 image/png 68
```

`file` sobre las 3 respuestas: `PNG image data, 1 x 1, 8-bit/color
RGBA, non-interlaced`.

### 7.2 Ticket sin adjuntos

`f705bf6a-52da-42f2-a20b-10b6f022b95d` (TK-20260915-001): historial
carga correctamente con `attachments: []`, sin errores.

## 8. Serialización verificada del historial

```
GET /api/tickets/history/5e5d24df-0417-410d-baaf-2a74849d5d7d
  Authorization: Bearer <owner>
```

Sección `attachments[]`:

```json
[
  {
    "id": "9c629250-8a4b-4320-9ce1-2cca5502e818",
    "imageUrl": "/api/tickets/5e5d24df-0417-410d-baaf-2a74849d5d7d/attachments/9c629250-8a4b-4320-9ce1-2cca5502e818",
    "filePath": "1789484544509-2311399159d2.jpg",
    "storageProvider": "local",
    "mimeType": "image/jpeg",
    "fileSize": 20490
  }
]
```

- El JSON **no contiene** ningún `/uploads/…` en `imageUrl`.
- El `imageUrl` apunta exactamente al endpoint autenticado.

Búsqueda literal en el body:

```
grep "/uploads/" en el JSON        →  0 hits
grep "/api/tickets/…/attachments"  →  1 hit
```

## 9. Bundle del frontend

- `index.html` referencia `assets/index-B6aM42JF.js` (hash nuevo,
  reconstruido con `vite build` dentro del contenedor).
- Ese bundle contiene la mecánica `AuthenticatedImage`:
  `H.get(e,{responseType:"blob",signal:m.signal})` y
  `URL.createObjectURL(_)` (verificado con `grep` en
  `/usr/share/nginx/html/assets/index-B6aM42JF.js`).
- **El bundle no contiene** ninguna cadena literal `/uploads/` como
  URL de imagen (los pocos matches encontrados son ruido de librerías
  ajenas — texto sin relación con adjuntos de ticket).

Cache: los assets Vite llevan hash en el nombre, por lo que el
`Cache-Control: public, immutable` de nginx **no** sirve el bundle
viejo; los clientes que carguen la SPA obtendrán el nuevo `index.html`
que apunta al nuevo hash. Los usuarios ya cargados pueden necesitar un
refresh; el `index.html` no está cacheado agresivamente.

## 10. Tráfico observado post-deploy

Últimos 500 registros del `access.log` del nginx del host:

- **Cero peticiones `GET /uploads/…`** desde navegadores reales tras el
  deploy (las últimas fueron a las **17:02** del mismo día, antes del
  deploy: la técnica `192.188.46.51/Chrome` desde `/mis-aceptados` —
  exactamente la escena "No disponible" que Fase M resuelve).
- Las peticiones `GET /uploads/…` visibles tras las 20:15 son mis
  pruebas con `curl 8.5.0` desde el propio VPS y todas devuelven
  `404 44` (el estado que el frontend nuevo ya no puede producir).
- **7 peticiones `GET /api/tickets/…/attachments/…`** posteriores al
  deploy (mis pruebas) con estados `200/200/200/200/200/200/401/403`.

## 11. Volumen y archivos intactos

```
Volume:  servicedesk-uta_ticket-uploads   (mismo del pre-deploy)
Mount:   /app/uploads en sd-ticket (Type=volume, Mode=rw)
Files:   7 archivos, tamaños/mtimes idénticos al pre-deploy
         (1789144852387-58525237492b.png 57526 B, ... 1789484544509-... 20490 B)
```

Ningún archivo se movió, borró, sobreescribió, migró o volvió a subir.
`storage_provider = "local"` en BD sigue siendo el valor real y
concuerda con el runtime.

## 12. Autorización (resumen ordenado)

| Rol / usuario | Ver miniatura | Ver imagen ampliada |
|---|---|---|
| Usuario propietario del ticket | ✅ 200 | ✅ 200 |
| Técnico (`tech_n1`, `tech_n2`, …) | ✅ 200 | ✅ 200 |
| Admin | ✅ 200 | ✅ 200 |
| Usuario no relacionado | ⛔ 403 | ⛔ 403 |
| Sin JWT | ⛔ 401 | ⛔ 401 |
| Adjunto de OTRO ticket con `ticketId` mío | ⛔ 403 (defensa cruce) | ⛔ 403 |
| Adjunto con path traversal en `filePath` | ⛔ 400/404 (defensa) | — |

Cobertura de código: `ticket-service/tests/ticketAttachmentServe.test.ts`
(11 casos) — verde local. Suite completa local sigue 293/293
(auth 26 + catalog 52 + ticket 215). El `tsc --noEmit` y `vite build`
del frontend fueron limpios antes del despliegue.

## 13. Regresión funcional

`docker ps` post-deploy: `sd-auth`, `sd-catalog`, `sd-gateway`,
`sd-mssql`, `sd-postgres` siguen `healthy` con `Up N hours` sin
recreación. Es decir: **no se tocaron** auth, SSO, catálogo, base de
datos, gateway ni la instancia de rollback Postgres. Log de sd-ticket
sin errores/warnings de Prisma tras arranque. Log de sd-gateway
únicamente muestra 401/403 de mis pruebas y tráfico normal.

FCM, EmailOutbox y Cloudinary: no fueron tocados. La configuración
`STORAGE_MODE=cloudinary` sigue vigente pero cae al modo `local`
(paquete no instalado); es exactamente el comportamiento previo y
por eso los 7 adjuntos existentes siguen siendo `local`. **No se
migraron adjuntos.**

## 14. Estado final y criterios de éxito

Del checklist original de Fase M:

- [x] Endpoint autenticado existe y compilado en producción
- [x] Responde 200 a usuario autorizado (dueño, técnico, admin)
- [x] Devuelve `image/jpeg` / `image/png` reales (verificado con `file`)
- [x] Archivo real existe y no se pierde (md5 pre-deploy = md5 post-deploy)
- [x] Historial devuelve URL API, no `/uploads`
- [x] Frontend bundle no genera `<img src="/uploads/…">`
- [x] AuthenticatedImage presente en el bundle
- [x] Con múltiples imágenes cada endpoint responde 200 (probado con 3)
- [x] Usuario no autorizado → 403
- [x] Sin JWT → 401
- [x] SQL Server intacto (sin reinicio, sin cambios)
- [x] Postgres preservado como rollback
- [x] FCM / Email / SSO / reescalamiento / validación: sin tocar
- [x] 293/293 tests locales (auth 26 + catalog 52 + ticket 215)
- [x] Frontend `tsc --noEmit` limpio + `vite build` sin errores
- [x] Producción healthy (excepto flag `unhealthy` heredado en
      `sd-frontend`, pre-existente, no funcional — §6.1)

### 14.1 Confirmación en navegador — pendiente de operador humano

El único paso que este entorno no puede hacer por sí solo es abrir un
navegador real, autenticarse como un técnico y validar la miniatura y
el lightbox. La ruta API funciona (§7), los headers son correctos, los
bytes coinciden y el bundle del frontend incluye la mecánica de
`AuthenticatedImage` con `responseType: "blob"` + `createObjectURL`.
Por rigor, la validación final que solicita el enunciado ("ticket
real → detalle → miniatura → clic → imagen visible") queda como
**paso operativo humano**:

1. Abrir `https://servicedesk-uta.site` como técnico.
2. Ir a **Mis Aceptados**, hacer click en el ticket
   `TK-20260915-007` (o cualquier otro con adjunto).
3. Confirmar el bloque **Detalle del ticket** en el modal.
4. Confirmar que la miniatura muestra la imagen (no "No disponible").
5. Click en la miniatura → lightbox con la imagen ampliada.
6. En DevTools → *Network*, confirmar
   `GET /api/tickets/…/attachments/…` con `200 image/jpeg` y
   `Cache-Control: private, max-age=300`.
7. Confirmar que **no aparece** ningún `GET /uploads/…` en la pestaña
   *Network*.

Si en la navegación aparece nuevamente "No disponible", debe reportarse:

- URL solicitada exacta,
- HTTP status,
- Content-Type devuelto,
- componente que generó el mensaje (`AuthenticatedImage` estado
  `"error"` → "No se pudo cargar la imagen", **no** "No disponible").

Diferencia importante: en el bundle nuevo la cadena que se muestra
cuando la carga falla es **"No se pudo cargar la imagen"** (o
"Cargando imagen…" mientras descarga), no "No disponible". Si aún se
observa "No disponible", indicaría que el navegador está sirviendo el
bundle viejo desde su caché — hacer `Ctrl+F5` / vaciado de caché duro.

## 15. Higiene de seguridad

- No hay tokens JWT residuales en el VPS: `/root/.fase-m-*` borrado,
  `/tmp/*.tok` no existe.
- Los JWTs de prueba tenían `expiresIn: "5m"` y ya expiraron.
- Ninguna respuesta de `docker exec` ni de `curl` en este reporte
  incluye tokens, contraseñas, credenciales o connection strings.
- Archivos `.env*` del VPS siguen con `chmod 600 root:root` y no se
  imprimieron.
- La consulta a `Attachment` para verificación se hizo con Prisma del
  propio contenedor, leyendo solo `id/ticketId/imageUrl/filePath/
  storageProvider/mimeType/fileSize/createdAt`.
- No se creó ninguna ruta pública que permita bajar cualquier archivo:
  el endpoint sirve **solo** attachments cuya `attachment.ticketId ===
  :id` y con `path.basename` + validación de directorio.

## 16. Notas pendientes (no bloqueantes)

- `sd-frontend HEALTHCHECK` (Dockerfile) apunta a un puerto/host que
  rechaza — reporta `unhealthy` aunque nginx sirve `200`. Es previo a
  Fase M. Fase futura, corta.
- `location /uploads/` en `/etc/nginx/sites-available/servicedesk-uta.site`
  ahora es código muerto (el gateway ya nunca devuelve 200 ahí). Se
  puede eliminar por higiene en una fase futura, sin urgencia.
- El paquete `cloudinary` sigue sin instalar. El sistema opera
  correctamente en modo `local` gracias a Fase M. Si se desea activar
  Cloudinary de verdad: añadir `cloudinary` a
  `ticket-service/package.json`, `npm i`, rebuild — las nuevas subidas
  irán al CDN y el endpoint autenticado devolverá `302` al `secure_url`
  (comportamiento ya soportado en el código y testado). Los 7 adjuntos
  actuales seguirán siendo servidos por el endpoint local sin
  interrupción.

---

**NO se hizo commit, NO se hizo push a git.** El working tree local
sigue con los cambios sin commitear. El VPS recibió los archivos por
`pscp` y reconstruyó las imágenes localmente.
