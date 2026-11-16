# Guion de grabación — Instalación de ServiceDesk UTA en WSL (Ubuntu 24.04)

**Para quién es:** la persona que prepara, graba y narra el video. Cada paso dice **dónde** se hace, **qué** se escribe, **qué debe aparecer** y **qué se dice**.
**Dónde se instala:** una distribución **nueva y vacía de Ubuntu 24.04 LTS en WSL2**, dentro de este PC con Windows 11. Es **el mismo sistema operativo que tenía el VPS** (Ubuntu 24.04 LTS), así que el procedimiento es el mismo que se seguirá en el servidor definitivo.
**Qué se instala:** el paquete `servicedesk-uta-server-1.0.0-rc6.tar.gz` (no uses RC4 ni RC5).
**Duración:** video editado de 20–25 minutos. Grabación en bruto de 60–80 minutos (las esperas se cortan o se aceleran).

> **Estado del guion:** los comandos del instalador y sus salidas están verificados (instalación simulada 61/61 y E2E 105/105). Los pasos propios de WSL (crear la distribución, systemd, UFW, acceso desde Windows) **no se han ensayado todavía en este PC**. Por eso el **ensayo general de la Parte 1.6 es obligatorio** antes de grabar. Los puntos a vigilar llevan la marca 🔎.

---

## Índice

- Parte 0 — Qué va a mostrar el video
- Parte 1 — Preparación (no se graba)
- Parte 2 — Guion del video
  - Bloque A: crear el "servidor" Ubuntu 24.04 en WSL (escenas 1–5)
  - Bloque B: preparar el servidor (escenas 6–8)
  - Bloque C: instalar ServiceDesk (escenas 9–14)
  - Bloque D: HTTPS, verificación y primer acceso (escenas 15–17)
  - Bloque E: demostración funcional (escenas 18–24)
  - Bloque F: backups, reinicio y cierre (escenas 25–27)
- Parte 3 — Si algo falla
- Parte 4 — Después de grabar
- Anexo A — Diferencias entre WSL y el servidor real
- Anexo B — Datos que se usan en todo el guion

---

## Parte 0 — Qué va a mostrar el video

Mensaje central:

> "ServiceDesk UTA se instala en un Ubuntu 24.04 limpio, el mismo sistema del servidor, con un único instalador y sin depender del equipo de desarrollo. Usa SQL Server como único motor, queda detrás de HTTPS y genera y protege sus secretos de forma automática."

Tres ideas que el espectador debe recordar:

1. **Reproducible**: un paquete verificado con SHA-256 y un solo comando instalan todo.
2. **Seguro por defecto**: solo nginx es accesible. SQL Server y los microservicios no se ven desde fuera; no hay contraseñas por defecto ni cuentas de prueba.
3. **Verificable**: el instalador comprueba su propio trabajo (smoke test, salud y backups).

Por qué WSL: da un Ubuntu 24.04 real (con systemd, Docker, nginx y SQL Server) sin tocar el VPS anterior ni el futuro servidor. No hay dominio público, así que se usa un nombre local (`servicedesk.lab`) y un certificado autofirmado en la misma ruta que usaría Let's Encrypt.

---

## Parte 1 — Preparación (no se graba)

### 1.1 Lo que ya tiene este PC (comprobado)

| Elemento | Estado |
|---|---|
| WSL | Versión 2.6.2, kernel 6.6 |
| Red de WSL | Modo **mirrored** (en `C:\Users\USER\.wslconfig`): WSL usa los **mismos puertos** que Windows |
| Distribuciones existentes | `Ubuntu` (la tuya, con SQL Server nativo), `FedoraLinux-44` (con nginx de NorthWind), `docker-desktop` |
| Puertos 80 y 443 de Windows | Libres (con todas las distribuciones detenidas) |
| Recursos | 32 GB de RAM y 16 hilos; WSL usa por defecto la mitad de la RAM (~16 GB) |
| OBS Studio y Windows Terminal | Instalados |

**Consecuencia importante del modo mirrored:** si Fedora (nginx) o tu Ubuntu (SQL Server) están encendidos, **ocupan los mismos puertos** que necesita ServiceDesk. Antes de grabar hay que apagarlos (paso 1.3).

### 1.2 Docker Desktop: apagado durante la grabación

ServiceDesk usará **su propio Docker dentro de la nueva distribución**, igual que en un servidor. Docker Desktop no debe intervenir:

1. Abre Docker Desktop → **Settings → Resources → WSL integration**. Comprueba que **no** está activada para `ServiceDesk-Ubuntu` (la crearás en la escena 1; vuelve a revisarlo después de crearla). Aplica.
2. Antes de grabar: icono de la ballena en la bandeja del sistema → **Quit Docker Desktop**.

> El laboratorio de desarrollo (contenedores `sd-*-mssql`) se queda detenido, con sus datos intactos. No se borra nada.

### 1.3 Apagar las demás distribuciones de WSL

En **PowerShell**:

```powershell
wsl --shutdown
wsl -l -v
```

**Debe verse:** todas las distribuciones en `Stopped`. Durante la grabación **no abras** `Ubuntu` ni `FedoraLinux-44`.

### 1.4 Nombre del servidor en Windows

1. Busca **Bloc de notas** → clic derecho → **Ejecutar como administrador**.
2. **Archivo → Abrir** → `C:\Windows\System32\drivers\etc\hosts` (filtro: *Todos los archivos*).
3. Añade al final esta línea y guarda:
   ```
   127.0.0.1  servicedesk.lab
   ```
4. Compruébalo en PowerShell:
   ```powershell
   Resolve-DnsName servicedesk.lab -Type A | Select-Object Name, IPAddress
   ```
   **Debe verse:** `servicedesk.lab  127.0.0.1`.

> WSL copia por defecto las entradas del `hosts` de Windows a su propio `/etc/hosts`, así que el Ubuntu nuevo también conocerá `servicedesk.lab` (se comprueba en la escena 8).
> No uses dominios `.dev` ni `.app`: el navegador exige allí HTTPS válido y no te dejaría continuar con un certificado de laboratorio.

### 1.5 Preparar la grabación

- **OBS Studio**: escena *Captura de pantalla* a 1920×1080, 30 fps, formato MKV (después *Archivo → Remuxear grabaciones* a MP4). Micrófono con supresión de ruido.
- **Windows Terminal**: fuente de 18 pt, tema oscuro, ventana maximizada. Ten dos pestañas: **PowerShell** y, más adelante, **ServiceDesk-Ubuntu**.
- **Navegador** Chrome o Edge en ventana InPrivate/incógnito, zoom 125 %, sin barra de marcadores.
- Activa *No molestar* en Windows y cierra correo y chats.
- Ten preparadas la diapositiva de portada, el diagrama de arquitectura (escena 9) y la diapositiva de cierre.
- Ten en el Escritorio una foto de prueba `equipo.jpg` (una impresora o un equipo; nada personal).

