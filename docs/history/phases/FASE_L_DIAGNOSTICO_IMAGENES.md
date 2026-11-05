# FASE L — Diagnóstico definitivo: "No disponible" en imágenes adjuntas

**Fecha:** 2026-09-15
**Entorno diagnosticado:** producción · `https://servicedesk-uta.site`
**VPS:** `<IP_VPS>` (SSH `2222`)
**Motor:** SQL Server 2022 (`sd-mssql`) — no se modifica
**Acciones ejecutadas:** solo lectura. No se modificaron archivos, ni la BD,
ni contenedores, ni `DATABASE_URL`. No se reinició ningún servicio.
**No se incluyen secretos, tokens, contraseñas ni connection strings.**

Escrito para: el equipo del proyecto (Tech Lead + docente supervisor).
Documenta paso a paso la causa por la que en producción un ticket con
adjuntos muestra `IMÁGENES ADJUNTAS (n)` seguido del literal
`No disponible`.

---

## 1. Ticket real con adjuntos identificado

Consultando `sd-ticket` con Prisma en modo lectura (solo metadatos, sin
PII ni secretos) se listaron 7 attachments. Ejemplo actual (último
subido):

| Campo | Valor |
|---|---|
| Attachment ID | `9c629250-8a4b-4320-9ce1-2cca5502e818` |
| Ticket ID | `5e5d24df-0417-410d-baaf-2a74849d5d7d` |
| storage_provider | `local` |
| image_url | `/uploads/1789484544509-2311399159d2.jpg` |
| filePath | `1789484544509-2311399159d2.jpg` |
| mimeType | `image/jpeg` |
| fileSize | `20490` bytes |
| createdAt | `2026-09-15T15:02:24.552Z` |

Los 7 attachments en BD tienen `storage_provider = "local"` y una
`image_url` con formato `/uploads/<file>`, sin excepciones. **No hay
ningún attachment con URL absoluta**: ningún registro apunta a
Cloudinary o a un CDN público.

## 2. Clasificación de la URL

`/uploads/1789484544509-2311399159d2.jpg` es una **ruta relativa local**
al servicio backend:

- No es `localhost`
- No es un hostname Docker (`http://ticket-service:*`, `http://sd-ticket:*`)
- No es una IP privada
- No es una URL pública
- Es una **ruta relativa** (`/uploads/…`) servida en teoría por el
  ticket-service tras `verifyJwt`

## 3. Archivos físicos en disco

Volumen Docker de uploads:

```
Volume:  servicedesk-uta_ticket-uploads
Source:  /var/lib/docker/volumes/servicedesk-uta_ticket-uploads/_data
Target:  /app/uploads (dentro de sd-ticket)
```

Contenido actual:

- 7 archivos con el mismo patrón que multer diskStorage produce
  (`<timestamp>-<hex>.<ext>`).
- Coinciden 1‑a‑1 con los `filePath` de la tabla `Attachment`.
- Permisos: `-rw-r--r-- root:root` (legibles por el usuario `node` del
  contenedor).
- Existencia confirmada dentro del contenedor: `docker exec sd-ticket ls
  -la /app/uploads` los muestra todos.

**Los binarios existen y son accesibles desde el contenedor.** El
problema no está en disco.

## 4. Configuración de almacenamiento del contenedor

`docker exec sd-ticket printenv` (subset seguro):

| Variable | Valor |
|---|---|
| `STORAGE_MODE` | `cloudinary` |
| `CLOUDINARY_CLOUD_NAME` | `<set, longitud 8>` |
| `CLOUDINARY_API_KEY` | `<set, longitud 15>` |
| `CLOUDINARY_API_SECRET` | `<set, longitud 27>` |
| `CLOUDINARY_FOLDER` | `<set, longitud 15>` |
| `UPLOAD_DIR` | *(vacío)* |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://servicedesk-uta.site` |

- `STORAGE_MODE=cloudinary` está intencionado, pero
  `/app/node_modules/cloudinary` **no existe** en el contenedor
  (`ls: cannot access '/app/node_modules/cloudinary': No such file or
  directory`).
