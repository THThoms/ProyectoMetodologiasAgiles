# ServiceDesk UTA — Sistema de gestión de tickets de soporte

Sistema institucional de mesa de ayuda para docentes, estudiantes, administrativos y técnicos de la Universidad Técnica de Ambato (FISEI). Implementado como **monorepo 100 % microservicios** con autenticación SSO Microsoft / Azure AD.

> Sprint 1 — 5 historias, 31 puntos de historia.

---

## 1. Arquitectura

```
                 ┌────────────────────┐
   navegador ──▶ │  api-gateway :8080 │  (único puerto expuesto al host)
                 └─────────┬──────────┘
                           │  red interna Docker `servicedesk-net`
       ┌───────────────────┼───────────────────────────────┐
       ▼                   ▼                               ▼
┌──────────────┐   ┌─────────────────┐            ┌──────────────────┐
│ auth-service │   │ catalog-service │            │  ticket-service  │
│    :3001     │   │     :3002       │            │      :3003       │
└──────┬───────┘   └─────────┬───────┘            └─────────┬────────┘
       │                     │                              │
       ▼                     ▼                              ▼
   auth_db              catalog_db                       ticket_db   (PostgreSQL · 1 instancia, 3 schemas aislados)
```

Reglas inquebrantables del Sprint 1:

- Cada microservicio tiene su propio `package.json`, `Dockerfile`, `prisma/schema.prisma`.
- **NO** hay librerías compartidas entre microservicios.
- **TODA** comunicación frontend → backend pasa por el **API Gateway** (`http://localhost:8080`).
- Cada microservicio valida el JWT del auth-service antes de procesar peticiones.
- Stack: Node.js + Express + Prisma ORM + PostgreSQL + Docker Compose · Frontend: React + Vite + Tailwind.

---

## 2. Requisitos previos

| Herramienta | Versión mínima | Notas |
|-------------|----------------|-------|
| Docker      | 24+            | Con Compose v2 (`docker compose`) |
| Git         | cualquiera     | |
| (opcional) Cuenta Azure AD con app registrada | — | Para SSO real; ver §6. Mientras tanto se puede usar **dev-login**. |

---

## 3. Arranque rápido (un solo comando)

```bash
cp .env.example .env
# (opcional) edita .env si quieres cambiar contraseñas o configurar Azure AD
docker compose up --build
```

Al finalizar deberías ver:

| Servicio | URL |
|----------|-----|
| Frontend (SPA)     | http://localhost:3000 |
| API Gateway        | http://localhost:8080 |
| Healthcheck gateway | http://localhost:8080/health |
| Postgres (interno) | accesible solo desde la red Docker |

> Los esquemas Prisma se sincronizan con `prisma db push` y los seeds aplicables se ejecutan automáticamente en el arranque de cada microservicio.

---

## 3.1 Verificación de instalación local

Para asegurarte de que todos los microservicios tienen las dependencias correctas y compilan sin problemas en tu entorno, ejecuta el script de verificación. Este script recorrerá cada carpeta, ejecutará `npm install`, `npm run build` e indicará si hay algún error, además de validar la configuración de Docker Compose.

```cmd
verificar_proyecto.bat
```

---

## 4. Flujo de prueba end-to-end (Sprint 1)

El Sprint 1 usa **autenticación con dos métodos independientes**:

### Método 1 — Login local con correo y contraseña

1. Abre `http://localhost:3000` → te redirige a `/login`.
2. Ingresa el correo y contraseña de un usuario sembrado:
   - `admin@uta.edu.ec` / `admin123` → `/admin/catalogo`
   - `docente@uta.edu.ec` / `docente123` → `/tickets/nuevo`
   - `carlos.mena@uta.edu.ec` / `tecn1123` → `/tickets/nuevo`
3. Pulsa **Iniciar sesión** → entras directo al dashboard. **NO se pide Microsoft.**

