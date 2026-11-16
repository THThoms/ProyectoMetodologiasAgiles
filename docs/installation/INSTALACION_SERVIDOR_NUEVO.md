# Instalación de ServiceDesk UTA en un servidor nuevo

Escrito para: la persona que instalará el sistema **a mano** en un servidor Ubuntu nuevo.
No hace falta conocer el proyecto. Cada paso indica **dónde** se ejecuta y **qué** debe verse.

> Antes de empezar, lee `REQUISITOS_NUEVO_SERVIDOR.md` y `CONFIGURACION_PRODUCCION.md`.
> Ten decididos: **dominio**, **edición de SQL Server** (`MSSQL_PID`), **modo** (limpio o
> restauración) y **destino de la copia externa** de backups.

Convenciones: `$` = usuario normal con sudo · `#` = root. Directorio de instalación: `/opt/servicedesk`.

---

## 0. Decide el modo

| | **MODO A — instalación limpia** | **MODO B — restauración** |
|---|---|---|
| Cuándo | Sistema nuevo, sin datos | Trasladar los datos de otra instalación (p. ej. el VPS anterior) |
| Datos | Catálogo, ubicaciones y base de conocimiento iniciales + admin inicial | Los de los `.bak` y el `.tar.gz` de imágenes |
| Seeds | Sí, solo en el primer arranque | **Nunca** |
| Comando | `--mode clean` | `--mode restore --from <dir>` |

El instalador **obliga** a elegir uno y no los mezcla: no instala limpio sobre datos existentes y no restaura encima sin `--replace`.

---

## 1. Copiar el paquete y verificar su integridad

En **tu equipo**, carpeta `release/` del repositorio (generada con `scripts/build-server-package.sh <versión>`):

```bash
scp release/servicedesk-uta-server-<VERSION>.tar.gz release/servicedesk-uta-server-<VERSION>.tar.gz.sha256 usuario@SERVIDOR:/tmp/
```

En el **servidor**:

```bash
$ cd /tmp && sha256sum -c servicedesk-uta-server-<VERSION>.tar.gz.sha256
```
Esperado: `servicedesk-uta-server-<VERSION>.tar.gz: OK`. Si dice `FAILED`, **no continúes**: vuelve a copiar el archivo.

---

## 2. Preparar Ubuntu Server 24.04

```bash
# Actualizar y utilidades
$ sudo apt update && sudo apt -y full-upgrade
$ sudo apt -y install ca-certificates curl gnupg rsync openssl nginx certbot ufw
$ sudo timedatectl set-timezone America/Guayaquil

# Usuario administrativo (si el servidor solo trae root)
# adduser admin && usermod -aG sudo admin
```

**SSH** (antes, prueba que tu clave pública funciona con el usuario admin):

```bash
$ sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
$ sudo systemctl reload ssh
```

**Firewall**: lo configura el instalador (paso 3b: UFW con SSH, 80 y 443; con otro puerto SSH, usa `--ssh-port N`). Para hacerlo a mano antes de empezar, o si usas `--skip-firewall`:

```bash
$ sudo ufw allow OpenSSH
$ sudo ufw allow 80/tcp
$ sudo ufw allow 443/tcp
$ sudo ufw enable
$ sudo ufw status
```
Esperado: solo SSH, 80 y 443 en `ALLOW`. **No** abras 1433, 8080 ni 3000: el compose los publica solo en 127.0.0.1.

---

## 3. Instalar Docker Engine y Compose v2 (repositorio oficial)

```bash
$ sudo install -m 0755 -d /etc/apt/keyrings
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
$ sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$ sudo docker version --format '{{.Server.Version}}' && sudo docker compose version
```
Esperado: versión de Docker ≥ 24 y `Docker Compose version v2.x`.

---

## 4. Extraer el paquete

```bash
$ sudo mkdir -p /opt/servicedesk
$ sudo tar -xzf /tmp/servicedesk-uta-server-<VERSION>.tar.gz -C /opt/servicedesk --strip-components=1
$ cd /opt/servicedesk && ls
```
Esperado: `api-gateway auth-service catalog-service deploy docs frontend scripts ticket-service .env.example MANIFEST.md FILES.txt README.md`.

---

## 5. Configurar `deploy/server/.env`

Desde `/opt/servicedesk`:

```bash
$ sudo cp .env.example deploy/server/.env
$ sudo chmod 600 deploy/server/.env
$ sudo nano deploy/server/.env
```

Rellena como mínimo (detalle en `CONFIGURACION_PRODUCCION.md`):