- Al fallar `require.resolve("cloudinary")` en
  `storageService.getStorageAdapter()`, el código cae silenciosamente a
  `LocalStorage` con el warning:
  `[storage] STORAGE_MODE=cloudinary pero el paquete 'cloudinary' no está
  instalado. Cayendo a modo 'local'.`
  (El warning no aparece en las últimas 400 líneas de log porque solo se
  imprime la primera vez, al iniciar la primera subida tras arranque).
- Por eso todos los adjuntos nuevos y viejos se almacenan como `local`
  con `imageUrl = /uploads/<file>`.

## 5. Ruta que sirve el ticket-service para `/uploads`

En `dist/app.js:39` el servicio monta:

```js
app.use("/uploads", verifyJwt, express.static(path.resolve(env.uploadDir), {...}))
```

Comportamiento verificado desde dentro del contenedor:

```
docker exec sd-ticket -> curl/wget http://localhost:3003/uploads/<file>.png
HTTP/1.1 401 Unauthorized   Content-Type: application/json   Content-Length: 34
```

Es decir, el propio ticket-service **exige `Authorization: Bearer`**
antes de servir el binario. Correcto por seguridad.

## 6. Ingress público — nginx del host

Configuración activa en `/etc/nginx/sites-available/servicedesk-uta.site`
(TLS gestionado por Certbot, no relevante para este bug):

| Location | proxy_pass |
|---|---|
| `/api/`     | `http://127.0.0.1:8080` (gateway) |
| `/auth/`    | `http://127.0.0.1:8080` (gateway) |
| `/uploads/` | `http://127.0.0.1:8080` (gateway) |
| `/`         | `http://127.0.0.1:3000` (frontend SPA) |

Es decir, nginx sí reenvía `/uploads/*` al **gateway**, no al
ticket-service directamente.

## 7. Gateway — rutas registradas

`docker exec sd-gateway grep app.use /app/dist/app.js`:

- `/api/auth`          → auth-service
- `/auth`              → auth-service
- `/api/catalog`       → catalog-service
- `/api/knowledge`     → catalog-service
- `/api/tickets`       → ticket-service
- `/api/routing`       → ticket-service
- `/api/admin`         → ticket-service
- `/api/notifications` → ticket-service
- `app.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada en el gateway" }))`

**No existe registro para `/uploads/*`.** Cualquier request con ese
prefijo cae al 404 catch-all.

## 8. Prueba del recorrido completo con curl (desde el VPS)

```
curl -sk -D - "https://servicedesk-uta.site/uploads/1789144852387-58525237492b.png"
```

Respuesta:

```
HTTP/1.1 404 Not Found
Server: nginx/1.24.0 (Ubuntu)
Content-Type: application/json; charset=utf-8
Content-Length: 44
...
{"error":"Ruta no encontrada en el gateway"}
```

Y directo al gateway (bypassing nginx):

```
curl -s -D - "http://127.0.0.1:8080/uploads/1789144852387-58525237492b.png"
```

Mismo resultado: 404 JSON, `Content-Type: application/json`, 44 bytes.

Registro final:

| Prueba | HTTP | Content-Type | Content-Length |
|---|---:|---|---:|
| `GET https://…/uploads/<file>` | 404 | `application/json; charset=utf-8` | 44 |
| `GET http://127.0.0.1:8080/uploads/<file>` | 404 | `application/json; charset=utf-8` | 44 |
| `GET http://localhost:3003/uploads/<file>` (dentro de sd-ticket, sin JWT) | 401 | `application/json; charset=utf-8` | 34 |

Además, en `docker logs --since 24h sd-ticket` no aparece **ninguna**
línea `GET /uploads/…`: los pedidos del navegador **nunca llegan al
ticket-service**, mueren en el gateway.

## 9. Lo que recibe realmente el frontend

El endpoint que carga el modal de historial (bundle actual servido en
producción, `assets/index-DYXC_n3u.js`) hace:

