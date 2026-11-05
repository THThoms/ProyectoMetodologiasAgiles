# FASE L — Corrección definitiva del detalle de ticket e imágenes adjuntas

**Fecha:** 2026-09-15
**Rama:** `Develop`
**Estado:** implementación local completa · sin commit · sin despliegue
**Motor:** SQL Server 2022 (misma configuración de Fase K, no se cambia motor)

Escrito para: el equipo del proyecto ServiceDesk UTA (Tech Lead + docente
supervisor). Documenta el diagnóstico y la corrección de los dos incidentes
reportados sobre el detalle de ticket y las imágenes adjuntas, con la mínima
información técnica necesaria para revisar y aprobar el despliegue.

---

## 1. Problema original

Reportados sobre producción (`https://servicedesk-uta.site`):

- **P1 — Detalle de ticket poco accesible.** Un técnico que ya aceptó un
  ticket solo veía la lista corta en *Mis Aceptados* y debía entrar a
  "Ver historial" para descubrir la información completa (solicitante,
  servicio, prioridad, área, técnico asignado, fechas). El detalle
  completo no era el flujo principal, sino un submenú.
- **P2 — Imágenes adjuntas mostradas como *"No disponible"*.** En el
  historial de tickets con adjuntos, el bloque *"IMÁGENES ADJUNTAS (n)"*
  aparecía seguido del literal *"No disponible"* pese a que los adjuntos
  sí existen en la base de datos.

## 2. Evidencia recolectada

- Captura de producción con `IMÁGENES ADJUNTAS (1)` y el placeholder
  *"No disponible"* debajo.
- Registros del `Attachment` en SQL Server con `imageUrl = '/uploads/<file>'`
  y `filePath = '<file>'`, `storageProvider = 'local'`. El binario
  correspondiente sí existía en el volumen del contenedor.
- El navegador de un usuario no puede pasar el header `Authorization: Bearer`
  al construir un `<img src="/uploads/…">`, y el gateway solo publica rutas
  bajo `/api/*` — nunca `/uploads/*`. En consecuencia, un `<img>` apuntando
  a `/uploads/x.png` viajaba sin token o simplemente no era ruteado, y el
  onError del frontend caía al mensaje *"No disponible"*.

## 3. Diagnóstico

Se combinaron dos causas distintas:

1. **UX — P1.** El único click con acción sobre la tarjeta de un ticket
   aceptado era el botón "Ver historial", nombre que sugiere una vista
   secundaria y no el detalle principal. El requisito operativo del
   servicio es que el técnico vea de inmediato solicitante, servicio,
   área, prioridad, estado, técnico asignado y fechas.
2. **Autenticación de imágenes — P2.** El componente `<img>` no sabe
   adjuntar el JWT. La ruta `/uploads/*` está montada en `ticket-service`
   detrás de `verifyJwt`, pero el gateway no la expone al navegador y el
   navegador tampoco podría autenticarse aunque estuviera expuesta.
   Además, las URLs internas de Docker (`http://ticket-service:...`,
   `http://sd-ticket:...`) no son resolubles desde un navegador, lo que
   descarta cualquier "solución" que se limite a devolver la URL interna.

## 4. Causa raíz

- **P1.** La tarjeta de ticket entregaba el detalle a través de un botón
  secundario con el rótulo *"Ver historial"*. El detalle completo estaba
  disponible en el mismo modal, pero enterrado tras la línea de tiempo.
- **P2.** El backend serializaba los adjuntos con `imageUrl`
  relativa a `/uploads/…`; el frontend consumía esa URL con un `<img>`
  simple. Faltaba un mecanismo autenticado — accesible desde el navegador
  a través del gateway — para servir el binario preservando: JWT,
  ownership del ticket y Content-Type real.

## 5. Solución implementada

### 5.1 Backend — endpoint autenticado para servir el binario

Se añadió el endpoint

```
GET /tickets/:id/attachments/:attachmentId
```