### 1.6 Ensayo general (obligatorio)

Haz **todo el guion una vez sin grabar**. Así se descargan las imágenes de Docker y de SQL Server, detectas problemas y mides tus tiempos. Anota en especial los puntos 🔎:

- 🔎 Escena 2: que la distribución nueva arranque con **systemd**.
- 🔎 Escena 8: que `servicedesk.lab` se resuelva dentro de Ubuntu.
- 🔎 Escena 14: que la sección del **firewall UFW** termine sin error.
- 🔎 Escena 15: que el navegador de Windows abra `https://servicedesk.lab`.
- 🔎 Escena 26: que tras reiniciar la distribución los servicios vuelvan solos.

Después del ensayo, vuelve al punto de partida con las copias de la Parte 1.7 (o borra la distribución y créala de nuevo).

### 1.7 Copias de seguridad de la distribución (equivalen a instantáneas)

WSL no tiene instantáneas como una máquina virtual, pero puede **exportar** la distribución a un archivo y volver a importarla.

| Copia | Cuándo | Comando (PowerShell) |
|---|---|---|
| `01-ubuntu-limpio.tar` | Al terminar la escena 5 | `wsl --terminate ServiceDesk-Ubuntu; wsl --export ServiceDesk-Ubuntu C:\WSL\copias\01-ubuntu-limpio.tar` |
| `02-docker-listo.tar` | Al terminar la escena 8 | `wsl --terminate ServiceDesk-Ubuntu; wsl --export ServiceDesk-Ubuntu C:\WSL\copias\02-docker-listo.tar` |

Crea antes la carpeta: `mkdir C:\WSL\copias`.

**Volver a una copia:**

```powershell
wsl --unregister ServiceDesk-Ubuntu
wsl --import ServiceDesk-Ubuntu C:\WSL\ServiceDesk-Ubuntu C:\WSL\copias\02-docker-listo.tar
wsl -d ServiceDesk-Ubuntu
```

> `wsl --unregister` borra **solo** la distribución `ServiceDesk-Ubuntu`. Nunca lo uses con `Ubuntu`, `FedoraLinux-44` ni `docker-desktop`.
> Al importar, el usuario por defecto puede pasar a ser `root`. La escena 2 lo fija en `/etc/wsl.conf`, así que las copias ya lo traen configurado.

---

## Parte 2 — Guion del video

**Formato de cada escena:** **Dónde** · **Pasos** · **Debe verse** · **Narración** (texto sugerido; léelo con naturalidad) · **Edición**.

Convención: `PS>` = PowerShell en Windows · `$` = terminal de **ServiceDesk-Ubuntu**.

---

### Escena 0 — Presentación (0:30)

**Dónde:** diapositiva de portada (UTA · FISEI · ServiceDesk UTA).

**Narración:**
> "En este video instalamos ServiceDesk UTA, el sistema de mesa de ayuda de la Facultad de Ingeniería en Sistemas, Electrónica e Industrial, sobre un Ubuntu veinticuatro cero cuatro completamente nuevo, el mismo sistema operativo que usa el servidor. Para no tocar ningún servidor real lo hacemos en el subsistema de Linux de Windows. Partimos de cero y terminamos con el sistema funcionando por HTTPS, con su administrador, sus usuarios y sus copias de seguridad programadas."

---

## Bloque A — Crear el servidor Ubuntu 24.04 en WSL

### Escena 1 — Crear una distribución nueva de Ubuntu 24.04 (1:30)

**Dónde:** Windows Terminal, pestaña PowerShell.

**Pasos:**

1. Muestra que no hay ninguna distribución en marcha y que ServiceDesk-Ubuntu no existe:
   ```powershell
   PS> wsl -l -v
   ```
   **Debe verse:** `Ubuntu`, `FedoraLinux-44` y `docker-desktop`, todas `Stopped`.
2. Crea una distribución **nueva**, separada de la tuya, con la misma versión que el servidor:
   ```powershell
   PS> wsl --install Ubuntu-24.04 --name ServiceDesk-Ubuntu
   ```
   Descarga Ubuntu 24.04 (1–3 minutos) y abre la distribución.
3. Cuando lo pida, crea el usuario administrador:
   - `Enter new UNIX username:` → `sdadmin`
   - `New password:` → una contraseña fuerte. **No se ve al escribir**. Repítela.
4. Debe aparecer el prompt `sdadmin@<nombre-de-tu-PC>:~$`.

**Debe verse:** `Installation successful!` y el prompt de Ubuntu.

**Narración:**
> "Creamos una distribución nueva de Ubuntu veinticuatro cero cuatro, independiente de cualquier otra que tenga este equipo. Será nuestro servidor: un sistema recién instalado, sin nada más. Creamos el usuario administrador del servidor."

**Edición:** acelera la descarga.

> 🔎 Si `--name` no es reconocido, actualiza WSL (`PS> wsl --update`) y repite.

### Escena 2 — Comprobar systemd y fijar el usuario (1:00)

**Dónde:** pestaña ServiceDesk-Ubuntu (desde ahora, en Windows Terminal: flecha ▾ → **ServiceDesk-Ubuntu**).

**Pasos:**

1. ServiceDesk necesita **systemd** (gestiona Docker, nginx y las tareas de backup):
   ```bash
   $ ps -p 1 -o comm=
   $ cat /etc/wsl.conf
   ```
   **Debe verse:** `systemd`, y en `wsl.conf` la sección `[boot]` con `systemd=true`.
2. Deja fijados systemd y el usuario por defecto (así las copias exportadas arrancan igual):
   ```bash
   $ printf '[boot]\nsystemd=true\n\n[user]\ndefault=sdadmin\n' | sudo tee /etc/wsl.conf
   ```
3. 🔎 Si en el paso 1 **no** salió `systemd`: en PowerShell `PS> wsl --terminate ServiceDesk-Ubuntu`, vuelve a abrir la pestaña y repite el paso 1.

**Narración:**
> "Comprobamos que el sistema arranca con systemd, igual que un servidor: lo necesitamos para Docker, para nginx y para programar las copias de seguridad."

### Escena 3 — Comprobar el sistema (0:45)

**Dónde:** `$` ServiceDesk-Ubuntu.

```bash
$ lsb_release -d
$ uname -m
$ nproc && free -h
$ df -h /
$ command -v docker nginx sqlcmd || echo "Nada instalado todavía"
```

**Debe verse:** `Ubuntu 24.04.x LTS`, `x86_64`, 16 procesadores, unos 15 Gi de memoria total, cientos de GB disponibles y `Nada instalado todavía`.