### Método 2 — Login simulado Microsoft Office 365

1. Abre `http://localhost:3000/login`.
2. Pulsa el botón **Microsoft Office 365** (borde naranja).
3. El sistema usa el correo del campo de arriba (o `docente@uta.edu.ec` por defecto).
4. Entras directo al dashboard. **NO se pide correo ni contraseña.**

> Ambos métodos son **alternativas independientes**. Cada uno genera su propia sesión JWT
> con `authProvider: "local"` o `authProvider: "microsoft-simulated"`.

### Método 3 — SSO real con Microsoft (después de configurar Azure AD, §6)

- Pulsas **Iniciar sesión con Microsoft** → Microsoft te redirige a Azure AD → confirmas → callback emite JWT → entras al dashboard según rol.
- Si la cuenta NO termina en `@uta.edu.ec` el sistema te rechaza con mensaje claro.

---

## 5. Historias de usuario implementadas

| HU | Microservicio | Responsable | Endpoints / artefacto |
|----|---------------|-------------|------------------------|
| HU-01 | `auth-service` | Tomas Solis | `/auth/login`, `/auth/microsoft-simulate`, `/auth/microsoft`, `/auth/microsoft/callback`, `/auth/me`, `/auth/logout`, `/auth/dev-login`, `/auth/config`, `/auth/verify` |
| HU-02 | `api-gateway` + `docker-compose.yml` | Tomas Solis | `/api/auth/**`, `/api/catalog/**`, `/api/tickets/**` |
| HU-03 | `catalog-service` | Manolo Garcia | `GET /services`, `GET /services/:id`, `POST /services`, `PATCH /services/:id`, `DELETE /services/:id` (+ seed con los 6 servicios institucionales) |
| HU-04 | `ticket-service` | Carla Paredes | `POST /tickets` (multipart, hasta 5 imágenes 5MB), `GET /tickets`, `GET /tickets/:id` |
| HU-05 | Prisma (3 schemas aislados) | Carla Paredes | `auth_db`, `catalog_db`, `ticket_db`. Migraciones automáticas. Seeds idempotentes. |

Detalles de cada microservicio en su propio `README.md`:

- [auth-service/README.md](auth-service/README.md)
- [catalog-service/README.md](catalog-service/README.md)
- [ticket-service/README.md](ticket-service/README.md)
- [api-gateway/README.md](api-gateway/README.md)
- [frontend/README.md](frontend/README.md)

---

## 6. Configurar Azure AD (SSO real)

1. Portal Azure → **Azure AD → App registrations → New registration**.
2. **Redirect URI (Web)**: `http://localhost:8080/api/auth/microsoft/callback`.
3. En **Certificates & secrets → New client secret** copia el `Value`.
4. En **API permissions → Microsoft Graph** añade: `openid`, `profile`, `email`, `User.Read`. Concede consentimiento del admin.
5. Edita `.env` y rellena:
   ```env
   AZURE_AD_CLIENT_ID=...
   AZURE_AD_TENANT_ID=...           # tu tenant UTA
   AZURE_AD_CLIENT_SECRET=...
   AZURE_AD_REDIRECT_URI=http://localhost:8080/api/auth/microsoft/callback
   ALLOWED_DOMAIN=uta.edu.ec
   AUTH_DEV_LOGIN=false             # apaga el dev-login en cuanto el SSO funcione
   ```
6. Reinicia con `docker compose up -d --build auth-service`.

El servicio rechaza automáticamente cualquier email que **no** termine en `@uta.edu.ec`.

---

## 7. Estructura del monorepo

