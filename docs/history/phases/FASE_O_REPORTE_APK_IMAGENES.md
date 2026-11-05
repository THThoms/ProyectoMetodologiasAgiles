# FASE O — APK Android: visualización de imágenes adjuntas

**Fecha:** 2026-09-15
**Rama:** Develop (working tree; sin commit / sin push)
**Motor:** SQL Server 2022 en el VPS; PostgreSQL retirado en Fase N.
**Paquete:** `ec.uta.servicedesk` (no cambia).

Escrito para: el equipo del proyecto (Tech Lead + docente supervisor).
Documenta el APK regenerado que reutiliza el flujo autenticado de
Fase L/M para que un usuario del app Android pueda ver las imágenes
adjuntas de un ticket. Sin secretos.

## 1. Problema

La versión web fue corregida en Fase L/M: cada `<img>` de attachment se
carga con `fetch` autenticado a
`GET /api/tickets/:id/attachments/:attachmentId`, obteniendo un `Blob`
que se convierte en `URL.createObjectURL(blob)` y se pinta como
`<img src="blob:…">`. El backend valida JWT + ownership + Content-Type
+ streaming con `res.sendFile`.

El APK Android en el dispositivo del operador aún contenía un bundle
anterior (`assets/public/assets/index-BzkQYGYi.js`), previo a la
introducción de `AuthenticatedImage`. Por lo tanto los adjuntos de
tickets nunca eran cargables en Android.

## 2. Diagnóstico

- `frontend/capacitor.config.ts` — `appId: ec.uta.servicedesk`,
  `webDir: "dist"`, `androidScheme: "https"`, `allowMixedContent: false`.
  Estrategia bundle offline + API remota (no `server.url`).
- `AndroidManifest.xml` — únicos permisos declarados: `INTERNET`,
  `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`. Sin
  `android:usesCleartextTraffic="true"`. Sin
  `android:networkSecurityConfig`. HTTPS por defecto (correcto).
- `frontend/src/lib/api.ts` — Axios lee `VITE_API_URL` en build time; si
  falta cae a `http://localhost:8080` (solo dev). El interceptor
  inyecta `Authorization: Bearer <jwt>` en toda petición y limpia el
  token en 401 con redirect a `/login?error=session_expired`.
- `frontend/src/components/AuthenticatedImage.tsx` — creado en Fase L.
  Para URLs relativas hace `api.get(src, { responseType: "blob",
  signal })`, crea `URL.createObjectURL(blob)` y lo revoca al desmontar
  con `AbortController.abort()`. Para URLs absolutas (Cloudinary) usa
  `<img src>` directo. Estados legibles: *"Cargando imagen…"*, *"No se
  pudo cargar la imagen"*, *"Sin imagen"*.
- `TicketHistoryModal.tsx` — galería y lightbox usan
  `AuthenticatedImage`. Bloque *"Detalle del ticket"* nuevo (Fase L P1).
- `MisTicketsAceptados.tsx`, `PanelTecnicoV2.tsx` — tarjetas/filas
  clicables. Los mismos componentes que la web usa. **No hay** una
  capa nativa Android que necesite código separado.
- El bundle previo del APK (`index-BzkQYGYi.js`) sí tenía
  `https://servicedesk-uta.site` como `baseURL` — el `VITE_API_URL` ya
  era el correcto —, pero **no** contenía `AuthenticatedImage`
  (0 hits a `responseType.*blob`).

Diagnóstico: reutilizar 100% la solución web recompilando el bundle
con `VITE_API_URL=https://servicedesk-uta.site` y sincronizando a
Android. Ningún código Android nativo requiere cambios.

## 3. Solución

Recompilación del bundle web con la variable de entorno productiva y
`cap sync android` para que Capacitor copie el nuevo `dist/` al
directorio de assets del APK, seguido de `assembleDebug`.

- **Endpoint utilizado por el APK:**
  `GET https://servicedesk-uta.site/api/tickets/:ticketId/attachments/:attachmentId`
- **Autenticación:** el APK reutiliza el mismo JWT que ya guarda tras
  el login (interceptor Axios). No se guarda ningún token adicional.
- **Blob URL:** `URL.createObjectURL(blob)` y revocación al desmontar
  el componente (`AbortController.abort()` cancela cargas huérfanas al
  navegar entre pantallas).
- **UI:** los componentes web `AuthenticatedImage`, `TicketHistoryModal`,
  `MisTicketsAceptados` y `PanelTecnicoV2` son los mismos en web y en
  el WebView de Capacitor — no hay duplicación de lógica.