**Narración:**
> "Ubuntu veinticuatro cero cuatro, arquitectura de sesenta y cuatro bits, procesadores y memoria de sobra: el instalador exige al menos dos procesadores y cuatro gigas para SQL Server. Y comprobamos que el servidor está vacío: ni Docker, ni nginx, ni bases de datos."

### Escena 4 — Prompt corto para el video (0:15, opcional)

```bash
$ echo "export PS1='\u@servicedesk:\w\$ '" >> ~/.bashrc && source ~/.bashrc
```

**Debe verse:** el prompt `sdadmin@servicedesk:~$`.

### Escena 5 — Punto de partida guardado (no se graba)

En PowerShell: copia `01-ubuntu-limpio.tar` (Parte 1.7). Vuelve a abrir la pestaña ServiceDesk-Ubuntu.

---

## Bloque B — Preparar el servidor

### Escena 6 — Actualizar Ubuntu e instalar herramientas (1:00 editado · 3–5 min reales)

**Dónde:** `$` ServiceDesk-Ubuntu.

```bash
$ sudo apt update && sudo apt -y full-upgrade
$ sudo apt -y install ca-certificates curl gnupg rsync openssl nginx certbot ufw
$ sudo timedatectl set-timezone America/Guayaquil
$ timedatectl | grep "Time zone"
```

**Debe verse:** al final, `Time zone: America/Guayaquil (-05, -0500)`.

> Si `full-upgrade` muestra una pantalla morada sobre reiniciar servicios, pulsa Enter (opciones por defecto).

**Narración:**
> "Actualizamos el sistema e instalamos nginx, que será la única puerta de entrada; certbot para los certificados HTTPS; y el firewall UFW. Ponemos la zona horaria de Ecuador para que los reportes y las copias de seguridad tengan la hora correcta."

**Edición:** acelera ×8 la salida de `apt`.

### Escena 7 — Instalar Docker Engine (1:00 editado)

**Dónde:** `$` ServiceDesk-Ubuntu.

```bash
$ sudo install -m 0755 -d /etc/apt/keyrings
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
$ sudo apt update
$ sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$ sudo systemctl is-active docker
$ sudo docker version --format 'Docker {{.Server.Version}}'
$ sudo docker compose version
```

**Debe verse:** `active`, `Docker 28.x` o superior y `Docker Compose version v2.x`.

> 🔎 Si `docker` muestra *"The command 'docker' could not be found… activate the WSL integration in Docker Desktop"*, Docker Desktop está integrado con esta distribución: desactívalo (Parte 1.2), cierra Docker Desktop, ejecuta `PS> wsl --terminate ServiceDesk-Ubuntu` y repite esta escena.

**Narración:**
> "Instalamos Docker Engine y Docker Compose desde el repositorio oficial de Docker, exactamente como en el servidor. No usamos Docker Desktop de Windows: este Ubuntu tiene su propio Docker, igual que lo tendrá el servidor real."

### Escena 8 — El servidor conoce su nombre (0:45)

**Dónde:** `$` ServiceDesk-Ubuntu.

```bash
$ getent hosts servicedesk.lab
```

**Debe verse:** `127.0.0.1       servicedesk.lab` (WSL lo tomó del archivo `hosts` de Windows, Parte 1.4).

🔎 Si no aparece nada:

```bash
$ echo "127.0.0.1 servicedesk.lab" | sudo tee -a /etc/hosts
$ getent hosts servicedesk.lab
```

**Narración:**
> "En un servidor real, el nombre lo resuelve el DNS del dominio institucional. En este laboratorio, el servidor se llamará servicedesk punto lab."

**→ No se graba:** copia `02-docker-listo.tar` (Parte 1.7) y vuelve a abrir la pestaña.

---

## Bloque C — Instalar ServiceDesk

### Escena 9 — Arquitectura en un minuto (1:00)

**Dónde:** diapositiva con el diagrama.

```
Navegador ──HTTPS 443──► nginx (única entrada)
                           ├─► frontend (React)      127.0.0.1:3000
                           └─► API Gateway           127.0.0.1:8080
                                 ├─► auth-service    ─┐
                                 ├─► catalog-service ─┼─► SQL Server 2022 (red interna, sin puerto publicado)
                                 └─► ticket-service  ─┘    auth_db · catalog_db · ticket_db
                                                           + volumen de imágenes
```

**Narración:**
> "ServiceDesk tiene cinco componentes en contenedores: el frontend, un API Gateway y tres microservicios: autenticación, catálogo y tickets. Cada microservicio tiene su propia base de datos en SQL Server 2022, el único motor del sistema. Desde fuera solo se ve nginx por HTTPS. SQL Server y los microservicios están en redes internas de Docker: ni siquiera el frontend puede llegar a la base de datos. Las imágenes adjuntas se guardan en un volumen persistente y solo se entregan a quien tiene permiso sobre el ticket."

### Escena 10 — Copiar el paquete y verificar su integridad (1:30)

**Dónde:** `$` ServiceDesk-Ubuntu.

Desde WSL, el disco `C:` de Windows está en `/mnt/c`. Copiamos el paquete al disco de Linux:

```bash
$ REL="/mnt/c/Users/USER/Documents/Universidad/4 Cuarto semestre/Metodologias Ajiles/servicedesk-microservices/release"
$ ls -lh "$REL"/servicedesk-uta-server-1.0.0-rc6.*
$ cp "$REL"/servicedesk-uta-server-1.0.0-rc6.tar.gz "$REL"/servicedesk-uta-server-1.0.0-rc6.tar.gz.sha256 /tmp/
$ cd /tmp
$ sha256sum -c servicedesk-uta-server-1.0.0-rc6.tar.gz.sha256
```

**Debe verse:** los archivos `rc6` (el `.tar.gz` de unos 590 KB) y `servicedesk-uta-server-1.0.0-rc6.tar.gz: OK`.

**Narración:**
> "Copiamos un único paquete de menos de un mega: el código, los archivos de Docker, el instalador y la documentación. No lleva contraseñas, ni datos, ni cuentas de prueba, ni dependencias del equipo de desarrollo. En un servidor real se copiaría por SSH; aquí lo tomamos del disco de Windows. Lo primero es comprobar su huella SHA-256: si el archivo se hubiera dañado o alterado, no seguiríamos."

### Escena 11 — Extraer el paquete (0:45)

**Dónde:** `$` ServiceDesk-Ubuntu.

```bash
$ sudo mkdir -p /opt/servicedesk
$ sudo tar -xzf /tmp/servicedesk-uta-server-1.0.0-rc6.tar.gz -C /opt/servicedesk --strip-components=1
$ cd /opt/servicedesk
$ ls
$ cat VERSION
```

