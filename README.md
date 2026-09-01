# ServiceDesk UTA

**Sistema institucional de gestión de tickets (Help Desk) para la Universidad Técnica de Ambato** — resuelve el flujo completo de reporte, asignación, atención, resolución y auditoría de incidencias de soporte técnico, con notificaciones automáticas por correo, historial imprimible y estadísticas en vivo.

Diseñado como **monorepo de microservicios** con autenticación local + SSO Microsoft (Azure AD), base de conocimiento compartida y reportes individuales por técnico.

---

## Badges

![Sprint](https://img.shields.io/badge/Sprint-3%20completo-success)
![Node](https://img.shields.io/badge/Node.js-20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![React](https://img.shields.io/badge/React-18.3-61DAFB)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF)
![Tailwind](https://img.shields.io/badge/Tailwind-3.4-38B2AC)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)
![Tests](https://img.shields.io/badge/Tests-228%2F228-brightgreen)
![License](https://img.shields.io/badge/License-Académica%20UTA-lightgrey)

---

## Tabla de Contenidos

1. [Descripción](#descripción)
2. [Tecnologías Utilizadas](#tecnologías-utilizadas)
3. [Instalación y Configuración](#instalación-y-configuración)
4. [Uso / Ejecución](#uso--ejecución)
5. [Arquitectura y Estructura de Carpetas](#arquitectura-y-estructura-de-carpetas)
6. [Pruebas](#pruebas)
7. [Historias de Usuario cubiertas](#historias-de-usuario-cubiertas)
8. [Autor y Contribución](#autor-y-contribución)
9. [Licencia](#licencia)

---

## Descripción

ServiceDesk UTA cubre tres perfiles:

- **Usuario solicitante** (docente, estudiante o administrativo) — crea tickets, adjunta imágenes, sigue el estado del suyo, recibe notificaciones por correo, imprime el historial oficial.
- **Técnico** — ve la bandeja de tickets disponibles de su área (Técnicos / TICs / General), acepta, aporta, deriva, resuelve con solución de la base de conocimiento (existente o nueva).
- **Administrador** — asigna tickets manualmente, ve estadísticas en vivo con filtro por rango de fechas, historial general filtrable, genera reportes individuales por técnico con impresión y exportación a PDF.

Además implementa: seguridad de contraseñas con política institucional y hash bcrypt (con migración transparente de hashes SHA-256 legacy), notificaciones por correo con patrón *outbox* tolerante a fallos, y encabezados de reporte alineables a los períodos académicos oficiales de la UTA.

---

## Tecnologías Utilizadas

### Backend (por microservicio)

| Categoría | Tecnología | Versión |
|---|---|---|
| Runtime | Node.js (alpine) | 20 |
| Lenguaje | TypeScript (strict) | 5.7 |
| Framework HTTP | Express | 4.21 |
| ORM | Prisma | 5.22 |
| Base de datos | PostgreSQL | 16 |
| Validación runtime | Zod | 3.24 |
| Autenticación | jsonwebtoken (JWT) | 9.0 |
| Hashing | bcryptjs (12 rounds) | 3.0 |
| SSO Microsoft | @azure/msal-node | 2.16 |
| HTTP interno | axios | 1.7 |
| Uploads | multer | 1.4 |
| Correo SMTP | nodemailer | 8.0 |
| Seguridad HTTP | helmet, cors, morgan | – |
| API Gateway | http-proxy-middleware | 3.0 |

### Frontend

| Categoría | Tecnología |
|---|---|
| UI | React 18.3 + TypeScript 5.7 |
| Bundler | Vite 5.4 |
| Router | react-router-dom 6.28 |
| Estilos | Tailwind CSS 3.4 + PostCSS + autoprefixer |
| Gráficos | SVG custom (Donut, Bar, Line) — sin librería externa |
| Servidor prod | nginx 1.27 |

### Infraestructura y testing

| Herramienta | Uso |
|---|---|
| Docker + Docker Compose | Orquestación (multi-stage Dockerfiles) |
| Jest + ts-jest + Supertest | Pruebas automatizadas (~228 tests verdes) |

---

## Instalación y Configuración

### Requisitos previos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Docker | 24+ | Con Compose v2 (`docker compose`) |
| Git | cualquiera | Para clonar el repositorio |
| (opcional) Cuenta Azure AD | — | Para SSO real; sin ella funcionan login local y dev-login |
| (opcional) Cuenta Gmail con App Password | — | Para envío real de correos; sin ella el sistema queda en modo `log` |

### 1. Clonar el repositorio

```bash
git clone https://github.com/THThoms/ProyectoMetodologiasAgiles.git
cd ProyectoMetodologiasAgiles
git checkout Develop
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y ajusta al menos:

```env
# JWT (obligatorio en todos los entornos)
JWT_SECRET=una_cadena_larga_y_aleatoria_de_al_menos_32_caracteres
JWT_EXPIRES_IN=8h

# Microsoft SSO (opcional; si están vacíos, dev-login y login local siguen funcionando)
MICROSOFT_CLIENT_ID=...
MICROSOFT_TENANT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_REDIRECT_URI=http://localhost:8080/auth/callback

# Correos institucionales que reciben rol admin al hacer SSO
ADMIN_EMAILS=admin@uta.edu.ec

# Envío de correos (opcional; default modo `log`)
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_SEND_MODE=log        # o `smtp` si tienes Gmail App Password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=ServiceDesk UTA <no-reply@uta.edu.ec>

# Dev-login (bypass sin contraseña; SOLO desarrollo local)
AUTH_DEV_LOGIN=true
```

> El archivo `.env` está ignorado por git — nunca se sube al repositorio. Solo `.env.example` (sin credenciales reales) se versiona.

### 3. Levantar todo con Docker

```bash
docker compose build
docker compose up -d
docker compose ps
```

Cuando los 6 contenedores estén `healthy`, la aplicación está lista.

---

## Uso / Ejecución

### URLs

| Servicio | URL |
|---|---|
| Aplicación web (frontend) | http://localhost:3000 |
| API Gateway (backend) | http://localhost:8080 |
| Health check gateway | http://localhost:8080/health |

Los microservicios internos (`auth :3001`, `catalog :3002`, `ticket :3003`, `postgres :5432`) **no están expuestos al host** — solo se acceden por la red interna de Docker.

### Cuentas de prueba precargadas por el seed

**Login local** (correo + contraseña):

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@uta.edu.ec` | `admin123` |
| Administrador | `msolis5357@uta.edu.ec` | `msolis123` |
| Técnico (Técnicos) | `carlos.mena@uta.edu.ec` | `tecn1123` |
| Técnico (Técnicos) | `daniela.paredes@uta.edu.ec` | `tecn2123` |
| Técnico (TICs) | `andres.salazar@uta.edu.ec` | `tecn3123` |
| Técnico (TICs) | `valeria.nunez@uta.edu.ec` | `tecn4123` |
| Técnico (TICs) | `mateo.cordova@uta.edu.ec` | `tecn5123` |
| Usuario | `docente@uta.edu.ec` | `docente123` |
| Usuario | `estudiante@uta.edu.ec` | `estudiante123` |

**Solo Microsoft simulado** (usar el botón "Microsoft simulado" en el login):

| Rol | Correo |
|---|---|
| Técnico (Técnicos) | `mgarcia7795@uta.edu.ec` |
| Usuario | `bparedes8678@uta.edu.ec` |

### Comandos útiles de Docker

```bash
# Ver logs de un servicio
docker compose logs -f ticket-service

# Reconstruir un servicio tras cambios en código
docker compose build ticket-service
docker compose up -d ticket-service

# Detener todo
docker compose down

# Detener y borrar volúmenes (⚠ borra la base de datos)
docker compose down -v
```

### Desarrollo local sin Docker (opcional)

Cada microservicio se puede correr aparte:

```bash
cd ticket-service
npm install
npx prisma generate
npm run dev            # ts-node-dev con hot reload
```

Se requiere un PostgreSQL local escuchando en `localhost:5432` con las 3 bases (`auth_db`, `catalog_db`, `ticket_db`) y sus usuarios respectivos, más el `.env` de cada servicio ajustado.

---

## Arquitectura y Estructura de Carpetas

### Diagrama de arquitectura

```
                    ┌──────────────────────┐
                    │  Frontend :3000      │  React + Vite + Tailwind
                    │  (nginx en runner)   │
                    └──────────┬───────────┘
                               │ HTTP + JWT
                               ▼
                    ┌──────────────────────┐
                    │  API Gateway :8080   │  http-proxy-middleware
                    │  Único punto público │  reenvía sin parsear body
                    └───┬──────┬───────┬───┘
                        │      │       │
         ┌──────────────┘      │       └─────────────┐
         ▼                     ▼                     ▼
   ┌──────────┐         ┌──────────┐          ┌──────────┐
   │  auth    │         │ catalog  │          │  ticket  │
   │  :3001   │         │  :3002   │          │  :3003   │
   │  JWT     │         │ Services │          │ Tickets  │
   │  MSAL    │         │ Routing  │          │ Historial│
   │  bcrypt  │         │  KB      │          │ Outbox   │
   └────┬─────┘         └────┬─────┘          └────┬─────┘
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             ▼
                    ┌──────────────────────┐
                    │ PostgreSQL :5432     │
                    │  auth_db             │  ← 3 bases aisladas
                    │  catalog_db          │    sin FK cruzadas
                    │  ticket_db           │    (integridad por app)
                    └──────────────────────┘
```

### Estructura de carpetas del monorepo

```
servicedesk-microservices/
├── api-gateway/              # Único punto público (Express + http-proxy-middleware)
│   ├── src/
│   │   ├── app.ts           # Configuración de proxies y rewrites
│   │   ├── config/env.ts
│   │   └── index.ts
│   ├── Dockerfile
│   └── package.json
│
├── auth-service/             # Autenticación + roles + SSO Microsoft
│   ├── prisma/
│   │   ├── schema.prisma    # Modelos User, Session, AuthLog
│   │   └── seed.ts          # Cuentas seedeadas para desarrollo
│   ├── src/
│   │   ├── routes/authRoutes.ts     # /auth/login, /auth/microsoft, ...
│   │   ├── services/authService.ts
│   │   ├── utils/passwordSecurity.ts # Política + bcrypt + legacy migration
│   │   ├── middleware/verifyJwt.ts
│   │   └── config/msal.config.ts
│   ├── tests/
│   ├── Dockerfile
│   └── package.json
│
├── catalog-service/          # Servicios institucionales + Base de conocimiento
│   ├── prisma/
│   │   ├── schema.prisma    # Modelos Service, RoutingRule, KnowledgeArticle
│   │   └── seed.ts          # 29 artículos KB iniciales
│   ├── src/
│   │   ├── routes/
│   │   │   ├── serviceRoutes.ts     # CRUD del catálogo
│   │   │   └── knowledgeRoutes.ts   # KB search + create
│   │   └── ...
│   ├── tests/
│   ├── Dockerfile
│   └── package.json
│
├── ticket-service/           # Núcleo del negocio: tickets + historial + outbox
│   ├── prisma/
│   │   └── schema.prisma    # Ticket, TicketEvent, Attachment, EmailOutbox
│   ├── src/
│   │   ├── routes/
│   │   │   ├── ticketRoutes.ts       # CRUD ticket + historial
│   │   │   ├── assignmentRoutes.ts   # accept, contributions, escalate, resolve
│   │   │   ├── adminRoutes.ts        # assign, stats, historial, reports
│   │   │   └── routingRoutes.ts      # Motor de enrutamiento legacy
│   │   ├── services/
│   │   │   ├── historyService.ts
│   │   │   ├── areaService.ts        # Mapping rol → áreas
│   │   │   ├── emailService.ts       # Transporte SMTP (log/mock/smtp)
│   │   │   ├── emailOutboxService.ts # Patrón outbox
│   │   │   ├── emailTemplates.ts     # 5 plantillas de correo
│   │   │   ├── technicianReportService.ts  # HU-16: reporte por técnico
│   │   │   ├── authClient.ts         # HTTP client → auth-service
│   │   │   ├── catalogClient.ts      # HTTP client → catalog-service
│   │   │   └── knowledgeClient.ts    # HTTP client → catalog-service KB
│   │   ├── middleware/
│   │   │   ├── verifyJwt.ts
│   │   │   └── upload.ts             # Multer para adjuntos
│   │   └── config/env.ts
│   ├── tests/                        # ~176 tests con Jest + Supertest
│   ├── uploads/                      # Volumen de imágenes adjuntas
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                 # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── NuevoTicket.tsx
│   │   │   ├── MisTickets.tsx              # Vista del solicitante
│   │   │   ├── PanelTecnicoV2.tsx          # Bandeja del técnico
│   │   │   ├── MisTicketsAceptados.tsx     # Activos/Historial del técnico
│   │   │   ├── BaseConocimiento.tsx        # Búsqueda de KB
│   │   │   ├── AdminStats.tsx              # Dashboard con filtros de fecha
│   │   │   ├── AdminHistorial.tsx          # Historial general filtrable
│   │   │   ├── AdminReporteTecnicos.tsx    # HU-16: reporte por técnico
│   │   │   └── AdminCatalogo.tsx           # CRUD servicios
│   │   ├── components/
│   │   │   ├── Layout.tsx                  # Navbar + subnav adaptativo
│   │   │   ├── TicketHistoryModal.tsx      # Modal reutilizable
│   │   │   ├── ResolveTicketModal.tsx
│   │   │   ├── TicketActionModals.tsx
│   │   │   └── charts/                     # SVG puro
│   │   │       ├── DonutChart.tsx
│   │   │       ├── BarChart.tsx
│   │   │       └── LineChart.tsx
│   │   ├── lib/
│   │   │   ├── api.ts                      # axios con JWT + 401 handling
│   │   │   ├── auth.ts                     # Manejo local del JWT
│   │   │   └── technician.ts               # Helpers de presentación
│   │   ├── App.tsx                         # Router + ProtectedRoute
│   │   └── main.tsx
│   ├── public/
│   ├── nginx.conf
│   ├── Dockerfile
│   └── package.json
│
├── scripts/                  # Scripts de inicialización de Postgres
├── docker-compose.yml        # Orquestación de los 6 contenedores
├── .env.example              # Plantilla de variables (sin secretos)
├── .gitignore                # Ignora .env, node_modules, dist, uploads, ...
└── README.md
```

### Reglas arquitectónicas del proyecto

- Cada microservicio tiene su propio `package.json`, `Dockerfile`, `prisma/schema.prisma` y base de datos.
- **NO** hay librerías compartidas entre microservicios.
- **TODA** comunicación frontend → backend pasa por el API Gateway.
- Cada microservicio valida el JWT localmente (defensa en profundidad; no confía ciegamente en el gateway).
- La integridad referencial entre bases se mantiene por aplicación, no por foreign keys físicas.
- Los tickets guardan datos denormalizados (`userName`, `serviceName`) para sobrevivir aunque auth o catalog estén caídos.

---

## Pruebas

El proyecto tiene ~228 tests automatizados verdes.

### Ejecutar toda la suite

```bash
# ticket-service (188 tests)
cd ticket-service
npm test

# catalog-service (29 tests)
cd ../catalog-service
npm test

# auth-service (23 tests)
cd ../auth-service
npm test
```

### Validaciones adicionales por servicio

```bash
# Type check estricto
npx tsc --noEmit

# Prisma schema
DATABASE_URL="postgresql://x:x@x:5432/x" npx prisma validate

# Build de producción
npm run build
```

### Frontend

```bash
cd frontend
npx tsc -b --noEmit   # Type check
npm run build         # Build de producción
```

---

## Historias de Usuario cubiertas

### Sprint 1
- **HU-01 a HU-05:** Base del sistema (roles, autenticación, creación de tickets).

### Sprint 2
- **HU-06 a HU-08:** Enrutamiento por área responsable, panel técnico, escalamiento.
- **HU-09:** Historial completo por ticket.
- **HU-10:** Base de conocimiento institucional.
- **HU-11:** Estadísticas para el administrador.

### Sprint 3
- **HU-12:** Filtro por rango de fechas en las estadísticas administrativas.
- **HU-13:** Seguridad de contraseñas (política institucional + bcrypt + migración transparente de hashes SHA-256 legacy).
- **HU-14:** Impresión de historial del ticket con encabezado institucional.
- **HU-15:** Notificaciones por correo (patrón outbox tolerante a fallos + Gmail SMTP con nodemailer).
- **HU-16:** Reporte individual de actividades del técnico (solo admin) con impresión, exportación a PDF y períodos institucionales UTA.

---

## Autor y Contribución

**Autor principal:** Tomás Solís (Tech Lead FISEI-UTA) — [@THThoms](https://github.com/THThoms)

Proyecto académico desarrollado como parte de la asignatura **Metodologías Ágiles** — Cuarto semestre, Facultad de Ingeniería en Sistemas, Electrónica e Industrial (FISEI), Universidad Técnica de Ambato.

### Directrices para contribuir

1. Crea una rama a partir de `Develop`:
   ```bash
   git checkout Develop
   git pull
   git checkout -b feat/mi-nueva-feature
   ```
2. Sigue la **convención de commits** del proyecto (español, tipo Conventional Commits):
   ```
   feat(alcance): descripción corta
   fix(alcance): descripción del fix
   chore: cambios de infra o configuración
   docs: cambios en documentación
   ```
3. Antes de hacer PR:
   - `npm test` verde en el servicio modificado
   - `npx tsc --noEmit` sin errores
   - Nunca commitees archivos `.env` ni credenciales
4. Abre un Pull Request contra la rama `Develop`, no contra `main`.
5. `main` se actualiza solo con PRs desde `Develop` al cerrar cada sprint.

---

## Licencia

Este software se distribuye bajo una **licencia académica interna** de la Universidad Técnica de Ambato — FISEI. Uso restringido a fines educativos y demostrativos del curso de Metodologías Ágiles.

Copyright © 2026 Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional.