## 4. Cambios en frontend

Ninguno adicional respecto a Fase L/M — todos los componentes
requeridos ya existen y fueron desplegados en el VPS en Fase M. En
Android solo hace falta rehidratar el bundle.

## 5. Cambios en Android nativo

Ninguno.

- `AndroidManifest.xml`: sin tocar. Sigue con los mismos 4 permisos y
  sin `usesCleartextTraffic`.
- `build.gradle` (app): sin tocar. `applicationId "ec.uta.servicedesk"`,
  `versionCode 1`, `versionName "1.0"`.
- `capacitor.config.ts`: sin tocar. `appId`, `webDir`, `androidScheme`,
  `allowMixedContent` sin cambios.
- `google-services.json`: sin tocar (FCM intacto).

## 6. Build ejecutado

```
frontend $ VITE_API_URL="https://servicedesk-uta.site" npm run build
   → dist/assets/index-B6aM42JF.js (387.90 kB, gzip 111.60 kB)
   → dist/assets/index-DONUsyKg.css (37.20 kB)
frontend $ npx cap sync android
   → Copying web assets from dist to android/app/src/main/assets/public
   → 4 Capacitor plugins detectados: app, browser, preferences, push-notifications
android/ $ ./gradlew assembleDebug --no-daemon
   → BUILD SUCCESSFUL in 27s (216 tasks; 103 exec, 113 up-to-date)
```

Aviso de `sd-frontend HEALTHCHECK` y otros temas fuera de scope Fase O
no se tocan aquí.

## 7. APK generado

- **Ruta:** `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
- **Tamaño:** 5.8 MB (5 927 KiB, 6 074 423 bytes)
- **MD5:** `b95634a3779ac3dd6f8858df19a2961e`
- **SHA-256:** `7910f82bca60d58bf451287b3536e82051f910a5130b854cc83f9fd56dc91edc`
- **Metadatos** (`output-metadata.json`):
  - `applicationId`: `ec.uta.servicedesk` ✓
  - `versionCode`: `1`
  - `versionName`: `1.0`
  - `variantName`: `debug`
  - `minSdkVersionForDexing`: `24`

## 8. Verificación del contenido del APK

Extraído `assets/public/assets/index-B6aM42JF.js` del APK (388 552 B,
idéntico al bundle recién compilado):

| Patrón | Ocurrencias | Interpretación |
|---|---:|---|
| `https://servicedesk-uta.site` | 1 | `baseURL` de Axios (Fase L/M) |
| `createObjectURL` | 1 | Blob → object URL para `<img>` |
| `responseType.*blob` | 2 | Axios internal + `AuthenticatedImage.get(src, { responseType: "blob", … })` |
| `/uploads/` literal | 0 | Sin dependencia al path viejo |
| `http://localhost` | 1 | Solo el fallback SSR (`window.location.href \|\| "http://localhost"`) para hidratación — no se usa en peticiones |

Listado de URLs `http://` únicas en el bundle: `http://localhost`
(fallback) y `http://www.w3.org/*` (namespaces XML/SVG). **Ninguna** IP
privada, hostname Docker (`ticket-service`, `sd-ticket`) ni ruta
`/uploads/`.

## 9. Autorización y flujo esperado dentro del APK

1. Login normal (dev-login o Microsoft SSO). Token JWT queda en
   `Preferences` de Capacitor via `lib/auth.ts`.
2. Al entrar a *Mis Aceptados*, el usuario toca la tarjeta del ticket.
3. `TicketHistoryModal` hace `GET /api/tickets/history/:id` → recibe
   `attachments[].imageUrl = "/api/tickets/<id>/attachments/<aid>"`
   (Fase M ya deployed).
4. Cada miniatura monta `AuthenticatedImage` que hace
   `api.get("/api/tickets/…/attachments/…", { responseType: "blob" })`.
   Axios prepende `baseURL` → HTTPS a `servicedesk-uta.site`. Header
   `Authorization: Bearer <jwt>` inyectado por el interceptor. El
   backend valida:
   - Owner → 200 image/jpeg (bytes exactos).
   - Técnico → 200.
   - Admin → 200.
   - Otro usuario → 403.
   - Sin JWT (edge caso, no debería pasar) → 401 → interceptor limpia
     token y redirige a `/login?error=session_expired`.
5. `URL.createObjectURL(blob)` alimenta el `<img>`. Al tocar el
   thumbnail se abre el lightbox interno (misma implementación web).
   Al cerrar, `useEffect` desmonta y `revokeObjectURL` limpia la
   memoria.