1. `GET /api/tickets/history/<ticketId>` → responde 200 con el arreglo
   `attachments[]` sin serializar. Cada attachment lleva
   `imageUrl: "/uploads/<file>"` y `storageProvider: "local"` tal cual
   están en BD.
2. El componente construye un `<img src="/uploads/<file>">` (la cadena
   `/uploads/` y el fallback `No disponible` están literalmente
   presentes en el bundle desplegado, confirmando que se despliega la
   versión previa a Fase L).
3. El navegador emite `GET https://servicedesk-uta.site/uploads/<file>`
   **sin** cabecera `Authorization` — un `<img>` no puede añadirla.
4. Nginx → gateway → **404 JSON** (paso 8).
5. `<img>.onError` reemplaza el nodo por un `<span>` con `textContent =
   "No disponible"`. De ahí el mensaje observado en producción.

## 10. Determinación de la causa raíz

Concurren dos condiciones simultáneas que se refuerzan:

- **(a) El gateway no proxya `/uploads/*` a `ticket-service`.**
  El único listener existente para ese prefijo termina en un 404 JSON
  genérico.
- **(b) Aunque lo hiciera, el navegador no puede autenticar `<img>`
  con `Authorization: Bearer` y `ticket-service` exige JWT en
  `/uploads/*`.** Un `<img src>` no puede llevar cabeceras.

Y agravante:

- **(c) `STORAGE_MODE=cloudinary` en producción cae silenciosamente a
  `local` porque el paquete `cloudinary` no está instalado en el
  contenedor.** Esto obliga a que absolutamente todos los adjuntos (7
  actuales y los futuros) tomen la ruta `/uploads/<file>`, alimentando
  el bug de (a)+(b). Si `cloudinary` estuviera correctamente instalado,
  las nuevas subidas irían al CDN público y no dispararían el bug —
  pero los adjuntos existentes seguirían rotos.

---

## CAUSA RAÍZ

En producción, cada adjunto se persiste como `storage_provider="local"`
con `image_url="/uploads/<file>"`. El navegador construye
`<img src="/uploads/<file>">` y el request va a
`https://servicedesk-uta.site/uploads/<file>` sin cabecera
`Authorization`. Nginx lo reenvía al gateway, y el gateway **no tiene
ningún handler para el prefijo `/uploads/*`**, por lo que responde con
un 404 JSON (`{"error":"Ruta no encontrada en el gateway"}`). El
`<img>` falla, `onError` lo reemplaza por el literal `"No disponible"`.

Aun si el gateway proxeara `/uploads/*` a `ticket-service`, la ruta
está detrás de `verifyJwt` y un `<img src>` no puede adjuntar
`Authorization: Bearer`, por lo que respondería 401. El problema
requiere un cambio de mecánica de servido, no solo un cambio de proxy.

Refuerza el problema el hecho de que `STORAGE_MODE=cloudinary` está
configurado pero el paquete `cloudinary` no está instalado en el
contenedor de producción, y el `getStorageAdapter()` cae silenciosamente
al provider `local`. Todos los adjuntos actuales quedan servidos por la
misma ruta rota.

## SOLUCIÓN NECESARIA

Servir el binario por un endpoint **`/api/*`** que ya es proxeado por
gateway y por nginx, autenticado con JWT verificado en el servidor,
validando ownership del ticket, con `Content-Type` real y streaming del
archivo. En el frontend, cargar la imagen con `fetch` + `Authorization:
Bearer` obteniendo un `Blob`, convirtiendo con `URL.createObjectURL(blob)`
y usando ese object URL como `<img src>`.

Concretamente (implementación ya presente en el working tree, pendiente
de despliegue):