**Debe verse:** `api-gateway auth-service catalog-service deploy docs frontend scripts ticket-service`, `MANIFEST.md`, `VERSION` y `1.0.0-rc6`.

**Narración:**
> "Todo el sistema queda en la carpeta opt servicedesk, dentro del disco de Linux: los cinco componentes, la configuración de despliegue, los scripts de operación y la documentación."

### Escena 12 — Configuración mínima (2:00)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

**Pasos:**

1. Crea la configuración a partir de la plantilla, legible solo por root:
   ```bash
   $ sudo cp .env.example deploy/server/.env
   $ sudo chmod 600 deploy/server/.env
   $ ls -l deploy/server/.env
   ```
   **Debe verse:** `-rw------- 1 root root … deploy/server/.env`.
2. Ábrela:
   ```bash
   $ sudo nano deploy/server/.env
   ```
3. Busca cada variable con **Ctrl+W** y cámbiala (las demás se quedan como están):

   | Variable | Valor | Qué significa |
   |---|---|---|
   | `PUBLIC_DOMAIN` | `servicedesk.lab` | Nombre por el que se entra al sistema, sin `https://` |
   | `SERVER_PURPOSE` | `pruebas` | Servidor de pruebas: permite SQL Server Developer |
   | `MSSQL_PID` | `Developer` | Edición de SQL Server. En producción: `Express` o la licenciada |
   | `INITIAL_ADMIN_EMAIL` | `admin.prueba@uta.edu.ec` | Administrador inicial (debe ser `@uta.edu.ec`) |
   | `INITIAL_ADMIN_NAME` | `Administrador ServiceDesk` | Nombre que se mostrará |

   **No toques** `MSSQL_SA_PASSWORD`, `AUTH_DB_PASSWORD`, `CATALOG_DB_PASSWORD`, `TICKET_DB_PASSWORD` ni `JWT_SECRET`: deben quedar **vacías**.
4. Guarda con **Ctrl+O** y Enter; sal con **Ctrl+X**.
5. Muestra solo lo que cambiaste:
   ```bash
   $ sudo grep -E '^(PUBLIC_DOMAIN|SERVER_PURPOSE|MSSQL_PID|INITIAL_ADMIN_EMAIL|JWT_SECRET|MSSQL_SA_PASSWORD)=' deploy/server/.env
   ```
   **Debe verse:** los cuatro valores, y `JWT_SECRET=` y `MSSQL_SA_PASSWORD=` **vacíos**.

**Narración:**
> "Partimos de la plantilla y solo rellenamos cuatro datos: el nombre del servidor, su propósito, la edición de SQL Server y el correo del administrador inicial. Las contraseñas de las bases y la clave que firma las sesiones las dejamos vacías a propósito: el instalador las generará aleatorias, robustas y distintas entre sí, y nunca las mostrará."
>
> "Al ser un servidor de pruebas usamos SQL Server Developer, que solo tiene licencia para desarrollo y pruebas. Si marcáramos el servidor como de producción, el instalador la bloquearía y exigiría una edición licenciada."

> **Microsoft SSO y correo no se configuran en este video.** El inicio de sesión institucional exige registrar en Azure `https://servicedesk.lab/auth/callback`, y eso corresponde al administrador del tenant. Se usará el login local; el instalador avisará de que el SSO no está configurado, y es lo esperado.
>
> Si tienes permiso en Azure y quieres mostrarlo, sigue **fuera de cámara** los pasos 5.2 (Microsoft) y 5.3 (correo) de `docs/installation/INSTALACION_SERVIDOR_NUEVO.md`. Escribe los valores en el `.env` **antes** de la escena 13, y nunca muestres el secreto de cliente ni la contraseña SMTP. En el video basta con enseñar la comprobación `"ssoConfigured":true` y el mensaje `SMTP OK`.

> ⚠ Desde que instales (escena 14), **no vuelvas a abrir `deploy/server/.env` en cámara**: contendrá las contraseñas generadas.

### Escena 13 — Ensayo sin cambios: `--dry-run` (1:00)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets --skip-ssh-hardening --dry-run
```

**Debe verse:**

- `== 1. Preflight del servidor ==` con `✔ Ubuntu 24.04 LTS`, `✔ arquitectura x86_64`, `✔ RAM … MB`, `✔ 16 vCPU`, `✔ Docker …`, `✔ Docker Compose …` y `✔ Disco libre … GB`.
- La tabla `VARIABLE / ESTADO`, solo con `CONFIGURADA`, `VACÍA` o `AUSENTE`, **nunca un valor**.
- Avisos `⚠`: servidor de pruebas, licencia Developer, Microsoft SSO no configurado y backup externo sin configurar.
- `✔ Configuración válida` y después líneas `[dry-run] …`.

**Narración:**
> "Antes de cambiar nada, ejecutamos el instalador en modo ensayo: revisa el servidor, valida la configuración y enumera lo que haría, sin hacerlo. La tabla muestra si cada variable está configurada o vacía, nunca su valor. Los avisos son honestos: es un servidor de pruebas, y el inicio de sesión con Microsoft y la copia externa de backups aún no están configurados."
>
> "Añadimos una opción para omitir el endurecimiento de SSH, porque en este subsistema de Linux no hay servidor SSH. En el servidor real el instalador desactiva el acceso por contraseña."

### Escena 14 — Instalación (4:00 editado · 15–25 min reales)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets --skip-ssh-hardening
```

Hará **dos preguntas**. Responde escribiendo **`SI`** en mayúsculas y Enter:

1. `¿Confirmas que dispones de la licencia de SQL Server 'Developer' para este servidor?`
2. `Se configurará UFW: denegar entrantes salvo SSH (22), 80 y 443. ¿Continuar?`

Narra cada sección cuando aparezca:

