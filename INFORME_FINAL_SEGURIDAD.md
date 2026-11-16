# Informe final — Seguridad (ServiceDesk UTA)

**Fecha:** 2026-11-15 · **Alcance:** código del repositorio, laboratorio local y simulación de servidor nuevo. Sin secretos en este documento. El VPS anterior **no** se tocó.

## 1. Autenticación

| Control | Estado | Evidencia |
|---|---|---|
| Microsoft Entra ID **real** (Authorization Code con `@azure/msal-node` 7, ahora actualizado) | PASS (código y tests con MSAL simulado); **NOT TESTED contra el tenant** desde este equipo | `auth-service/src/routes/authRoutes.ts`, 97 tests |
| `state` ligado a una cookie HttpOnly del navegador (anti login-CSRF), un solo uso | PASS | tests `ssoExchange`, `securityHardening` |
| Tenant: autoridad multi-tenant (`common`/`organizations`) desactiva el SSO; `tid` del token comparado con el GUID configurado | PASS | tests |
| Código de un solo uso (60 s) en vez del JWT en la URL; Android además exige el verificador PKCE | PASS | tests auth + frontend |
| Dominio institucional obligatorio (`@uta.edu.ec`), rol solo desde la BD (nunca por correo) | PASS | `authService.ts` |
| Login local: bcrypt 12, política de contraseña, mensaje genérico, igualación de tiempo con hash ficticio, limitador por IP y por cuenta con memoria acotada, límite nginx `10r/m` | PASS | tests `loginPassword`, `securityHardening`; simulación (nginx) |
| `dev-login` y login simulado: 404 con `NODE_ENV=production` aunque la variable esté en `true`; seeds no crean cuentas demo en producción | PASS | tests `insecureLoginGuard`; simulación ("Sin cuentas demo") |
| JWT HS256 fijado, secreto ≥ 32 en producción, `jti` único, tokens de servicio con audiencia propia nunca aceptados como sesión | PASS | tests |
| Sesiones: solo SHA-256 del JWT en `sessions`; logout y cambio de contraseña revocan; purga periódica | PASS | tests; simulación ("Sesiones guardadas solo como SHA-256") |
| **Ventana de revocación en ticket/catalog** | **mejorada hoy**: caché positiva 5 s (antes 30 s), negativa 60 s; ≤ 1 consulta a auth-service cada 5 s por token activo | test "tras expirar la caché positiva, la revocación se aplica" |
| Bootstrap del administrador: contraseña temporal aleatoria en archivo 0600, cambio obligatorio, nunca un segundo admin automático | PASS | simulación 61/61 |

## 2. Autorización

- Regla única `ticketAccess` (propietario / técnico del área o asignado / admin) en detalle, historial, adjuntos y constancias; técnico de la otra área → 403. PASS (tests `areaIsolation`, smoke 48/48, E2E 105/105).
- Solo el propietario acepta o rechaza; admin y técnicos → 403. PASS.
- Escrituras condicionadas: aceptar, escalar, resolver (hoy), aceptar/rechazar la solución, asignación del admin con guardas (hoy). PASS (tests de conflicto P2025 → 409).
- `includeInactive=true` en servicios y ubicaciones exige administrador (hoy). PASS (tests, 401/403).
- Bloques: solo clasifican técnicos; DTIC nunca tiene bloque; no otorgan ni restringen acceso. PASS.

## 3. Revisión por categoría