- **Backend**
  - Nuevo endpoint `GET /tickets/:id/attachments/:attachmentId` en
    `ticket-service` (verifyJwt + verificación de dueño/técnico/admin +
    coincidencia `attachment.ticketId === :id` + `path.basename` +
    validación de ruta contra `env.uploadDir` + `Content-Type` desde
    `mimeType` + `X-Content-Type-Options: nosniff` +
    `Cache-Control: private, max-age=300` + `res.sendFile` streaming).
  - Serializador `serializeAttachment(ticketId, attachment)` que
    reescribe `image_url` local a `/api/tickets/{id}/attachments/{aid}`
    y deja intactas las URLs absolutas (Cloudinary).
  - Aplicar el serializador en las respuestas de
    `GET /tickets/history/:id` y `GET /tickets/:id`.
- **Frontend**
  - Componente `AuthenticatedImage` que, para URLs relativas, hace
    `api.get(src, { responseType: "blob" })` (Axios ya inyecta el JWT
    por interceptor) y crea un `URL.createObjectURL` para `<img>`;
    para URLs absolutas (`https://…`) usa `<img src>` directo.
  - `TicketHistoryModal` renderiza galería y lightbox con
    `AuthenticatedImage`. Se añade además un bloque "Detalle del ticket"
    (P1).
  - Tarjetas de `Mis Aceptados` y filas de `Panel Técnico` se hacen
    clicables (P1).

## ARCHIVOS QUE DEBEN MODIFICARSE

Backend (`ticket-service`):

- [ticket-service/src/routes/ticketRoutes.ts](../../../ticket-service/src/routes/ticketRoutes.ts)
  — añadir el endpoint `GET /:id/attachments/:attachmentId` y aplicar
  `serializeAttachment` en las respuestas de `/tickets/history/:id` y
  `/tickets/:id`.
- [ticket-service/src/services/storageService.ts](../../../ticket-service/src/services/storageService.ts)
  — añadir `serializeAttachment(ticketId, a)`.
- [ticket-service/tests/ticketAttachmentServe.test.ts](../../../ticket-service/tests/ticketAttachmentServe.test.ts)
  — nuevo (11 casos: 200 dueño / 200 técnico / 200 admin / 403 no dueño
  y no staff / 401 sin token / 404 ticket / 404 attachment / 403
  attachment-ticket mismatch / 404 archivo ausente / 302 Cloudinary /
  404 defensa path traversal).

Frontend:

- [frontend/src/components/AuthenticatedImage.tsx](../../../frontend/src/components/AuthenticatedImage.tsx)
  — nuevo componente.
- [frontend/src/components/TicketHistoryModal.tsx](../../../frontend/src/components/TicketHistoryModal.tsx)
  — usar `AuthenticatedImage` en galería y lightbox; añadir bloque
  "Detalle del ticket".
- [frontend/src/pages/MisTicketsAceptados.tsx](../../../frontend/src/pages/MisTicketsAceptados.tsx)
  — tarjeta clicable; renombrar "Ver historial" → "Ver detalle";
  `stopPropagation` en botones de acción.
- [frontend/src/pages/PanelTecnicoV2.tsx](../../../frontend/src/pages/PanelTecnicoV2.tsx)
  — fila clicable + botón "Ver detalle"; integración del modal.

**No se debe** modificar ningún registro de la base de datos, ni
regenerar attachments, ni convertir a Base64, ni crear una ruta
`/uploads/*` pública sin JWT.

## CAMBIOS DE INFRAESTRUCTURA NECESARIOS

- **Ninguno obligatorio.** El endpoint nuevo cae bajo el prefijo
  `/api/tickets/*` que **ya** está proxeado por el gateway
  (`/api/tickets` → `ticket-service`) y por el nginx del host
  (`/api/` → `127.0.0.1:8080`).
- El bloque `location /uploads/` de
  `/etc/nginx/sites-available/servicedesk-uta.site` queda como código
  muerto tras el fix (siempre devolverá 404 desde el gateway); puede
  eliminarse en una fase posterior por higiene, sin urgencia.