| Aparece en pantalla | Narración |
|---|---|
| `== 1. Preflight del servidor ==` | "Comprueba el sistema operativo, la arquitectura, la memoria, los procesadores, el disco y Docker." |
| `== 2. Configuración` y cinco líneas `✔ …: GENERADA` | "Genera las cinco contraseñas: la del administrador de SQL Server, las de las tres bases y la clave de las sesiones. Dice GENERADA, pero no muestra ninguna; quedan en un archivo que solo root puede leer." |
| Pregunta de licencia → `SI` | "Confirmamos que tenemos la licencia de SQL Server adecuada para este uso." |
| `== 3. Verificación del modo de instalación ==` → `✔ No hay datos previos` | "Comprueba que no existan datos: nunca instala limpio encima de una base existente." |
| `== 3b. Endurecimiento del host ==` → `✔ Docker: rotación de logs…` → pregunta UFW → `SI` → `✔ UFW activo` | "Endurece el servidor: Docker rota sus registros y no concede privilegios extra, y el firewall solo deja pasar SSH, HTTP y HTTPS." |
| `== 4. Construcción de imágenes ==` | "Descarga SQL Server y construye las imágenes de los cinco componentes. La primera vez tarda varios minutos." **→ Edición: corta hasta la sección 5** |
| `== 5. SQL Server ==` → `✔ SQL Server en marcha: Developer Edition (64-bit) · 16.0…` | "SQL Server 2022 arrancado. El instalador comprueba que la edición real coincide con la configurada." |
| `== 6. Datos (modo clean) ==` | "Crea las tres bases de datos, cada una con su propio usuario, que solo tiene permisos sobre su base." |
| `== 7. Microservicios…` → `✔ 6/6 servicios healthy` → `✔ servicios recreados sin seed` | "Arranca los servicios con el catálogo inicial de servicios, ubicaciones y base de conocimiento, sin ningún usuario de prueba, y espera a que los seis estén sanos. Sano significa que cada uno respondió con una consulta real a su base de datos. Luego los reinicia sin la carga inicial, que solo ocurre una vez." **→ Edición: acelera la espera** |
| `== 7b. Administrador inicial…` → `✔ Contraseña temporal guardada en … (permisos 600). NO se muestra en pantalla.` | "Crea el administrador con una contraseña temporal aleatoria. No la muestra: la guarda en un archivo protegido, y el primer inicio de sesión obligará a cambiarla." |
| `== 8. Smoke test ==` → `SMOKE: 14 OK · 0 fallos` | "Y se prueba a sí mismo: los accesos de desarrollo sin contraseña responden 404, los endpoints protegidos exigen sesión y SQL Server no tiene ningún puerto publicado." |
| `== 9. nginx ==` → `⚠ No hay certificado …: se instala la config de ARRANQUE` | "Configura nginx. Como aún no hay certificado, deja una configuración de arranque; lo resolvemos enseguida." |
| `== 10. Backups automáticos cifrados ==` → `✔ timers activos` | "Programa con systemd la copia de seguridad diaria cifrada, su verificación cada seis horas, la retención y un simulacro mensual de restauración." |
| `== 11. Verificación final ==` y `== Instalación terminada ==` | "Revisa la salud general y termina, recordándonos cómo ver el estado, gestionar usuarios y dónde está la contraseña temporal." |

**Debe verse al final:** `== Instalación terminada ==` sin ninguna línea roja `✘`. Los avisos amarillos sobre backups externos y SSH son esperados.

> 🔎 Si la sección 3b falla al activar UFW, restaura la copia `02-docker-listo.tar` y repite la instalación añadiendo `--skip-firewall`. Explica en la narración que en WSL el firewall de entrada lo aplica Windows, y que en el servidor real UFW se activa con el mismo instalador.

---

## Bloque D — HTTPS, verificación y primer acceso

### Escena 15 — Certificado y HTTPS (2:00)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

1. Sin certificado, nginx aún no sirve la aplicación:
   ```bash
   $ curl -s http://servicedesk.lab/
   ```
   **Debe verse:** `ServiceDesk UTA: certificado TLS pendiente de emisión.`
2. Crea un certificado autofirmado **en la misma ruta que usaría Let's Encrypt**:
   ```bash
   $ D=servicedesk.lab
   $ sudo mkdir -p /etc/letsencrypt/live/$D
   $ sudo openssl req -x509 -nodes -newkey rsa:2048 -days 90 \
       -subj "/CN=$D" -addext "subjectAltName=DNS:$D" \
       -keyout /etc/letsencrypt/live/$D/privkey.pem \
       -out /etc/letsencrypt/live/$D/fullchain.pem
   $ sudo chmod 600 /etc/letsencrypt/live/$D/privkey.pem
   ```
3. Activa la configuración HTTPS definitiva:
   ```bash
   $ sudo scripts/install-server.sh --nginx-tls
   ```
   **Debe verse:** `… test is successful` y `✔ nginx configurado (servicedesk.conf.template)`. Un aviso sobre `certbot.timer` es normal aquí.
4. Comprueba la redirección y las cabeceras de seguridad:
   ```bash
   $ curl -s -o /dev/null -w 'HTTP → %{http_code}\n' http://servicedesk.lab/
   $ curl -skI https://servicedesk.lab/ | grep -i -E '^HTTP|strict-transport|content-security'
   ```
   **Debe verse:** `HTTP → 301`, una línea `HTTP/… 200`, `strict-transport-security: …` y `content-security-policy: default-src 'self' …`.
5. 🔎 En **Windows**, abre el navegador en `https://servicedesk.lab`. Aparecerá *"La conexión no es privada"* → **Configuración avanzada** → **Continuar a servicedesk.lab**. Debe verse la pantalla de inicio de sesión de ServiceDesk.

**Narración:**
> "En el servidor real, con su dominio público, aquí usaríamos certbot para obtener un certificado de Let's Encrypt. En este laboratorio no hay dominio público, así que generamos un certificado autofirmado y lo dejamos exactamente donde lo pondría certbot. Después, el instalador activa la configuración definitiva de nginx: todo el tráfico HTTP se redirige a HTTPS, con la cabecera HSTS y una política de contenido que solo permite ejecutar el código del propio sistema. El navegador avisa porque el certificado es de laboratorio; con Let's Encrypt el aviso no aparece."

**Opcional — evitar el aviso del navegador** (fuera de cámara):

1. `$ cp /etc/letsencrypt/live/servicedesk.lab/fullchain.pem /mnt/c/Users/USER/Desktop/servicedesk-lab.crt` (con `sudo` si lo pide).
2. Doble clic en `servicedesk-lab.crt` del Escritorio → **Instalar certificado** → **Equipo local** → **Colocar todos los certificados en el siguiente almacén** → **Entidades de certificación raíz de confianza** → Finalizar.
3. Cierra y vuelve a abrir el navegador.
4. Al terminar de grabar, bórralo (Parte 4).

### Escena 16 — Verificación técnica (2:00)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`, y después PowerShell.

```bash
$ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps --format 'table {{.Service}}\t{{.Status}}'
```
**Debe verse:** `mssql`, `auth-service`, `catalog-service`, `ticket-service`, `api-gateway` y `frontend` con `Up … (healthy)`.
**Narración:** "Los seis contenedores están sanos."

```bash
$ sudo ss -tlnp | grep -E ':(80|443|1433|3000|8080) '
```
**Debe verse:** nginx en `0.0.0.0:80` y `0.0.0.0:443`; `127.0.0.1:3000` y `127.0.0.1:8080`; **ninguna línea con `1433`**.
**Narración:** "Hacia fuera solo escuchan los puertos 80 y 443 de nginx. El frontend y el gateway solo escuchan en el propio servidor, y SQL Server no tiene ningún puerto publicado."