- `PUBLIC_DOMAIN=servicedesk.tu-dominio.edu.ec`
- **Servidor de PRUEBAS (primera instalación):** `SERVER_PURPOSE=pruebas` y `MSSQL_PID=Developer`. Developer tiene licencia solo para desarrollo, evaluación y pruebas.
- **Producción:** `SERVER_PURPOSE=produccion` y `MSSQL_PID=Express` (o la edición con licencia). Con `produccion`, Developer queda **bloqueado** ([CONFIGURACION_SQL_SERVER.md](CONFIGURACION_SQL_SERVER.md))
- `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_NAME` (solo en modo limpio). **No hay ninguna contraseña de admin en el `.env`**: el instalador crea el administrador con una contraseña **temporal** (ver paso 6A.7b)
- SSO de Microsoft (`MICROSOFT_*`, `ADMIN_EMAILS`): paso **5.2**
- Correo electrónico (`EMAIL_SEND_MODE`, `SMTP_*`): paso **5.3**
- Notificaciones push de Android (`FCM_*`): paso **5.4**
- `BACKUP_ALERT_EMAIL` / `BACKUP_ALERT_WEBHOOK_URL`. La copia externa cifrada se configura **aparte**, en `/etc/servicedesk/backup.env` (paso **5.5**)

De dónde sale cada clave o secreto y dónde se pone: paso **5.1**.

Deja **vacías** `MSSQL_SA_PASSWORD`, `*_DB_PASSWORD` y `JWT_SECRET`: el instalador las genera con `--generate-secrets`.

Comprueba la configuración **sin instalar nada**:

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets --dry-run
```
Esperado: la tabla de variables (CONFIGURADA, VACÍA o AUSENTE, nunca valores) y `✔ Configuración válida`. Cada `✘` dice qué corregir.

---

## 5.1 Claves y secretos: de dónde sale cada uno y dónde se pone

Reglas para **todos** los secretos:

- Nunca en Git, en el chat, en un correo ni en una captura o video. Guárdalos en el gestor de contraseñas institucional.
- En el servidor viven en **dos archivos**, ambos `chmod 600` y propiedad de root: `/opt/servicedesk/deploy/server/.env` (aplicación) y `/etc/servicedesk/backup.env` (backups). No los muestres con `cat` delante de nadie.
- En `deploy/server/.env`, escribe los valores que vienen de fuera (Azure, SMTP) **entre comillas simples**: `MICROSOFT_CLIENT_SECRET='valor'`. Así un `$` o un `#` dentro del valor no se interpretan.
- Anota la **fecha de caducidad** de los que caducan (secreto de Azure, contraseña de aplicación de correo, certificados).