| Categoría | Resultado |
|---|---|
| SQL injection | No encontrada: Prisma parametrizado; 7 consultas T-SQL con parámetros posicionales; DDL fijo |
| XSS | No encontrada: React escapa; reportes/historial impresos y correos usan `esc()`; test de escape en plantillas |
| CSRF / login CSRF | Protegido: JWT en cabecera (no cookies de sesión); `state` + cookie en SSO |
| IDOR | No encontrada: `ticketAccess`, adjunto debe pertenecer al ticket, lookup solo UUID |
| Path traversal | No: nombre de archivo generado, `path.basename` + prefijo del directorio |
| SSRF | No: ninguna URL de usuario se solicita desde el servidor; Nodemailer 10 sin `raw`/adjuntos de usuario |
| CORS | **Corregido 14-nov**: el gateway es la única autoridad (elimina `Access-Control-*` del servicio interno); lista de orígenes (frontend, `https://localhost` Android) |
| CSP | Activa en nginx (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`…); **probada hoy con backend real**: 0 violaciones al cargar la SPA, generar e imprimir un reporte (PDF de 144 KB) |
| Cookies | Solo las de `state`/reto SSO: HttpOnly, SameSite=Lax, Secure con https, 10 min, un solo uso |
| JWT | HS256 fijado, `aud` rechazada en sesiones de usuario, hash en BD |
| Uploads | Tipo real por bytes (JPG/PNG/WebP; HEIC rechazado con mensaje), 5 × 5 MB, nombre aleatorio, solo por endpoint autenticado |
| Enumeración de usuarios | Mensaje único "Credenciales inválidas", tiempo igualado |
| Rate limiting | auth-service (IP + cuenta) y nginx (`/api/auth/login`) |
| Cabeceras | HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP; `server_tokens off` |
| Logs | Sin códigos OAuth, `state`, tokens ni contraseñas (redacción en gateway y auth; verificado en simulación y DR) |
| Dependencias | **Actualizadas hoy**: nodemailer 10.5, msal-node 7.2, react-router-dom 7.18, vite 7.3 + plugin-react 5.2, zod 3.25.76 (última 3.x). `npm audit`: frontend 0; gateway 7 *low* (jest, solo desarrollo); auth 7 *low* (jest); catalog y ticket 7 *low* (jest) + **zod *high*** (solo lo cierra zod 4) |
| Secretos | gitleaks sobre el historial: 4 falsos positivos (valores de prueba deliberadamente incorrectos); árbol sin secretos; `.env*`, `google-services.json`, keystores, claves ignorados; el paquete los excluye y lo verifica |
| Docker | Node sin root (`setpriv`/`USER node`), `no-new-privileges`, SQL Server uid 10001, redes aisladas, puertos solo loopback, imágenes fijadas, límites de memoria/CPU, logs rotados |
| Archivos públicos | `/uploads/` 404 en nginx y sin ruta estática; catálogo y ubicaciones activas públicas por diseño |

### Mitigación del aviso de zod (3.x)

El aviso (consumo de memoria con colecciones acotadas enormes) solo lo cierra zod 4, cuya migración cambia la API de errores (`errorMap`, `required_error`) y la validación de UUID. Mitigación vigente: cuerpos JSON limitados (32 kB en auth, 100 kB en el resto), listas limitadas (≤ 20 elementos), nginx `client_max_body_size 30m` solo para multipart de imágenes. Tarea controlada: migrar a zod 4 con sus tests cuando se planifique una versión mayor.

## 4. Incidente heredado: VPS anterior y repositorio público

Situación: el repositorio público `ProyectoMetodologiasAgiles` conserva en `origin/Develop` contraseñas demo y correos personales; el VPS `servicedesk-uta.site` ejecuta código anterior a estas correcciones (incluido S1: `GET /api/catalog/services/<id no UUID>` sin autenticar tumbaba el catálogo) y publica 8080/3000. **Ninguna acción se ejecutó**; procedimiento preparado para cuando el propietario lo autorice:

1. **GitHub**: Settings → Danger zone → *Change visibility* → Private. Si debe seguir público, purgar el historial (`git filter-repo`) y forzar nuevos clones; no usar `--mirror`.
2. **Backup previo** en el VPS: `/usr/local/sbin/servicedesk-backup-mssql.sh` y copia de `/opt/servicedesk-uta/.env.mssql` y del volumen `servicedesk-uta_ticket-uploads`.
3. **Parche mínimo sin redeploy** (nginx del VPS): `location = /api/auth/microsoft-simulate { return 404; } location = /api/auth/dev-login { return 404; }` y, para S1, `location ~* ^/api/catalog/services/(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)[^/]+$ { return 400; }`; `nginx -t && systemctl reload nginx`.
4. **Redeploy del código corregido** (mejor que 3): copiar el paquete RC6, reconstruir imágenes con `docker-compose.prod-mssql.yml` (nunca `down -v`).
5. **Cuentas demo**: `scripts/operations/manage-user.sh reset-password <correo>` para cada una (o `set-role … user`) con `AUTH_CONTAINER=sd-auth`; revocar sesiones (`UPDATE dbo.sessions SET revoked_at = SYSUTCDATETIME() WHERE revoked_at IS NULL` en `auth_db`).
6. **Rotación SQL**: nuevas contraseñas de `auth_user`, `catalog_user`, `ticket_user` y `sa` (`ALTER LOGIN … WITH PASSWORD`), actualizar `.env.mssql`, recrear servicios.
7. **JWT_SECRET** nuevo (invalida todas las sesiones; avisar a los usuarios).
8. **root**: nueva contraseña, clave SSH, `PasswordAuthentication no`, puerto 2222 en UFW.
9. **Puertos**: `API_GATEWAY_PORT=127.0.0.1:8080`, `FRONTEND_PORT=127.0.0.1:3000` en el compose del VPS; `ufw deny 8080`, `ufw deny 3000`.
10. **Logs**: revisar `auth_logs` (`/auth/microsoft-simulate`, `/auth/dev-login`) y `journalctl -u nginx` desde el 2026-09-15 para accesos no reconocidos.
11. Renombrar el compose PostgreSQL residual para que `docker compose up` sin `-f` no lo use.

## 5. Pendientes de seguridad

- Probar SSO real en el dominio nuevo (web y Android) y registrar la Redirect URI.
- Migración a zod 4 (tarea controlada) y seguimiento de avisos *low* de jest.
- B2 y custodios (ver `INFORME_FINAL_BACKUPS.md`).
- Incidente del VPS/GitHub (sección 4): solo con autorización.