```bash
$ sudo ufw status
```
**Debe verse:** `Status: active` con solo `22/tcp`, `80/tcp` y `443/tcp` en `ALLOW` (o `inactive` si usaste `--skip-firewall`).

```bash
$ sudo SMOKE_BASE_URL=https://servicedesk.lab SMOKE_INSECURE=1 scripts/operations/smoke-server.sh
```
**Debe verse:** todo en `✔` y `SMOKE: … 0 fallos`.
**Narración:** "Repetimos el smoke test, esta vez por HTTPS a través de nginx, como entraría un usuario."

```bash
$ sudo scripts/operations/server-health.sh --brief
```
**Debe verse:** `Resumen: 0 fallo(s)`. Habrá avisos esperados: backups externos, SSH (no instalado en WSL) y certificado de laboratorio.
**Narración:** "Y el informe de salud: memoria, disco, contenedores, bases de datos en línea, puertos, firewall y backups. Ningún fallo."

**En PowerShell** (Windows):
```powershell
PS> Test-NetConnection localhost -Port 443  | Select-Object TcpTestSucceeded
PS> Test-NetConnection localhost -Port 1433 | Select-Object TcpTestSucceeded
```
**Debe verse:** `True` para 443 y `False` para 1433.
**Narración:** "Desde Windows, fuera del servidor, responde HTTPS y el puerto de SQL Server está cerrado."

> 🔎 Si 1433 da `True`, tu otra distribución `Ubuntu` (con SQL Server nativo) está encendida: `PS> wsl --terminate Ubuntu` y repite.

### Escena 17 — Primer acceso del administrador (2:00)

**Paso 1 — Leer la contraseña temporal. ⏸ PAUSA LA GRABACIÓN.**

```bash
$ sudo cat deploy/server/.initial-admin-secret
```
Cópiala (selecciónala; Windows Terminal la copia). **▶ Reanuda la grabación** y borra el archivo en cámara:

```bash
$ sudo shred -u deploy/server/.initial-admin-secret
$ ls deploy/server/.initial-admin-secret
```
**Debe verse:** `No such file or directory`.

**Narración:**
> "Leímos la contraseña temporal fuera de cámara y borramos el archivo de forma segura: no queda copia en el servidor."

**Paso 2 — Navegador:** `https://servicedesk.lab`.

1. Pantalla **Bienvenido al ServiceDesk**. Correo institucional `admin.prueba@uta.edu.ec`, contraseña: pega la temporal → **Iniciar sesión**.
2. La aplicación lleva directamente a **Cambiar contraseña**. Escribe la temporal y una nueva (mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo) → confirmar.
3. Entra al panel **Estadísticas**.

**Narración:**
> "Con la contraseña temporal no se puede hacer nada más que cambiarla. La nueva debe tener al menos doce caracteres, con mayúsculas, minúsculas, números y símbolos. Ya estamos en el panel del administrador."

---

## Bloque E — Demostración funcional

### Escena 18 — Crear usuarios de prueba (1:30)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

Cada comando pide una contraseña dos veces **sin mostrarla** (mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo). Usa la misma para las tres cuentas y anótala fuera de cámara.

```bash
$ sudo scripts/operations/manage-user.sh create prueba.tecnico1@uta.edu.ec technician "Técnico Prueba Uno" --password
$ sudo scripts/operations/manage-user.sh create prueba.dtic@uta.edu.ec dtic "DTIC Prueba" --password
$ sudo scripts/operations/manage-user.sh create prueba.usuario@uta.edu.ec user "Usuario Prueba" --password
$ sudo scripts/operations/manage-user.sh list-staff
```

**Debe verse:** `OK creado prueba.tecnico1@uta.edu.ec rol=technician (con contraseña local)` y equivalentes; en `list-staff`, el administrador, el técnico y DTIC, con `total=3`.

**Narración:**
> "El sistema tiene cuatro roles: administrador, técnico, DTIC y usuario solicitante. Los técnicos atienden el área de Técnicos de la facultad; DTIC es un área independiente y no es administrador. En producción, cada persona entra con su cuenta institucional de Microsoft y el administrador le asigna el rol; aquí creamos cuentas de prueba con contraseña local."

### Escena 19 — Asignar el técnico al Bloque 1 (1:00)

**Dónde:** navegador, sesión del administrador.

1. Menú **Bloques**.
2. Fila *Técnico Prueba Uno* → desplegable → **Bloque 1**.
3. Aparece el mensaje verde `Técnico Prueba Uno: Bloque 1`.
4. **Cerrar sesión** (arriba a la derecha).

**Narración:**
> "Los técnicos de la facultad se clasifican por bloque, según el edificio donde trabajan. El bloque organiza los reportes; no da permisos adicionales. DTIC no aparece aquí porque no pertenece a ningún bloque."

### Escena 20 — El usuario crea un ticket con una imagen (1:30)

**Dónde:** navegador.

1. Inicia sesión como `prueba.usuario@uta.edu.ec`.
2. **Crear ticket**:
   - Servicio: **Equipos / Hardware** (área de Técnicos).
   - Ubicación: **Laboratorio 1**.
   - Detalle: `La impresora del laboratorio no imprime y muestra un error de papel atascado.`
   - Adjunta `equipo.jpg` desde el Escritorio.
   - **Crear**.
3. **Mis Tickets**: aparece `TK-AAAAMMDD-001`, estado **Pendiente**, área **Técnicos**.
4. **Cerrar sesión**.

**Narración:**
> "Un usuario reporta un problema y adjunta una foto como evidencia. El sistema asigna el área responsable según el servicio elegido. La imagen se comprime en el navegador y el servidor la valida por su contenido real, no por la extensión del archivo."

### Escena 21 — El técnico acepta el ticket y ve la imagen (1:30)

**Dónde:** navegador.

1. Inicia sesión como `prueba.tecnico1@uta.edu.ec`.
2. **Panel Técnico** → el ticket en **Disponibles** → **Aceptar**.
3. **Mis Aceptados** → clic en la tarjeta → se ve la **miniatura** de la imagen.
4. Clic en la miniatura → imagen **ampliada**. Ciérrala.
5. (Opcional, 20 s) **F12 → Network**, recarga el detalle y señala la petición `attachments/…` con `200` y `image/jpeg`. **No abras la pestaña *Headers*** (contiene el token de sesión).

**Narración:**
> "El técnico del área ve el ticket en su bandeja y lo acepta. La imagen no está en una carpeta pública: se descarga por un servicio autenticado que comprueba que quien la pide tiene permiso sobre ese ticket. Un técnico de DTIC, que es otra área, recibiría un error de acceso."

### Escena 22 — El técnico resuelve (1:00)

**Dónde:** navegador, sesión del técnico.