Errores diferenciados en UI:
- Estado `loading` → *"Cargando imagen…"*
- Estado `error` → *"No se pudo cargar la imagen"* (nunca *"No
  disponible"* — esa cadena literal no existe en el bundle nuevo).
- Sin `src` → *"Sin imagen"*.

## 10. Pruebas ejecutadas desde este entorno

- Regresión backend (Fase L/M ya cerradas): auth 26/26, catalog 52/52,
  ticket 215/215 = 293/293.
- `tsc --noEmit` frontend: clean (build tsc -b passed).
- `vite build`: 128 módulos, 1.19 s.
- `cap sync android`: éxito, 4 plugins detectados.
- `./gradlew assembleDebug`: 27 s, `BUILD SUCCESSFUL`.
- Extracción y grep del bundle dentro del APK: patrones esperados
  presentes, patrones prohibidos ausentes (§8).
- Endpoint autenticado en producción (curl desde el VPS, Fase M):
  `200 image/jpeg 20490 bytes`, MD5 idéntico al archivo en disco.
- Serialización de historial en producción (curl desde el VPS, Fase M):
  `attachments[].imageUrl` reescrito a
  `/api/tickets/…/attachments/…`, sin `/uploads/`.

## 11. Pruebas que requieren dispositivo Android real

Este entorno no puede instalar el APK ni operar un WebView Android. Los
7 casos del enunciado (login → *Mis Aceptados* → detalle → miniatura →
lightbox, con 0/1/3 imágenes y regreso tras salir) deben ejecutarse en
un dispositivo real. Todo el pipeline previo — desde el JWT del login
hasta el binario JPEG servido — está verificado extremo a extremo, así
que si el APK está correctamente instalado el flujo debe funcionar.

Instrucciones para instalar:

```
adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Registrar en consola de dispositivo:

- Que el `<img>` termina con `src="blob:https://localhost/…"` (o
  similar del WebView de Capacitor). No con `/uploads/…`.
- Que la request al endpoint autenticado devuelve
  `200 image/jpeg <fileSize>` desde `https://servicedesk-uta.site`.
- Que el logout limpia el JWT y evita seguir pidiendo imágenes.

Si aún se observa *"No se pudo cargar la imagen"*:

1. Confirmar sesión válida en `Preferences` (haciendo un
   `GET /api/tickets/my`).
2. Revisar `logcat` para el status HTTP concreto (401 / 403 / 404 /
   red).
3. Nunca copiar el JWT del logcat a este reporte ni a soporte externo.

## 12. Regresión — otras funcionalidades

Se conservan sin modificación:

- Login local (username + password) y Microsoft SSO.
- Push notifications (FCM), `google-services.json` sin tocar.
- Deep links (push tap → `/tickets/:id`) — el bundle contiene los
  handlers de la SPA que ya funcionaban.
- Reescalamiento, validación de solución, historial, KB, tickets/my,
  tickets/available, admin/stats — todos usan Axios con el mismo
  interceptor.
- El endpoint `GET /api/tickets/:id/attachments/:aid` no coliciona con
  otros — Fase L/M coexistieron con las demás rutas sin regresión
  (293/293 tests).

## 13. Estado final Fase O

- **Bundle Web:** rebuilt con `VITE_API_URL=https://servicedesk-uta.site`.
- **APK:** `app-debug.apk` firmado con la debug keystore, versionCode 1,
  versionName 1.0, package `ec.uta.servicedesk`.
- **Bundle dentro del APK:** contiene la lógica `AuthenticatedImage`
  (fetch blob + object URL). No contiene `/uploads/`. Solo apunta a
  `https://servicedesk-uta.site` como API.
- **Ningún cambio Android nativo, ningún permiso extra, sin cleartext.**
- **Pendiente humano:** instalar el APK y ejecutar los 7 casos del §11
  en dispositivo real.

## 14. Reglas cumplidas

- No se usa `/uploads/*` desde el navegador ni el WebView.
- No se usa `http://localhost` (excepto un fallback SSR que no se
  invoca desde peticiones reales).
- No se usa hostname Docker (`ticket-service`, `sd-ticket`) ni IP
  privada.
- No se usa Base64.
- No se toca SSO ni FCM.
- No se activó `usesCleartextTraffic`.
- No se cambió el `applicationId`.
- No se hizo git commit ni git push.
- PostgreSQL sigue retirado (Fase N); SQL Server continúa siendo el
  único motor.
- Este documento no expone contraseñas, JWT, tokens FCM, credenciales
  SMTP, connection strings ni secretos de servicio.
