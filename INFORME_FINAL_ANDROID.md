# Informe final — Aplicación Android (ServiceDesk UTA)

**Fecha:** 2026-11-15 · **App ID:** `ec.uta.servicedesk` · **Capacitor:** 8.5 · **Estado global:** compilada y verificada estáticamente en local; **NOT TESTED en dispositivo físico**.

Categorías: PASS · FAIL · BLOCKED · NOT TESTED. Todo lo marcado PASS se comprobó en este equipo (build, contenido del APK, tests de la lógica compartida), nunca en un teléfono.

## 1. Qué contiene la aplicación

- Bundle web de la SPA (React + Vite) empaquetado dentro del APK; la API es remota (`VITE_API_URL` en tiempo de compilación). `androidScheme: https`, `allowMixedContent: false`.
- Plugins Capacitor: `@capacitor/app` (deep links), `@capacitor/browser` (SSO en Chrome Custom Tabs), `@capacitor/preferences` (token FCM local), `@capacitor/push-notifications` (FCM).
- Firebase Cloud Messaging con `google-services.json` **fuera de Git** (ignorado; el plugin `google-services` solo se aplica si el archivo existe en el equipo que compila).
- Manifest: `allowBackup=false`, `launchMode=singleTask`, intent-filter `ec.uta.servicedesk://auth` para el callback SSO, canal de notificaciones `servicedesk_tickets`, permisos INTERNET, POST_NOTIFICATIONS, VIBRATE, WAKE_LOCK.

## 2. APK generado

| Dato | Valor |
|---|---|
| Ruta | `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (ignorado por Git) |
| Tipo | **debug** (`debuggable=true`, keystore de depuración) — **no distribuible** |
| versionCode / versionName | 2 / 1.1 (el APK del 15-sep era 1 / 1.0) |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |
| Toolchain | JDK 21 (`C:/Program Files/Java/jdk-21.0.10`), Gradle 8.14.3, AGP 8.13, Firebase BoM 33.3 |
| API compilada | `https://servicedesk-uta.site` (dominio del VPS actual) |
| Comprobado con `aapt2` | package, versionCode 2, `allowBackup=false`, esquema `ec.uta.servicedesk` |
| Comprobado en el bundle | `sd_sso_verifier` (verificador PKCE), `createObjectURL` (imágenes autenticadas), 0 apariciones de `/uploads/` y de `localhost:8080` |

Nota de entorno: `JAVA_HOME` del equipo apunta a JDK 25, con el que Gradle 8.14 no arranca; la compilación se hizo exportando JDK 21. Documentado para quien repita la compilación.

## 3. Funcionalidades y su estado

| Función | Implementación | Estado |
|---|---|---|
| Login local | misma SPA y API que la web | NOT TESTED en dispositivo (PASS en web/lab) |
| Microsoft SSO real | `Browser.open` → `/api/auth/microsoft?client=android&cc=<reto>`; callback `ec.uta.servicedesk://auth/success?code=…`; canje `POST /api/auth/sso/exchange { code, verifier }` | NOT TESTED en dispositivo; lógica cubierta por tests (auth 97, frontend `ssoPkce`) |
| Verificador tipo PKCE | el código de un solo uso queda ligado al SHA-256 del verificador generado por la app; otra app que capture el enlace no puede canjearlo | PASS (tests) |
| Sesiones / logout | JWT en `localStorage` del WebView; logout revoca en auth-service y da de baja el token FCM | NOT TESTED en dispositivo |
| Deep links | `appUrlOpen` (SSO) y notificaciones → `/tickets/:id`; destino validado (`lib/deepLink.ts`, solo rutas internas) | PASS (tests); NOT TESTED en dispositivo |
| FCM | registro `POST /api/notifications/register` (token ≤ 512), invalidación al logout, tokens inválidos desactivados al enviar | PASS (tests `fcmService`, `notificationRoutes`); recepción real NOT TESTED |
| Imágenes / lightbox | `AuthenticatedImage` (fetch con JWT → blob → Object URL) | PASS en navegador headless (12-nov); NOT TESTED en dispositivo |
| Aceptación digital | mismo modal que la web (términos, casilla, aceptar/rechazar) | PASS en navegador headless; NOT TESTED en dispositivo |

## 4. Prueba física pendiente (checklist)

1. Instalar el APK (`adb install -r app-debug.apk`) en un teléfono con Android 7+.
2. Abrir la app; comprobar que carga la pantalla de login sin errores de certificado ni contenido mixto.
3. Login local con una cuenta de prueba.
4. "Iniciar sesión con Microsoft": se abre Chrome Custom Tabs, se autentica en el tenant institucional, vuelve a la app y entra (requiere el Redirect URI registrado en Azure para el dominio usado al compilar).
5. Mis tickets / Mis aceptados: miniaturas cargan (sin "No se pudo cargar la imagen"); lightbox abre la imagen ampliada.
6. Aceptar una solución (casilla obligatoria) y rechazar otra (motivo obligatorio): aparecen los códigos de constancia `VD-…`.
7. Push: con la app en segundo plano, crear/resolver un ticket desde la web y comprobar la notificación (canal `servicedesk_tickets`); al tocarla se abre el ticket.
8. Cerrar sesión: el token FCM queda inactivo (`GET /api/notifications/devices`).

Sin un dispositivo disponible en este equipo, los ocho puntos quedan **NOT TESTED**.

## 5. Reconstrucción para el dominio definitivo

```bash
cd frontend
VITE_API_URL=https://<dominio-nuevo> npm run build
npx cap sync android
cd android
JAVA_HOME="C:/Program Files/Java/jdk-21.0.10" ./gradlew assembleDebug      # pruebas
```

Antes: registrar en Azure la Redirect URI `https://<dominio-nuevo>/auth/callback` (misma convención que el VPS) y mantener `google-services.json` del proyecto Firebase en `frontend/android/app/` (nunca en Git).

## 6. Versión de distribución (release)

Pendiente de una **keystore de release** custodiada por la institución (fuera del repositorio; `*.keystore`/`*.jks` están ignorados). Pasos cuando exista: `signingConfigs.release` en `app/build.gradle` leyendo ruta y contraseñas de `~/.gradle/gradle.properties` o variables de entorno; `./gradlew assembleRelease` (o `bundleRelease` para Play); conservar el `.apk`/`.aab` y su SHA-256 junto al número de versión. Valorar `minifyEnabled true` con R8 solo tras probar que el WebView y los plugins siguen funcionando.

## 7. Riesgos y recomendaciones

- No distribuir el APK de depuración.
- Cada cambio de dominio exige recompilar: la API no es configurable en tiempo de ejecución (decisión de diseño: bundle offline + API remota).
- Las reglas de autorización son las del backend; la app no añade ni quita permisos.
- La prioridad alta de FCM no evita las restricciones de ahorro de batería del sistema ni el permiso de notificaciones del usuario (Android 13+): la app los solicita, no los elude.