1. En el ticket → **Resolver** → **Crear nueva solución**:
   - Título: `Impresora con papel atascado`
   - Problema: `La impresora muestra error de papel atascado y no imprime.`
   - Solución: `Se retiró el papel atascado de la bandeja trasera y se limpió el rodillo.`
   - Palabras clave: `impresora, papel`
   - Nota final: `Probado con una página de prueba.`
2. **Confirmar**: el ticket pasa a **Pendiente de validación**.
3. **Cerrar sesión**.

**Narración:**
> "El técnico registra la solución, que además queda en la base de conocimiento para casos futuros. El ticket no se cierra: queda pendiente de validación, porque quien decide si el problema se resolvió es el usuario."

### Escena 23 — El usuario acepta con constancia digital (1:30)

**Dónde:** navegador.

1. Inicia sesión como `prueba.usuario@uta.edu.ec` → **Mis Tickets**.
2. *"El técnico propuso una solución. Por favor valídala."* → **Revisar y validar la solución**.
3. Recorre: problema, solución, técnico responsable, imágenes, historial y **términos (versión 1.0)**.
4. Señala que **Aceptar solución** está deshabilitado.
5. Marca *"He revisado la solución y acepto los términos…"* → **Aceptar solución**.
6. Mensaje: *Ticket … cerrado. Constancia de aceptación digital VD-AAAAMMDD-XXXXXXXX…*. Estado **Cerrado**.

**Narración:**
> "El usuario revisa la solución completa con sus evidencias y los términos, y no puede aceptar sin marcar la casilla. Al aceptar, el ticket se cierra y queda una constancia digital con un código único: quién aceptó, su correo, la fecha y la hora, la solución y la versión de los términos. Esa constancia no se puede modificar ni borrar, ni siquiera desde la base de datos. No es una firma electrónica certificada: es la constancia interna de conformidad. Si la hubiera rechazado, tendría que indicar un motivo y el ticket volvería al técnico."

### Escena 24 — Reporte del técnico (1:30)

**Dónde:** navegador.

1. **Cerrar sesión** e inicia como administrador.
2. **Reportes** → *Seleccionar técnico*: **Técnico Prueba Uno** → **Generar reporte**.
3. Recorre: encabezado institucional azul, información del técnico, resumen, estadísticas, historial de tickets y **Validación digital del usuario** con el código `VD-…`.
4. (Opcional) Elige **Bloque 1** y genera el reporte del bloque.
5. **Imprimir** → en el cuadro de impresión, destino **Guardar como PDF** → muestra la vista previa.

**Narración:**
> "El administrador obtiene el reporte de cada técnico y de cada bloque, con el encabezado institucional, los tickets, las soluciones y la validación digital de cada usuario con su código. Se imprime o se guarda en PDF directamente desde el navegador."

---

## Bloque F — Backups, reinicio y cierre

### Escena 25 — Backups (2:00)

**Dónde:** `$` ServiceDesk-Ubuntu, en `/opt/servicedesk`.

```bash
$ systemctl list-timers 'servicedesk-*' --no-pager
```
**Debe verse:** `servicedesk-backup`, `servicedesk-backup-check`, `servicedesk-backup-verify`, `servicedesk-backup-retention` y `servicedesk-restore-drill`, con su próxima ejecución.

```bash
$ sudo systemctl start servicedesk-backup.service ; sudo journalctl -u servicedesk-backup -n 30 --no-pager
```
**Debe verse:** `auth_db: VERIFYONLY correcto`, `catalog_db: VERIFYONLY correcto`, `ticket_db: VERIFYONLY correcto`, `conjunto local verificado` y un aviso de que **no hay copia externa** (el servicio termina con código 3).

```bash
$ sudo scripts/operations/check-backup.sh
```
**Debe verse:** `✔ Backup correcto de hace 0 h …` y el aviso de copia externa sin configurar.

**Narración:**
> "Las copias de seguridad quedaron programadas durante la instalación. Lanzamos una ahora: copia las tres bases de datos con sumas de verificación, comprueba cada copia con SQL Server, registra la huella de cada imagen y guarda la configuración necesaria para recuperar el sistema. Termina con una alerta, código tres, porque la copia externa cifrada todavía no está configurada: el sistema no se conforma con tener la copia en el mismo servidor. Con las credenciales del almacenamiento externo, la misma tarea cifrará la copia antes de que salga del servidor y conservará catorce copias diarias, ocho semanales y doce mensuales."

### Escena 26 — Reinicio y persistencia (1:00)

**Dónde:** PowerShell, después ServiceDesk-Ubuntu y el navegador.

1. Apaga el "servidor" por completo:
   ```powershell
   PS> wsl --terminate ServiceDesk-Ubuntu
   PS> wsl -l -v
   ```
   **Debe verse:** `ServiceDesk-Ubuntu  Stopped`.
2. Vuelve a abrir la pestaña **ServiceDesk-Ubuntu** y espera ~1 minuto:
   ```bash
   $ cd /opt/servicedesk
   $ sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps --format 'table {{.Service}}\t{{.Status}}'
   ```
   **Debe verse:** los seis servicios `healthy` (si alguno dice `health: starting`, espera 30 s y repite).
3. Navegador: recarga `https://servicedesk.lab`, entra como usuario y abre el ticket: siguen el historial, la constancia y la imagen.

**Narración:**
> "Apagamos el servidor por completo. Al encenderlo, los servicios arrancan solos, y los datos, las constancias y las imágenes siguen ahí: todo vive en volúmenes persistentes."

> 🔎 Mantén abierta la pestaña de ServiceDesk-Ubuntu durante toda la grabación: WSL puede apagar una distribución sin terminales abiertas tras un rato de inactividad.

### Escena 27 — Cierre (1:00)

**Dónde:** diapositiva de resumen.

**Narración:**
> "En resumen: partimos de un Ubuntu veinticuatro cero cuatro vacío, el mismo sistema del servidor, y con un paquete verificado y un instalador tenemos ServiceDesk UTA funcionando por HTTPS. SQL Server es el único motor y no expone puertos; las contraseñas se generan y se protegen solas; el administrador empieza con una contraseña temporal; hay roles y bloques, tickets con imágenes protegidas, aceptación digital con constancia, reportes institucionales y copias de seguridad programadas."
>
> "Para la puesta en producción, el mismo procedimiento se repite en el servidor definitivo con los datos institucionales: el dominio y su certificado, la edición licenciada de SQL Server, el registro del dominio en Microsoft Azure para el inicio de sesión institucional, el correo y las notificaciones push, y el almacenamiento externo de las copias de seguridad."

---