| Secreto o clave | Quién lo genera / de dónde se saca | Dónde se pone | Caduca |
|---|---|---|---|
| Contraseñas de SQL Server (`MSSQL_SA_PASSWORD`, `AUTH_/CATALOG_/TICKET_DB_PASSWORD`) | **El instalador** (`--generate-secrets`) | `deploy/server/.env` (lo escribe el instalador) | No |
| `JWT_SECRET` (firma de las sesiones) | **El instalador** (`--generate-secrets`) | `deploy/server/.env` | No. Cambiarlo cierra todas las sesiones |
| Contraseña temporal del administrador inicial | **El instalador** (paso 6A.7b) | `deploy/server/.initial-admin-secret` → leer una vez y **borrar** | Se cambia en el primer login |
| **ID de aplicación (cliente)** de Microsoft | Portal de Azure → *Registros de aplicaciones* → la aplicación → *Información general* (paso 5.2) | `MICROSOFT_CLIENT_ID` | No (no es secreto, pero no lo publiques) |
| **ID de directorio (inquilino / tenant)** | Mismo lugar: *Id. de directorio (inquilino)* | `MICROSOFT_TENANT_ID` | No |
| **Secreto de cliente** de Microsoft | Azure → la aplicación → *Certificados y secretos* → *Nuevo secreto de cliente* → columna **Valor** (paso 5.2) | `MICROSOFT_CLIENT_SECRET` | **Sí** (6, 12 o 24 meses) |
| Contraseña del correo SMTP | El proveedor del correo: DTIC (relay institucional) o la cuenta de Google → *Contraseñas de aplicaciones* (paso 5.3) | `SMTP_PASS` | Según el proveedor |
| Clave privada de Firebase (cuenta de servicio) | Consola de Firebase → *Configuración del proyecto* → *Cuentas de servicio* → *Generar nueva clave privada* (paso 5.4) | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | No, pero se puede revocar |
| `google-services.json` (app Android) | Consola de Firebase → *Configuración del proyecto* → *General* → app Android `ec.uta.servicedesk` → descargar | **En el equipo que compila el APK**: `frontend/android/app/google-services.json`. **No va al servidor** | No |
| Clave de aplicación de Backblaze B2 (`keyID` + `applicationKey`) | Backblaze → *Application Keys* → *Add a New Application Key* limitada al bucket (paso 5.5) | `/etc/servicedesk/backup.env`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Opcional |
| Clave de cifrado de los backups (Restic) | **El script** `sudo scripts/backup/restic-init.sh --generate-password` | `/etc/servicedesk/restic.pass` (600) **y** copia en manos de los dos custodios | No. **Sin ella no se pueden recuperar los backups** |
| Certificado HTTPS | **certbot** (Let's Encrypt), paso 8. No requiere clave de cuenta; solo un correo de aviso | `/etc/letsencrypt/live/<dominio>/` (lo gestiona certbot) | 90 días, se renueva solo |
| Clave SSH del administrador del servidor | En tu equipo: `ssh-keygen -t ed25519` | La parte **pública** en `~/.ssh/authorized_keys` del servidor; la privada nunca sale de tu equipo | No |
| Keystore de firma del APK de distribución | En el equipo de compilación: `keytool -genkeypair -v -keystore servicedesk-release.jks -alias servicedesk -keyalg RSA -keysize 2048 -validity 10000` | Fuera del repositorio, con su contraseña en el gestor institucional | No. **Si se pierde, no se pueden publicar actualizaciones de la app** |

---

## 5.2 Inicio de sesión con Microsoft (Entra ID / Azure)

El sistema usa el inicio de sesión **real** de Microsoft con las cuentas `@uta.edu.ec`. Lo hace quien administra el tenant de la UTA o el **propietario** del registro de la aplicación en Azure. Si ya existe el registro que usaba el VPS anterior, **no crees otro**: añade la dirección del servidor nuevo (paso C) y, recomendado, un secreto nuevo (paso D).

### A. Entrar al registro de la aplicación

1. Abre https://portal.azure.com (o https://entra.microsoft.com) con una cuenta con permisos sobre el tenant de la UTA.
2. Busca **Microsoft Entra ID** → menú **Registros de aplicaciones** (*App registrations*) → pestaña **Todas las aplicaciones** → abre la de ServiceDesk.
3. Si no existe, **Nuevo registro**:
   - Nombre: `ServiceDesk UTA`.
   - *Tipos de cuenta compatibles*: **Solo las cuentas de este directorio organizativo (solo UTA – inquilino único)**. No elijas "cualquier directorio": el sistema desactiva el SSO si el tenant es `common` u `organizations`.
   - *URI de redirección*: plataforma **Web** y la dirección del paso C.
   - **Registrar**.

### B. Copiar el ID de cliente y el ID de tenant

En **Información general** (*Overview*) de la aplicación:

| En Azure | Variable en `deploy/server/.env` |
|---|---|
| **Id. de aplicación (cliente)** (*Application (client) ID*) | `MICROSOFT_CLIENT_ID` |
| **Id. de directorio (inquilino)** (*Directory (tenant) ID*), un GUID como `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | `MICROSOFT_TENANT_ID` |

`MICROSOFT_TENANT_ID` **debe ser el GUID**, nunca `common`, `organizations` ni `consumers`. Con esos valores el sistema deja el SSO desactivado a propósito, porque aceptaría cuentas de cualquier organización.

### C. Registrar la dirección de retorno (Redirect URI)

1. En la aplicación → **Autenticación** (*Authentication*).
2. En la plataforma **Web** → **Agregar URI**:
   ```
   https://<PUBLIC_DOMAIN>/auth/callback
   ```
   Por ejemplo `https://servicedesk.uta.edu.ec/auth/callback`. Debe ser **exactamente** igual (https, sin barra final) a la que pondrás en `MICROSOFT_REDIRECT_URI`. También es válida `https://<PUBLIC_DOMAIN>/api/auth/microsoft/callback`; usa una sola y la misma en los dos sitios.
3. **No** marques *Tokens de acceso* ni *Tokens de id.* en "Concesión implícita": el sistema usa el flujo de código de autorización con secreto, que no los necesita.
4. **Guardar**.
5. Si el servidor anterior sigue en servicio, **no borres** su URI (`https://servicedesk-uta.site/auth/callback`) hasta terminar la migración: un registro admite varias.

La app Android **no necesita** una URI propia en Azure: abre el inicio de sesión en el navegador del teléfono contra esta misma dirección y el servidor la devuelve a la app.

### D. Crear el secreto de cliente

1. En la aplicación → **Certificados y secretos** (*Certificates & secrets*) → pestaña **Secretos de cliente** → **Nuevo secreto de cliente**.
2. Descripción: `servicedesk-servidor-<año>`. Caducidad: **12 o 24 meses**. **Agregar**.
3. Copia **inmediatamente** la columna **Valor** (*Value*). Azure solo la muestra **una vez**. **No** copies la columna *Id. de secreto*: es el error más común (`AADSTS7000215`).
4. Guarda el valor en el gestor de contraseñas y anota la **fecha de caducidad**. Unas semanas antes de que caduque hay que crear otro y repetir el paso F.

### E. Permisos de la API

1. En la aplicación → **Permisos de API**. Deben estar, de Microsoft Graph, **delegados**: `openid`, `profile`, `email` y `User.Read`. Si falta alguno: **Agregar un permiso → Microsoft Graph → Permisos delegados**.
2. Si la UTA no permite que los usuarios den su propio consentimiento, pulsa **Conceder consentimiento de administrador para UTA** (lo hace un administrador del tenant). Sin eso aparece `AADSTS65001`.

### F. Ponerlo en el servidor

Edita `sudo nano /opt/servicedesk/deploy/server/.env`:

```ini
MICROSOFT_CLIENT_ID='<Id. de aplicación (cliente)>'
MICROSOFT_TENANT_ID='<Id. de directorio (inquilino)>'
MICROSOFT_CLIENT_SECRET='<Valor del secreto de cliente>'
MICROSOFT_REDIRECT_URI='https://<PUBLIC_DOMAIN>/auth/callback'
ALLOWED_DOMAIN=uta.edu.ec
ADMIN_EMAILS=correo.del.administrador@uta.edu.ec
```

- Las **cuatro** `MICROSOFT_*` o ninguna: el instalador rechaza una configuración a medias.
- `ADMIN_EMAILS` (separados por comas) recibe el rol administrador **solo la primera vez** que esa persona entra con Microsoft. El resto entra como usuario y el administrador le asigna el rol (paso 10).
- Con SSO configurado puedes crear el administrador inicial sin contraseña local: `INITIAL_ADMIN_SSO_ONLY=true`.

### G. Comprobar

Después de instalar (o del paso 5.6 si cambias los valores en un servidor ya instalado):

```bash
$ curl -s https://<PUBLIC_DOMAIN>/api/auth/config
```
Esperado: `"ssoConfigured":true`. Después, en el navegador, **Iniciar sesión con Microsoft** con una cuenta `@uta.edu.ec`.

| Error en pantalla | Causa | Solución |
|---|---|---|
| `AADSTS50011` (*redirect URI mismatch*) | La URI de Azure (paso C) no es idéntica a `MICROSOFT_REDIRECT_URI` | Corrige una de las dos: https, dominio y ruta exactos, sin barra final |
| `AADSTS7000215` (*invalid client secret*) | Se copió el *Id. de secreto* en lugar del **Valor**, o el secreto caducó | Crea un secreto nuevo (paso D) y actualízalo (paso 5.6) |
| `AADSTS700016` (*application not found*) | `MICROSOFT_CLIENT_ID` o `MICROSOFT_TENANT_ID` incorrectos | Cópialos de nuevo de *Información general* |
| `AADSTS65001` (*consent required*) | Falta el consentimiento de administrador | Paso E.2 |
| `AADSTS50020` (*user from another tenant*) | La cuenta no es de la UTA | Usa una cuenta `@uta.edu.ec` |
| Vuelve a `/login?error=invalid_state` | El inicio empezó en otro navegador o pasaron más de 10 minutos | Repite desde la pantalla de login, en el mismo navegador |
| Vuelve a `/login?error=domain_not_allowed` | El correo no es del dominio `ALLOWED_DOMAIN` | Cuenta institucional |
| Vuelve a `/login?error=auth_failed` | Error al canjear el código con Microsoft | `sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env logs --tail 50 auth-service` |
| El botón de Microsoft está deshabilitado | `ssoConfigured:false` | Faltan variables, el tenant es `common`, o no se recreó `auth-service` (paso 5.6) |

---

## 5.3 Correo electrónico (notificaciones de tickets)

El sistema envía correos al solicitante cuando su ticket es aceptado, asignado, escalado, recibe una aportación pública, cuando hay una solución que revisar y como recordatorio si no la valida. Cada correo se guarda primero en la base (`email_outbox`). Si el servidor de correo falla, la operación del ticket **no** se deshace: el correo se reintenta solo cada minuto, a los 5 y a los 30 minutos, hasta 3 intentos.

Sin configurar, `EMAIL_SEND_MODE=log`: los correos se registran pero **no se envían**.

### A. Elegir la cuenta de envío

| Opción | Cuándo | Datos que hay que pedir |
|---|---|---|
| **1. Relay SMTP institucional o cuenta de servicio de la UTA** (recomendada en producción) | DTIC ofrece un servidor de correo saliente para sistemas | Servidor, puerto, si usa STARTTLS o SSL, usuario y contraseña (o si autoriza por IP sin credenciales), y la dirección remitente permitida |
| **2. Microsoft 365 de la UTA** (`smtp.office365.com`, 587) | Solo si DTIC habilita *SMTP autenticado* (SMTP AUTH) en el buzón de servicio | Buzón y contraseña. Microsoft está retirando la autenticación básica de SMTP AUTH en Exchange Online, y este sistema envía con usuario y contraseña: **confírmalo con DTIC antes de usarla** |
| **3. Gmail / Google Workspace** (`smtp.gmail.com`, 587) | Cuenta dedicada al sistema (es la que usaba el VPS anterior) | Correo de la cuenta y una **contraseña de aplicación** |

### B. Obtener la contraseña de aplicación (solo opción 3, Gmail)

1. Entra en https://myaccount.google.com con la cuenta del sistema (no una personal).
2. **Seguridad** → activa **Verificación en dos pasos** si no lo está.
3. Busca **Contraseñas de aplicaciones** (o abre https://myaccount.google.com/apppasswords).
4. Nombre de la aplicación: `ServiceDesk UTA` → **Crear**.
5. Copia los 16 caracteres que aparecen (sin espacios). Es el valor de `SMTP_PASS`. Google no vuelve a mostrarla.

La contraseña normal de la cuenta **no** funciona en SMTP; tiene que ser esta.

### C. Ponerlo en el servidor

Edita `sudo nano /opt/servicedesk/deploy/server/.env`. Ejemplo con Gmail:

```ini
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_SEND_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=
SMTP_USER='cuenta.servicedesk@gmail.com'
SMTP_PASS='<contraseña de aplicación de 16 caracteres>'
SMTP_FROM='ServiceDesk UTA <cuenta.servicedesk@gmail.com>'
```

| Variable | Qué poner |
|---|---|
| `SMTP_PORT` / `SMTP_SECURE` | `587` con `SMTP_SECURE=false` (STARTTLS) **o** `465` con `SMTP_SECURE=true` (SSL directo). No mezclar |
| `SMTP_REQUIRE_TLS` | Vacío: el sistema **exige** cifrado siempre que haya usuario y contraseña (nunca las envía en claro). `false` solo para un relay interno sin credenciales y sin TLS |
| `SMTP_FROM` | Con Gmail y Microsoft 365, la **misma** dirección que `SMTP_USER` (si no, el proveedor la cambia o rechaza el correo). Con el relay de DTIC, la que te indiquen |
| `EMAIL_OUTBOX_WORKER_INTERVAL_SEC` | Cada cuántos segundos se reintentan los pendientes (60). `0` = solo reintento manual |
| `VALIDATION_REMINDER_DAYS` | Días sin validar una solución antes de recordárselo al usuario (3). `0` = sin recordatorios |

Ejemplo Microsoft 365: `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER` y `SMTP_FROM` = el buzón de servicio.

### D. Comprobar la conexión (sin enviar ningún correo)

Con el sistema ya instalado (después del paso 6A/6B, o del paso 5.6 si cambiaste el `.env`):

```bash
$ cd /opt/servicedesk
$ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env exec ticket-service node -e '
const s = process.env;
const creds = Boolean(s.SMTP_USER && s.SMTP_PASS);
require("nodemailer").createTransport({
  host: s.SMTP_HOST, port: Number(s.SMTP_PORT || 587), secure: s.SMTP_SECURE === "true",
  requireTLS: s.SMTP_SECURE !== "true" && (s.SMTP_REQUIRE_TLS === "true" || (s.SMTP_REQUIRE_TLS !== "false" && creds)),
  auth: creds ? { user: s.SMTP_USER, pass: s.SMTP_PASS } : undefined,
  connectionTimeout: 10000,
}).verify().then(() => console.log("SMTP OK: conexión y autenticación correctas"))
  .catch((e) => { console.log("SMTP ERROR:", e.message); process.exit(1); });'
```
Esperado: `SMTP OK: conexión y autenticación correctas`. El comando no muestra la contraseña.

| `SMTP ERROR: …` | Causa | Solución |
|---|---|---|
| `Invalid login: 535 …` | Usuario o contraseña incorrectos; en Gmail, se usó la contraseña normal | Contraseña de aplicación (paso B); con Microsoft 365, pedir a DTIC que habilite SMTP AUTH |
| `connect ETIMEDOUT` / `ECONNREFUSED` | Servidor o puerto incorrectos, o el proveedor de hosting bloquea el puerto de salida | Revisa `SMTP_HOST`/`SMTP_PORT`; prueba 587 y 465; consulta al proveedor del servidor |
| `wrong version number`, `Greeting never received` o errores de certificado | Combinación incorrecta de puerto y `SMTP_SECURE` | 587 + `false`, o 465 + `true` |

### E. Comprobar un envío real

1. En la aplicación, haz una acción que envíe correo (por ejemplo, que un técnico acepte un ticket de un usuario de prueba con un correo real).
2. Revisa el estado de los correos (no muestra contraseñas):
   ```bash
   $ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env exec mssql bash -c \
     '/opt/mssql-tools18/bin/sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -h -1 -W -Q "SET NOCOUNT ON; SELECT status, COUNT(*) FROM ticket_db.dbo.email_outbox GROUP BY status"'
   ```
   Esperado: el correo en `sent`. Si queda en `failed`, la causa está en `last_error` y en `… logs --tail 50 ticket-service` (líneas `[email/dispatch] FAIL`).
3. Los correos que agotan los 3 intentos solo se reenvían si el administrador lo pide (`POST /api/admin/email-outbox/process`). El sistema **nunca** reenvía correos ya enviados.

---

## 5.4 Notificaciones push en Android (Firebase)

Opcional; solo si se usará la app Android. Con `FCM_MODE=off` el sistema funciona igual, sin notificaciones push.

### A. Clave del servidor (cuenta de servicio)

1. Abre https://console.firebase.google.com → el proyecto de ServiceDesk.
2. ⚙ **Configuración del proyecto** → pestaña **Cuentas de servicio** → **Generar nueva clave privada** → **Generar clave**. Se descarga un archivo `.json`.
3. Abre el `.json` y copia tres campos:

| Campo del `.json` | Variable en `deploy/server/.env` |
|---|---|
| `project_id` | `FCM_PROJECT_ID` |
| `client_email` | `FCM_CLIENT_EMAIL` |
| `private_key` (completo: desde la línea de inicio *BEGIN PRIVATE KEY* hasta la de fin *END PRIVATE KEY*, incluidos los guiones) | `FCM_PRIVATE_KEY`, **entre comillas dobles** y con los `\n` tal como aparecen en el `.json` |

```ini
FCM_MODE=firebase
FCM_PROJECT_ID=<project_id>
FCM_CLIENT_EMAIL=<client_email>
FCM_PRIVATE_KEY="<valor completo del campo private_key del .json, en una sola línea con sus \n>"
```

4. **Borra el `.json` descargado** (o guárdalo en el gestor de contraseñas). Nunca en el repositorio ni dentro del APK. Si se filtra, revócala en https://console.cloud.google.com → el mismo proyecto → **IAM y administración → Cuentas de servicio** → la cuenta `firebase-adminsdk-…` → pestaña **Claves** → eliminar esa clave, y genera otra.

### B. Archivo de la app Android (no va al servidor)

En la misma consola → **Configuración del proyecto → General** → app Android `ec.uta.servicedesk` → descarga `google-services.json` y colócalo, en el equipo donde se compila el APK, en `frontend/android/app/google-services.json` (está excluido de Git). Ver paso 12.

### C. Comprobar

En los registros de `ticket-service` no debe aparecer `FCM_MODE=firebase pero faltan credenciales`. Con la app instalada y la sesión iniciada en un teléfono, resuelve un ticket de ese usuario: debe llegar la notificación y, al tocarla, abrirse el ticket.

---

## 5.5 Copia externa de los backups (Backblaze B2)

Necesita dos secretos **distintos**, que van en `/etc/servicedesk/backup.env` (no en `deploy/server/.env`):

1. **Clave de aplicación de B2**: Backblaze → **Buckets** → crea un bucket **privado** → **Application Keys** → **Add a New Application Key** → *Allow access to Bucket(s)*: solo ese bucket → copia `keyID` → `AWS_ACCESS_KEY_ID` y `applicationKey` → `AWS_SECRET_ACCESS_KEY` (se muestra una sola vez). Del detalle del bucket copia el **Endpoint** (`B2_S3_ENDPOINT`) y el nombre (`B2_BUCKET`). Nunca la *Master Application Key*.
2. **Clave de cifrado Restic**: no se saca de ningún sitio, la genera el servidor: `sudo scripts/backup/restic-init.sh --generate-password`. Entrégala a los **dos custodios** ([CUSTODIA_CLAVE_BACKUPS.md](../operations/CUSTODIA_CLAVE_BACKUPS.md)).

Procedimiento completo: [CONFIGURACION_BACKBLAZE.md](../operations/CONFIGURACION_BACKBLAZE.md).

---

## 5.6 Cambiar estos valores en un servidor ya instalado

Para añadir o cambiar SSO, correo o Firebase **después** de instalar (o al renovar el secreto de Azure o la contraseña del correo):

```bash
$ cd /opt/servicedesk
$ sudo nano deploy/server/.env                      # cambia solo las variables necesarias
$ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env up -d auth-service ticket-service
$ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps
```

`up -d` recrea solo los contenedores cuya configuración cambió (auth-service para Microsoft; ticket-service para correo y Firebase) sin tocar datos ni volúmenes. Espera a que vuelvan a `healthy` y repite la comprobación del paso 5.2-G, 5.3-D o 5.4-C. **Nunca** uses `down -v`.

---

## 6A. MODO A — Instalación limpia

Desde `/opt/servicedesk`:

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets
```

Qué hace, en orden, y qué verás:

1. **Preflight**: Ubuntu, x86_64, RAM, vCPU, disco, Docker y Compose (`✔` en cada línea).
2. **Configuración**: genera los secretos vacíos (`GENERADA`), valida y pide confirmar la licencia de SQL Server. Escribe `SI`.
3. **Modo**: comprueba que no haya datos previos.
   **3b. Host**: instala `/etc/docker/daemon.json` (rotación de logs, `live-restore`, `no-new-privileges`; si ya existe uno distinto **no lo toca**), configura **UFW** (SSH, 80, 443), endurece **SSH** (sin contraseña, sin root por contraseña) **solo si ya tienes una clave autorizada** y tras validar con `sshd -t`, e instala logrotate. Pide confirmación antes de UFW y de SSH.
4. **Build** de las 5 imágenes (5–15 minutos la primera vez).
5. **SQL Server**: lo arranca y muestra la edición real (`Express Edition (64-bit) · 16.0…`).
6. **Datos**: `mssql-init` crea `auth_db`, `catalog_db`, `ticket_db` y sus 3 logins.
7. **Servicios**: arranca auth, catalog, ticket, gateway y frontend con el seed inicial (catálogo, ubicaciones y KB; **ningún usuario**) y espera `6/6 servicios healthy`. Después los recrea sin seed.
   **7b. Administrador inicial**: lo crea con el bootstrap seguro y guarda la contraseña **temporal** en `deploy/server/.initial-admin-secret` (permisos 600). **No la muestra.** Léela una vez (`sudo cat deploy/server/.initial-admin-secret`) y bórrala (`sudo shred -u deploy/server/.initial-admin-secret`). Al entrar por primera vez, la aplicación obliga a cambiarla.
8. **Smoke**: `SMOKE: 16 OK · 0 fallos` (aprox.). Incluye que el login simulado y el dev-login respondan **404**, que los endpoints heredados respondan **410** y que un código SSO inválido responda **400**.
9. **nginx**: instala la configuración de arranque (sin certificado aún) y el hook de certbot que recarga nginx tras cada renovación.
10. **systemd**: crea `/etc/servicedesk/backup.env` vacío (si no existe), descarga la imagen de Restic y activa los timers de backup diario, verificación cada 6 h, retención y revisión semanales y restore drill mensual.

Continúa en el **paso 7**.

## 6B. MODO B — Restauración desde backups

1. **Obtén un backup reciente del servidor de origen.** El directorio debe contener `auth_db-*.bak`, `catalog_db-*.bak`, `ticket_db-*.bak` (en la raíz o en `db/`), las imágenes (`uploads/` + `uploads.sha256`, o `uploads-*.tar.gz`) y `SHA256SUMS`. Si el origen ya no existe, recupéralo del repositorio cifrado: [RESTAURACION_SERVIDOR_NUEVO.md](../operations/RESTAURACION_SERVIDOR_NUEVO.md).
   Desde una **instalación anterior**, si tienes autorización: haz un backup nuevo con el script de este paquete en modo heredado. Copia `scripts/` a ese servidor (p. ej. a `/root/sd-scripts/`) y ejecuta allí, con los nombres de contenedor y la ruta del `.env` de esa instalación:
   ```bash
   # cd /root/sd-scripts && MSSQL_CONTAINER=<CONTENEDOR_SQL> TICKET_CONTAINER=<CONTENEDOR_TICKETS> \
     SD_ENV_FILE=<RUTA_DEL_ENV> BACKUP_DIR=/root/backups/migracion \
     BACKUP_REQUIRE_OFFSITE=false ./backup-mssql.sh
   ```
   Esperado: `✔ Backup local completo: /root/backups/migracion/sets/<ID>` (sin repositorio externo configurado, las imágenes van en `uploads-*.tar.gz` dentro del conjunto). Copia esa carpeta al servidor nuevo, p. ej. a `/root/restore/<ID>/`.
2. Desde `/opt/servicedesk` del servidor nuevo, valida el backup sin restaurar:
   ```bash
   $ sudo scripts/install-server.sh --mode restore --from /root/restore/<STAMP> --generate-secrets --dry-run
   ```
3. Instala restaurando:
   ```bash
   $ sudo scripts/install-server.sh --mode restore --from /root/restore/<STAMP> --generate-secrets
   ```
   Esperado: `SHA-256 correcto`, `RESTORE VERIFYONLY` y `DBCC CHECKDB` correctos para cada base, imágenes restauradas, `usuarios re-mapeados`, los conteos (`users=… tickets=… attachments=…`), `6/6 servicios healthy` y el smoke en verde. **No se ejecuta ningún seed.**

Notas:
- Las contraseñas de este servidor son **nuevas** (`--generate-secrets`). Los usuarios conservan las suyas y sus roles, porque viajan dentro de `auth_db`.
- Un backup de **Developer** se puede restaurar en **Express** si cada base ocupa menos de 10 GB y no usa funciones exclusivas (ServiceDesk no las usa).
- El `JWT_SECRET` nuevo invalida las sesiones anteriores, así que los usuarios deberán volver a iniciar sesión.

---

## 7. DNS

En el proveedor del dominio, crea un registro `A` (y `AAAA` si hay IPv6) de `PUBLIC_DOMAIN` hacia la IP del servidor nuevo. Comprueba:

```bash
$ dig +short servicedesk.tu-dominio.edu.ec
```
Esperado: la IP del servidor nuevo. Si migras desde el VPS anterior, cambia el DNS **después** de validar los pasos 9–12 usando la IP directamente (hosts local).

## 8. HTTPS (Let's Encrypt)

Desde `/opt/servicedesk`, con el DNS ya resuelto:

```bash
$ sudo certbot certonly --webroot -w /var/www/certbot -d servicedesk.tu-dominio.edu.ec --agree-tos -m correo@uta.edu.ec --no-eff-email
$ sudo scripts/install-server.sh --nginx-tls
$ systemctl list-timers | grep certbot
```
Esperado: `Successfully received certificate`, luego `✔ nginx configurado (servicedesk.conf.template)` y el timer `certbot.timer` activo (renovación automática). Comprueba también la recarga tras renovar:
```bash
$ echo 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh && sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
$ sudo certbot renew --dry-run
```

## 9. Verificar el dominio

```bash
$ cd /opt/servicedesk
$ sudo SMOKE_BASE_URL=https://servicedesk.tu-dominio.edu.ec scripts/operations/smoke-server.sh
$ curl -sI https://servicedesk.tu-dominio.edu.ec | grep -i strict-transport
$ curl -s -o /dev/null -w '%{http_code}\n' http://servicedesk.tu-dominio.edu.ec/
```
Esperado: `SMOKE: … 0 fallos`, la cabecera `strict-transport-security` y `301` (redirección a HTTPS).

## 10. Usuarios, login y roles

- **Login**: abre `https://<dominio>` y entra con el admin inicial (contraseña temporal → la aplicación pide cambiarla) o con Microsoft. Si el botón de Microsoft no funciona, revisa la tabla de errores del paso 5.2-G.
- **Técnicos y DTIC**: la aplicación aún no tiene pantalla para asignar roles. Pide a cada persona que entre una vez con Microsoft y después, desde `/opt/servicedesk`:
  ```bash
  $ sudo scripts/operations/manage-user.sh set-role correo@uta.edu.ec technician   # área Técnicos
  $ sudo scripts/operations/manage-user.sh set-role correo@uta.edu.ec dtic         # área DTIC (no es admin)
  $ sudo scripts/operations/manage-user.sh list-staff
  ```
  Sin SSO: `manage-user.sh create correo@uta.edu.ec dtic "Nombre Apellido" --password`.
- Más detalle en `docs/operations/GESTION_USUARIOS.md`.

## 11. Probar tickets e imágenes (navegador)

1. Como usuario: **Nuevo ticket** → servicio → ubicación → detalle → adjunta una imagen → crear.
2. Como técnico del área: **Disponibles** → aceptar → **Mis Aceptados** → clic en la tarjeta. Debe verse el detalle con la miniatura; al hacer clic, la imagen ampliada.
3. En DevTools → *Network*: `GET /api/tickets/…/attachments/…` → `200 image/…`, y **ningún** `/uploads/`.
4. Técnico → **Resolver**. Como usuario: **Rechazar** (con motivo), y el ticket vuelve al técnico. Técnico → resolver de nuevo. Usuario → marca la casilla de términos → **Aceptar**: estado *Cerrado* y código de constancia `VD-…`.
5. Admin → **Estadísticas** e **Historial**.

Prueba automatizada opcional (requiere Node 20 en algún equipo con acceso al gateway): `scripts/testing/smoke-e2e.mjs` (ver su cabecera).

## 12. Android

El APK actual apunta a `https://servicedesk-uta.site`. Para el dominio nuevo hay que **reconstruirlo** en el equipo de desarrollo:

```bash
cd frontend
VITE_API_URL=https://servicedesk.tu-dominio.edu.ec npm run build
npx cap sync android
cd android && ./gradlew assembleDebug        # o assembleRelease con keystore de firma
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
En el dispositivo: login (local y Microsoft), Mis Aceptados → detalle → miniatura → lightbox, y una notificación push que abra el ticket.

## 13. Backups y recuperación

```bash
$ cd /opt/servicedesk
$ sudo systemctl start servicedesk-backup.service && sudo journalctl -u servicedesk-backup -n 30 --no-pager
$ sudo scripts/operations/check-backup.sh
$ systemctl list-timers 'servicedesk-*'
```
Esperado: `✔ Backup completo … → snapshot …`, `✔ Backup correcto de hace 0 h` y cinco timers activos. Si aparece **código 3 / NO_OFFSITE**, falta configurar la copia externa cifrada ([CONFIGURACION_BACKBLAZE.md](../operations/CONFIGURACION_BACKBLAZE.md)). Operación diaria: [BACKUPS_MSSQL.md](../operations/BACKUPS_MSSQL.md).

**Restauración de prueba** (obligatoria antes de dar el servidor por bueno): `sudo scripts/backup/restore-drill.sh` → `RESTORE DRILL PASS`.

## 13b. Estado general

```bash
$ sudo scripts/operations/server-health.sh
```
Esperado: `Resumen: 0 fallo(s)`. El instalador ejecuta la versión `--brief` al terminar. Detalle en [MONITOREO_SERVIDOR.md](../operations/MONITOREO_SERVIDOR.md). Comprueba también, **desde otro equipo**, que solo 22, 80 y 443 están abiertos ([CONFIGURACION_RED.md §4](CONFIGURACION_RED.md)).

## 14. Lista final antes de abrir a usuarios

- [ ] `docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps` → 6 servicios `healthy`
- [ ] `/api/auth/config` → `devLoginEnabled:false`, `microsoftSimulateEnabled:false` y, si se usa SSO, `ssoConfigured:true` con un inicio de sesión de Microsoft probado
- [ ] Redirect URI del dominio nuevo registrada en Azure; **fecha de caducidad del secreto de cliente** anotada
- [ ] Correo: `SMTP OK` (paso 5.3-D) y al menos un correo real en estado `sent` (paso 5.3-E)
- [ ] Si se usa Android: Firebase configurado (paso 5.4) y una notificación push recibida
- [ ] Todos los secretos del paso 5.1 guardados en el gestor de contraseñas institucional; ningún `.json` de Firebase ni secreto suelto en el servidor
- [ ] Contraseña temporal del admin cambiada y `deploy/server/.initial-admin-secret` **borrado**
- [ ] `sudo ufw status` → solo SSH, 80 y 443 · `sudo sshd -T | grep passwordauthentication` → `no`
- [ ] Smoke por el dominio sin fallos
- [ ] Edición SQL Server ≠ Developer/Evaluation y licencia confirmada
- [ ] Backup manual correcto **con copia externa** y `check-backup.sh` en verde
- [ ] Simulacro de restauración hecho
- [ ] Puertos: `sudo ss -tlnp | grep -E ':(1433|8080|3000)'` → solo `127.0.0.1`
- [ ] Certificado válido y `certbot renew --dry-run` correcto
- [ ] APK reconstruido y probado en un dispositivo real (si se usa Android)

Si algo falla: `docs/troubleshooting/PROBLEMAS_FRECUENTES.md`.