en [ticket-service/src/routes/ticketRoutes.ts:788](../../../ticket-service/src/routes/ticketRoutes.ts#L788).

Comportamiento:

- Middleware `verifyJwt` obligatorio (401 sin token válido).
- Autorización: dueño del ticket, técnico (`role.startsWith("tech_")`) o
  admin. Otros usuarios → **403** sin consultar el adjunto.
- El adjunto debe existir y su `ticketId` debe coincidir con el `:id` de
  la ruta. Un adjunto de otro ticket → **403** (no se filtra existencia).
- Adjuntos `storageProvider = 'cloudinary'` → **302** al `secure_url`
  (URL pública del CDN); el binario no fluye por el gateway.
- Adjuntos locales:
  - Se toma únicamente el `path.basename` del `filePath`/`imageUrl`
    persistido, se rechazan nombres con `..` o que empiezan con `.`.
  - Se resuelve el path absoluto contra `env.uploadDir` y se verifica
    que el resultado esté dentro de ese directorio (defensa contra path
    traversal).
  - Si el archivo físico no existe → **404** legible.
  - Se aplica `Content-Type` real (`image/png`, `image/jpeg`, …) desde
    `attachment.mimeType`, con fallback a `application/octet-stream`.
    Nunca se responde `text/html`.
  - `X-Content-Type-Options: nosniff` y `Cache-Control: private,
    max-age=300`.
  - Streaming con `res.sendFile` — no se carga el binario a memoria.

### 5.2 Backend — serializador de attachments

Nueva función `serializeAttachment` en
[ticket-service/src/services/storageService.ts:186](../../../ticket-service/src/services/storageService.ts#L186):

- Si el adjunto es Cloudinary (`imageUrl` absoluto `https://…`), se
  devuelve tal cual — el navegador puede consumirlo directamente.
- Si el adjunto es local, se reescribe la URL a
  `/api/tickets/{ticketId}/attachments/{a.id}`. El frontend **jamás**
  recibe `/uploads/…` ni URLs internas de Docker.

Se aplicó a las respuestas de:

- `GET /tickets/history/:id` — [ticket-service/src/routes/ticketRoutes.ts:746](../../../ticket-service/src/routes/ticketRoutes.ts#L746)
- `GET /tickets/:id` — [ticket-service/src/routes/ticketRoutes.ts:880](../../../ticket-service/src/routes/ticketRoutes.ts#L880)

Estos son los endpoints que actualmente alimentan al modal de detalle e
historia (único punto donde se renderizan miniaturas).

### 5.3 Frontend — componente `AuthenticatedImage`

Nuevo en [frontend/src/components/AuthenticatedImage.tsx](../../../frontend/src/components/AuthenticatedImage.tsx).

- Si `src` es absoluta (Cloudinary), usa `<img src>` directo con `onError`
  legible.
- Si `src` es relativa (endpoint del gateway), hace `api.get(src, {
  responseType: "blob", signal })`, obtiene el binario con el JWT que
  ya inyecta el interceptor de Axios, y crea un `URL.createObjectURL(blob)`
  para pintar `<img src={blob}>`. Al desmontar revoca el object URL para
  no filtrar memoria.
- Usa `AbortController` (patrón consistente con Sprint E) para cancelar la
  descarga si se cierra el modal antes de terminar.
- Estados claramente diferenciados: *"Cargando imagen…"*, *"No se pudo
  cargar la imagen"*, *"Sin imagen"* — desaparece el texto *"No disponible"*
  del código.

### 5.4 Frontend — detalle completo en el modal

En [frontend/src/components/TicketHistoryModal.tsx](../../../frontend/src/components/TicketHistoryModal.tsx):

- Antes del historial se renderiza un bloque *Detalle del ticket* con
  número, servicio, solicitante, área, prioridad, estado, técnico
  asignado y fechas (creación / aceptación / resolución). Si hay
  `resolutionSummary`, se muestra resaltado.
- La galería de adjuntos y el lightbox se pintan con `<AuthenticatedImage>`.

### 5.5 Frontend — tarjeta clicable

- **MisTicketsAceptados** — la tarjeta completa abre el detalle
  ([frontend/src/pages/MisTicketsAceptados.tsx](../../../frontend/src/pages/MisTicketsAceptados.tsx)):
  `role="button"`, `tabIndex=0`, teclado (Enter / Space) y cursor pointer;
  los botones de acción (Aportar, Reescalar, Dar de alta / Resolver, Ver
  detalle) usan `stopPropagation` para no disparar el modal por accidente.
  El botón secundario pasó de *"Ver historial"* a *"Ver detalle"* para
  coincidir con el flujo P1.
- **PanelTecnicoV2** — la fila de un ticket disponible también abre el
  mismo modal ([frontend/src/pages/PanelTecnicoV2.tsx](../../../frontend/src/pages/PanelTecnicoV2.tsx));
  se añadió un botón "Ver detalle" junto a "Aceptar" y ambos usan
  `stopPropagation`.

### 5.6 Infra

- Ningún cambio en el gateway, nginx del VPS ni Docker. El endpoint nuevo
  ya cae bajo el prefijo `/api/tickets/*` que ya está proxeado hacia
  `ticket-service` (`api-gateway/src/app.ts:122`).
- La ruta estática `/uploads/*` sigue montada en `ticket-service` como
  fallback interno pero deja de aparecer en respuestas al frontend.
- No se movieron archivos existentes, no se regeneraron adjuntos, no se
  usa Base64 en ningún punto, no se creó una ruta pública. **No se cambió
  el motor de base de datos.**

## 6. Seguridad

- Autenticación: `verifyJwt` obligatorio.
- Autorización: mismas reglas que `GET /tickets/:id` — dueño, técnico
  (`tech_*`), o admin. Cualquier otro rol/usuario → 403.
- Ownership del adjunto: se verifica que `attachment.ticketId ===
  ticketId` de la URL antes de servir el binario.
- Path traversal:
  - `path.basename` sobre el valor persistido.
  - Rechazo explícito de `..` y de nombres que empiezan con `.`.
  - `path.resolve(env.uploadDir, safeName)` y comprobación de que el
    resultado empieza por `path.resolve(env.uploadDir)`.
- Content-Type: se toma del `mimeType` guardado y se restringe a
  `image/*`; en caso contrario se cae a `application/octet-stream`. El
  header `X-Content-Type-Options: nosniff` bloquea reinterpretación por
  el navegador.
- Cache: `private, max-age=300` — el navegador puede cachear, ningún
  proxy compartido lo hará.
- No se expone la ruta interna del contenedor, ni URLs con nombre de
  servicio Docker, ni identificadores internos que faciliten
  enumeración.
- Cloudinary: el redirect 302 preserva la naturaleza pública del CDN sin
  hacer streaming del binario a través del gateway.

## 7. Pruebas

### 7.1 Nuevas — endpoint `/tickets/:id/attachments/:attachmentId`

`ticket-service/tests/ticketAttachmentServe.test.ts` (11 casos, `PASS`):

| # | Caso | Resultado esperado |
|---|------|--------------------|
| 1 | Sin `Authorization` | 401 |
| 2 | Ticket inexistente | 404 |
| 3 | Usuario no dueño y no staff | 403 (sin tocar el adjunto) |
| 4 | Dueño con adjunto local | 200 + `image/png` + bytes exactos + `nosniff` + `Cache-Control: private` |
| 5 | Técnico (`tech_n1`) sobre ticket ajeno | 200 |
| 6 | Admin sobre ticket ajeno | 200 |
| 7 | Adjunto inexistente | 404 |
| 8 | Adjunto pertenece a otro ticket | 403 |
| 9 | Archivo físico ausente | 404 |
| 10 | Adjunto Cloudinary | 302 al `secure_url` |
| 11 | `filePath` con `../../etc/passwd` | 400/404 sin acceso a disco |

### 7.2 Regresión

- `auth-service`: 26/26 tests `PASS`
- `catalog-service`: 52/52 tests `PASS`
- `ticket-service`: 215/215 tests `PASS` (baseline 204 + 11 nuevos)

Total: **293/293** tests `PASS`.

### 7.3 Frontend

- `npx tsc --noEmit` → `EXIT 0`
- `npm run build` (Vite 5) → build exitoso.

### 7.4 Smoke esperado en el navegador

El navegador debe:
1. En *Mis Aceptados*, poder abrir el detalle haciendo click en cualquier
   parte de la tarjeta (no solo en el botón "Ver detalle").
2. Ver el bloque *"Detalle del ticket"* con todos los campos en el modal.
3. Ver las miniaturas cargarse con estado *"Cargando imagen…"* y luego
   la imagen real; abrir el lightbox con click.
4. En DevTools · Network verificar que la petición a
   `/api/tickets/<id>/attachments/<aid>` viaja con `Authorization:
   Bearer …`, responde `200 image/png` (o `image/jpeg`) y el binario
   coincide con lo subido.

## 8. Resultado

- El detalle completo del ticket queda accesible con un solo click sobre
  la tarjeta, en línea con el flujo pedido en P1.
- Las imágenes adjuntas ya no aparecen como *"No disponible"*: se
  cargan desde el navegador contra un endpoint autenticado del gateway,
  con `Content-Type` correcto, con validación de rol/ownership/pertenencia
  al ticket y con defensas de path traversal.
- Cloudinary (adjuntos con URL absoluta pública) sigue funcionando sin
  cambios; el mismo componente frontend cubre ambos casos.

## 9. Archivos modificados / creados

Nuevos:

- `frontend/src/components/AuthenticatedImage.tsx` — componente que
  descarga el binario con JWT y lo pinta vía blob URL.
- `ticket-service/tests/ticketAttachmentServe.test.ts` — 11 tests.

Modificados:

- `ticket-service/src/routes/ticketRoutes.ts` — endpoint autenticado +
  serialización de adjuntos en `/tickets/history/:id` y `/tickets/:id`.
- `ticket-service/src/services/storageService.ts` — `serializeAttachment`
  (reescritura de URL local a endpoint autenticado, respetando
  Cloudinary).
- `frontend/src/components/TicketHistoryModal.tsx` — bloque *Detalle del
  ticket* + galería/lightbox con `AuthenticatedImage`.
- `frontend/src/pages/MisTicketsAceptados.tsx` — tarjeta clicable +
  `stopPropagation` en botones + rótulo "Ver detalle".
- `frontend/src/pages/PanelTecnicoV2.tsx` — fila clicable + botón "Ver
  detalle" + integración del modal.

## 10. Pendientes

- **Despliegue al VPS.** Esta fase no ejecuta acciones remotas. El VPS
  no se toca todavía.
- Otros endpoints (`/tickets/my`, `/tickets/available`, `/tickets/accepted`,
  `/tickets/my-assigned`) siguen devolviendo `attachments` sin serializar;
  hoy es aceptable porque esas vistas no pintan miniaturas (solo el modal
  lo hace). Queda como mejora de consistencia futura pasarlas también por
  `serializeAttachment` para evitar cualquier fuga accidental de la URL
  interna si un consumidor futuro decide renderizar la imagen.
- Cobertura E2E automatizada (Playwright / Cypress) del flujo:
  crear ticket con imagen → aceptar → abrir detalle → verificar carga
  del binario contra el endpoint autenticado. Actualmente se cubre con
  smoke manual + los 11 tests unitarios/integración del endpoint.

## 11. Plan de despliegue al VPS (no ejecutado)

Se conserva la misma mecánica que en Fase K (SQL Server 2022 en el VPS,
Postgres detenido como rollback). El despliegue de esta fase es
`code-only`: no requiere migración de esquema Prisma ni cambios de
volúmenes.

Pasos previstos, para ejecutar solo tras aprobación explícita:

1. `git status && git diff` sobre las rutas listadas en §9 antes de
   commitear, para confirmar que ningún archivo con secretos (por
   ejemplo `.env`, `.env.mssql`, `.env.uta`) entra al commit.
2. Commit local sobre `Develop`, empujar a origen.
3. En el VPS (SSH puerto 2222 según manual de fases previas):
   1. `git pull` en `/opt/servicedesk-uta`.
   2. Reconstruir únicamente los servicios afectados:
      - `docker compose -f docker-compose.prod-mssql.yml build ticket-service frontend`
      - `docker compose -f docker-compose.prod-mssql.yml up -d ticket-service frontend`
   3. `docker compose ps` para confirmar `healthy`.
4. Smoke sobre `https://servicedesk-uta.site`:
   - Login como técnico → abrir *Mis Aceptados* → click en tarjeta →
     verificar detalle completo.
   - Verificar carga de imagen adjunta (mostrar en el modal y en el
     lightbox).
   - Revisar `docker compose logs ticket-service --tail=200` en busca de
     errores `401/403/404` inesperados.

No se ejecuta ninguno de estos pasos hasta autorización explícita, según
regla de la fase ("NO COMMIT. NO PUSH.").

---

> Ninguna credencial, JWT, secret de FCM, credencial SMTP, token o
> connection string aparece en este documento.