## Parte 3 — Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `wsl --install … --name` no se reconoce | WSL antiguo | `PS> wsl --update` y repite |
| `ps -p 1` no muestra `systemd` | systemd desactivado | Escena 2: `/etc/wsl.conf` con `systemd=true`; `PS> wsl --terminate ServiceDesk-Ubuntu` y reabre |
| `docker` sugiere activar la integración de Docker Desktop | Docker Desktop integrado con la distribución | Desactiva la integración (Parte 1.2), cierra Docker Desktop, termina la distribución y repite la escena 7 |
| `Failed to start docker` / errores de `iptables` | Red de Docker en WSL | `sudo journalctl -u docker -n 30`; si menciona `iptables`, `sudo update-alternatives --set iptables /usr/sbin/iptables-legacy && sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy && sudo systemctl restart docker` |
| `BLOQUEADO: MSSQL_PID=Developer no es apto para producción` | Falta `SERVER_PURPOSE=pruebas` | Corrige el `.env` (escena 12) y repite el `--dry-run` |
| Falla la sección 3b (UFW) | Firewall de Linux en WSL | Restaura `02-docker-listo.tar` y repite con `--skip-firewall` |
| `Ya existe el volumen … con datos` | Repetiste la instalación en la misma distribución | Restaura `02-docker-listo.tar` |
| `Servicios sin healthy` | Imágenes descargando o memoria | `sudo docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env logs --tail 50 ticket-service` |
| nginx no arranca o `address already in use` en 80/443 | Fedora (nginx de NorthWind) u otro programa usa esos puertos (red mirrored) | `PS> wsl --terminate FedoraLinux-44`; en Windows: `netstat -ano \| findstr ":443"`; luego `sudo systemctl restart nginx` |
| El navegador muestra *certificado TLS pendiente* | Falta la escena 15 | Crea el certificado y ejecuta `--nginx-tls` |
| El navegador no llega a `servicedesk.lab` | Falta la entrada en el `hosts` de Windows | Parte 1.4 |
| No aparece el botón *Continuar a servicedesk.lab* | Dominio `.dev`/`.app` o certificado sin `subjectAltName` | Usa `servicedesk.lab` y el comando de la escena 15 tal cual |
| `Test-NetConnection localhost -Port 1433` da `True` | Tu distribución `Ubuntu` con SQL Server nativo está encendida | `PS> wsl --terminate Ubuntu` |
| Microsoft no aparece o falla | SSO no configurado en el laboratorio (esperado) | Usa el login local; se explica en la escena 12 |

Más casos: `docs/troubleshooting/PROBLEMAS_FRECUENTES.md` (también dentro del paquete).

---

## Parte 4 — Después de grabar

- [ ] Revisa el video completo buscando datos sensibles: la contraseña temporal, cualquier vista de `deploy/server/.env`, la pestaña *Headers* de DevTools y las contraseñas de las cuentas. Difumina lo que aparezca.
- [ ] Si importaste el certificado de laboratorio en Windows, bórralo: **Win+R → `certlm.msc`** → *Entidades de certificación raíz de confianza → Certificados* → `servicedesk.lab` → Eliminar.
- [ ] Cuando ya no la uses, quita la línea `127.0.0.1  servicedesk.lab` del `hosts` de Windows.
- [ ] Para liberar espacio, elimina la distribución de laboratorio: `PS> wsl --unregister ServiceDesk-Ubuntu` (**solo** esa) y las copias de `C:\WSL\copias`.
- [ ] Vuelve a abrir Docker Desktop si necesitas el laboratorio de desarrollo: sus contenedores y datos siguen intactos.
- [ ] Exporta el video (OBS → *Archivo → Remuxear grabaciones* → MP4) y revisa el audio.

---

## Anexo A — Diferencias entre WSL y el servidor real

Útil si en el video o en la defensa preguntan qué cambia en producción.

| Aspecto | En este video (WSL) | En el servidor real (Ubuntu 24.04, como el VPS) |
|---|---|---|
| Sistema operativo | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS (igual) |
| Instalador, Docker, SQL Server, nginx, systemd | Iguales | Iguales |
| Copia del paquete | `cp` desde `/mnt/c` | `scp` por SSH |
| Nombre | `servicedesk.lab` en el `hosts` | Dominio institucional en el DNS |
| Certificado | Autofirmado | Let's Encrypt con `certbot` (renovación automática) |
| SSH | No hay servidor SSH; se usa `--skip-ssh-hardening` | El instalador desactiva el acceso por contraseña si hay una clave autorizada |
| Firewall | UFW dentro de WSL (o `--skip-firewall`); el tráfico entrante lo filtra Windows | UFW: solo 22, 80 y 443 |
| Edición de SQL Server | Developer (`SERVER_PURPOSE=pruebas`) | Express/Standard licenciada (`SERVER_PURPOSE=produccion`) |
| Microsoft SSO | No configurado | Configurado con el tenant institucional y la Redirect URI del dominio |
| Backups externos | No configurados (código 3) | Restic cifrado a Backblaze B2, con dos custodios de la clave |
| Reinicio | `wsl --terminate` | `sudo reboot` |

## Anexo B — Datos que se usan en todo el guion

| Dato | Valor |
|---|---|
| Plataforma | Windows 11 + WSL 2.6 (red mirrored) |
| Distribución | `ServiceDesk-Ubuntu` (Ubuntu 24.04 LTS, nueva) · usuario `sdadmin` |
| Nombre del sistema | `servicedesk.lab` → `127.0.0.1` (`hosts` de Windows) |
| Paquete | `servicedesk-uta-server-1.0.0-rc6.tar.gz` + `.sha256` (carpeta `release/` del repositorio) |
| Carpeta de instalación | `/opt/servicedesk` |
| Comando de instalación | `sudo scripts/install-server.sh --mode clean --generate-secrets --skip-ssh-hardening` |
| SQL Server | 2022 Developer · `SERVER_PURPOSE=pruebas` |
| Administrador inicial | `admin.prueba@uta.edu.ec` (contraseña temporal → cambio obligatorio) |
| Cuentas de prueba | `prueba.tecnico1@uta.edu.ec` (técnico, Bloque 1) · `prueba.dtic@uta.edu.ec` (DTIC) · `prueba.usuario@uta.edu.ec` (usuario) |
| Datos de la demo | Servicio *Equipos / Hardware* · Ubicación *Laboratorio 1* · foto `equipo.jpg` |
| Copias de la distribución | `C:\WSL\copias\01-ubuntu-limpio.tar` · `02-docker-listo.tar` |
| Distribuciones que deben estar apagadas | `Ubuntu`, `FedoraLinux-44`, `docker-desktop` (Docker Desktop cerrado) |

Documentación de apoyo (también dentro del paquete): `docs/installation/INSTALACION_SERVIDOR_NUEVO.md`, `docs/installation/MANUAL_INSTALACION_NUEVO_SERVIDOR.md`, `docs/operations/MANUAL_RECUPERACION.md`.