- El paquete `cloudinary` sigue faltando en el contenedor. **No se
  arregla en esta fase** para no introducir cambios acoplados. Cuando
  se decida activar Cloudinary de verdad:
  1. Añadir `cloudinary` a `ticket-service/package.json`, `npm i`,
     rebuild de la imagen.
  2. Los adjuntos futuros se subirán al CDN con URL absoluta
     `https://…` (autofuncionales para el `<img>` público).
  3. Los 7 adjuntos existentes seguirán siendo `local` y continuarán
     funcionando gracias al endpoint autenticado — **no** hay que
     migrarlos, **no** hay que borrarlos, **no** hay que sustituir sus
     URLs.

## PRUEBA QUE DEMOSTRARÁ LA SOLUCIÓN

Tras desplegar la Fase L en el VPS, cualquiera de estas 3 pruebas basta,
y las 3 juntas cubren todo el flujo:

1. **DevTools del navegador** en `https://servicedesk-uta.site` como
   técnico autenticado, abriendo un ticket con adjunto:
   - En *Elements*, la miniatura tiene `<img src="blob:https://servicedesk-uta.site/…">`.
   - En *Network*, la request `GET /api/tickets/<ticketId>/attachments/<attId>`
     responde `200`, `Content-Type: image/jpeg` (o `image/png`),
     `X-Content-Type-Options: nosniff`, `Cache-Control: private,
     max-age=300`, y `Content-Length` idéntico al `fileSize` de la BD
     (por ejemplo, 20490 bytes para el último adjunto listado).
   - El literal "No disponible" desaparece.

2. **curl con JWT válido desde el VPS**:
   ```
   curl -sk -o /tmp/out.jpg -D - \
     -H "Authorization: Bearer <JWT_de_un_tecnico>" \
     "https://servicedesk-uta.site/api/tickets/5e5d24df-0417-410d-baaf-2a74849d5d7d/attachments/9c629250-8a4b-4320-9ce1-2cca5502e818" \
     | egrep -i "^(HTTP|Content-Type|Content-Length|X-Content-Type-Options|Cache-Control)"
   file /tmp/out.jpg   # esperado: JPEG image data
   md5sum /tmp/out.jpg # esperado: idéntico al del archivo en /var/lib/docker/volumes/servicedesk-uta_ticket-uploads/_data/1789484544509-2311399159d2.jpg
   ```
   Debe imprimir `HTTP/1.1 200`, `Content-Type: image/jpeg`,
   `Content-Length: 20490`, `X-Content-Type-Options: nosniff`,
   `Cache-Control: private, max-age=300`.

3. **Sin JWT / con JWT ajeno** desde el VPS, contra el mismo endpoint:
   - Sin `Authorization`: `401`.
   - Con JWT de un usuario que no es dueño ni staff: `403` sin haber
     consultado el registro del attachment.
   - Con `attachmentId` de otro ticket usando ese `ticketId`: `403`.
   Todos con `Content-Type: application/json`, no imagen.

Adicional (regresión ya cubierta local): `ticket-service` corre 215/215
tests, incluyendo los 11 nuevos del endpoint (`ticketAttachmentServe.test.ts`).

---

## Notas de seguridad y alcance

- **No se leyeron ni exhiben** contraseñas, JWT, secretos SMTP, service
  accounts de FCM, credenciales de Cloudinary ni la connection string
  de SQL Server. Todas las variables sensibles se listaron únicamente
  como *set / longitud N*.
- **No se ejecutó ninguna operación de escritura** en el VPS:
  ni cambios de código, ni cambios en el volumen, ni cambios en la BD,
  ni reinicios de contenedor.
- La consulta a `Attachment` se hizo con el propio Prisma del
  contenedor, seleccionando **solo** `id`, `ticketId`, `imageUrl`,
  `filePath`, `storageProvider`, `mimeType`, `fileSize` y `createdAt`
  — no se leyeron campos con PII del ticket ni del usuario.
- **No se cambió el motor de BD.** SQL Server 2022 sigue siendo el
  runtime; PostgreSQL sigue detenido como rollback (`sd-postgres`
  visible en `docker ps` con `Up 8 days (healthy)` pero sin ser
  utilizado por los servicios de aplicación).
- **NO COMMIT. NO PUSH.**