```
servicedesk/
├── api-gateway/        # Puerto 8080 (único expuesto)
├── auth-service/       # Puerto 3001 · MSAL + JWT
├── catalog-service/    # Puerto 3002 · Catálogo institucional
├── ticket-service/     # Puerto 3003 · Tickets + adjuntos
├── frontend/           # Puerto 3000 · React/Vite/Tailwind
├── scripts/
│   ├── init-multi-db.sh   # crea 3 BD + 3 usuarios en Postgres
│   └── init-db.sh         # corre migraciones + seeds manualmente
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 8. Roles y usuarios sembrados (dev-login)

| Email                    | Rol       | Pantalla inicial    |
|--------------------------|-----------|---------------------|
| `admin@uta.edu.ec`       | `admin`   | /admin/catalogo     |
| `carlos.mena@uta.edu.ec`     | `tech_n1` | /tickets/nuevo *    |
| `daniela.paredes@uta.edu.ec` | `tech_n2` | /tickets/nuevo *    |
| `andres.salazar@uta.edu.ec`  | `tech_n3` | /tickets/nuevo *    |
| `valeria.nunez@uta.edu.ec`   | `tech_n4` | /tickets/nuevo *    |
| `mateo.cordova@uta.edu.ec`   | `tech_n3` | /tickets/nuevo *    |
| `docente@uta.edu.ec`     | `user`    | /tickets/nuevo      |
| `estudiante@uta.edu.ec`  | `user`    | /tickets/nuevo      |

\* Sprint 2 añade la bandeja de trabajo para técnicos.

---

## 9. Troubleshooting

| Síntoma | Solución |
|---------|----------|
| `docker compose up` se queda en `auth-service: waiting for postgres` | El primer arranque crea las 3 BD; espera ~30s. Si persiste, revisa logs: `docker compose logs postgres` |
| `auth-service` crashea con `Falta variable de entorno requerida: JWT_SECRET` | Confirma que copiaste `.env.example` a `.env` y que la variable está definida |
| Login con Microsoft devuelve `error=domain_not_allowed` | La cuenta no pertenece a `@uta.edu.ec`. Cambia de cuenta o ajusta `ALLOWED_DOMAIN` |
| Login con Microsoft devuelve `error=sso_not_configured` | Faltan `AZURE_AD_*` en `.env`. Mientras tanto usa **dev-login** |
| Subir imagen > 5MB devuelve 413 | Comportamiento esperado; comprime la imagen |
| Tickets devuelve `502 No se pudo validar el servicio en el catálogo` | El `catalog-service` no está corriendo o no es alcanzable. Revisa `docker compose ps` |
| Necesito reiniciar las BD desde cero | `docker compose down -v && docker compose up --build` (⚠ borra los datos) |

---

## 10. Definición de hecho — checklist Sprint 1

- [x] Cada microservicio expone sus endpoints REST documentados (`README.md` por servicio).
- [x] HU-01: SSO Microsoft con validación de tenant `@uta.edu.ec` + JWT propio + roles.
- [x] HU-02: API Gateway con http-proxy-middleware. Solo el gateway expone puerto al host. CORS y healthchecks listos.
- [x] HU-03: CRUD del catálogo, solo admin escribe, soft delete, seed con los 6 servicios.
- [x] HU-04: Creación de ticket con multipart (≤5 imágenes JPG/PNG, ≤5MB c/u), número auto `TK-YYYYMMDD-NNN`, consulta a catalog-service para nivel.
- [x] HU-05: 3 schemas Prisma aislados, sincronizados vía `prisma db push` al arrancar.
- [x] Frontend con paleta UTA: `/login`, `/auth/callback`, `/tickets/nuevo`, `/admin/catalogo`.
- [x] Un solo comando `docker compose up --build` levanta todo.
- [x] Todos los endpoints (excepto `/auth/microsoft*`, `/auth/dev-login`, `/auth/config`, `/health`, `GET /services`) validan JWT.

---

## 11. Equipo Sprint 1

- **Tomas Solis** — auth-service (HU-01) + API Gateway / Docker (HU-02)
- **Manolo Garcia** — catalog-service (HU-03)
- **Carla Paredes** — ticket-service (HU-04) + Modelo Prisma / Migraciones (HU-05)
