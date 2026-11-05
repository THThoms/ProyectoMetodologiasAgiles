# Requisitos para el DBA institucional — ServiceDesk UTA

Este documento describe qué información y qué preparativos necesita el proyecto
para conectarse al **SQL Server institucional de la UTA**. Sirve como checklist
único para la reunión con el DBA. No se ha migrado nada todavía; la Fase E
prepara la infraestructura, la Fase F ejecutará el cambio real.

## Resumen ejecutivo

- El proyecto **ya funciona** con SQL Server 2022 (validado en laboratorio, ver
  reportes Fases B, C y D).
- Se necesitan **3 bases** (`auth_db`, `catalog_db`, `ticket_db`) con esquema
  aislado (patrón microservicios; sin FKs cruzadas entre bases).
- Se conecta con **Prisma 5.22 / provider `sqlserver`**.
- El motor debe ser **SQL Server 2019 o superior** (usamos `DATEDIFF_BIG` y
  `COUNT_BIG`, disponibles desde 2016; validado en 2022).
- Cifrado TLS **obligatorio** en tránsito.
- Colación recomendada: `SQL_Latin1_General_CP1_CI_AS` (case-insensitive,
  compatible con `UTF-8` para NVarChar).

## 1. Datos de conexión que se necesitan del DBA

Rellenar en `.env.uta` (nunca commitear):

| Variable | Descripción | ¿Obligatorio? |
|---|---|---|
| `UTA_MSSQL_HOST` | FQDN o IP del servidor. | Sí |
| `UTA_MSSQL_PORT` | Puerto TCP (default 1433). | Sí |
| `UTA_MSSQL_USER` / `UTA_MSSQL_PASSWORD` | Cuenta única con acceso a las 3 bases *(forma A)*. | Sí (o bien la forma B) |
| `UTA_AUTH_USER` / `UTA_AUTH_PASSWORD` | Cuenta específica para `auth_db` *(forma B)*. | Alternativa |
| `UTA_CATALOG_USER` / `UTA_CATALOG_PASSWORD` | Cuenta específica para `catalog_db`. | Alternativa |
| `UTA_TICKET_USER` / `UTA_TICKET_PASSWORD` | Cuenta específica para `ticket_db`. | Alternativa |
| `UTA_MSSQL_ENCRYPT` | `true` (obligatorio). | Sí |
| `UTA_MSSQL_TRUST_SERVER_CERTIFICATE` | `true` si el cert del server es autofirmado; `false` si es de CA pública. | Depende |
| `UTA_AUTH_DB` / `UTA_CATALOG_DB` / `UTA_TICKET_DB` | Nombres reales de las 3 bases. | Sí |
| `UTA_MSSQL_SCHEMA` | Nombre del schema (default `dbo`). | Opcional |

## 2. Tipo de autenticación

**Preferido**: SQL Authentication (usuario + contraseña).

Alternativa: Windows Authentication con Kerberos — más complejo desde
contenedores Linux; requiere infra de Active Directory expuesta. Documentar si
el DBA solo permite Kerberos.

## 3. Permisos necesarios

Para cada cuenta (una única o tres específicas), sobre su(s) base(s):

**Durante la instalación / bootstrap (una sola vez)**:
- `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP TABLE` (Prisma db push
  crea/modifica el esquema).
- `db_ddladmin` cubre este set.

**En operación normal**:
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre todas las tablas.
- `db_datareader` + `db_datawriter` cubren este set.

**Recomendación final**: agregar la(s) cuenta(s) al rol `db_owner` durante la
instalación; **después** revocar y dejar solo `db_datareader` + `db_datawriter`
para operación diaria. El proyecto no requiere permisos server-level
(no usa Linked Servers, no crea logins, no toca `master`).

## 4. Bases requeridas

Tres bases separadas, sin FKs entre ellas:

- `auth_db` — usuarios, sesiones, logs de auditoría.
- `catalog_db` — servicios, ubicaciones, base de conocimiento, reglas de
  enrutamiento.
- `ticket_db` — tickets, eventos, adjuntos (solo URLs), outbox de correo,
  device tokens FCM.

**Preguntas al DBA**:
1. ¿Las bases ya existen o el equipo del ServiceDesk las crea?
2. ¿El DBA prefiere que Prisma haga `CREATE TABLE` durante el bootstrap, o
   que el DBA reciba el DDL y lo aplique manualmente?
3. ¿Hay restricciones de tamaño por base? (Nuestra estimación inicial: <
   1 GiB por base a mediano plazo.)
4. ¿Recovery model esperado? (Full/Simple/Bulk-logged.)

## 5. Colación

- Recomendación: **`SQL_Latin1_General_CP1_CI_AS`** — case-insensitive +
  accent-sensitive.
- Motivo: elimina la necesidad de `LOWER()` en búsquedas KB / tickets (la app
  ya asume CI).
- El script `scripts/check-uta-mssql.js` reporta la colación real y advierte
  si difiere de la recomendada.

## 6. Cifrado / TLS

- Cifrado en tránsito **obligatorio**.
- Si el servidor tiene certificado de CA pública: `TrustServerCertificate=false`.
- Si el servidor tiene certificado autofirmado (o CA interna UTA no publicada):
  `TrustServerCertificate=true` — se acepta el cert sin validar cadena.
- El certificado del servidor debe cubrir el CN/SAN del `UTA_MSSQL_HOST`.

## 7. Restricciones de firewall / red

**Preguntas al DBA**:
1. ¿Está permitido el tráfico desde el VPS (`<IP_VPS>`) al puerto del
   SQL Server?
2. ¿Requiere IP whitelisting o VPN entre el VPS y la red institucional?
3. ¿Existe un jump host / bastion obligatorio?
4. ¿Hay ventana horaria para tráfico DDL (bootstrap Prisma) vs. tráfico DML
   (operación normal)?

El script `scripts/check-uta-mssql.js` puede correrse desde el VPS para
comprobar el acceso TCP antes de intentar cualquier operación.

## 8. Servicio institucional: ¿el DBA participa o no?

- **Escenario A**: El DBA crea las 3 bases + una cuenta, entrega credenciales,
  el equipo ServiceDesk hace todo lo demás.
- **Escenario B**: El DBA crea las 3 bases + 3 cuentas (privilegio mínimo por
  base), entrega credenciales, el equipo ServiceDesk hace lo demás.
- **Escenario C**: El DBA ejecuta él mismo los DDL (Prisma exporta el SQL
  crudo); el equipo del ServiceDesk envía los `.sql` para aprobación.

Preferido: **A** o **B**. **C** implica un flujo de aprobación por DDL que
complica cada evolución del esquema.

## 9. Backup / retención institucional

**Preguntas al DBA**:
1. ¿El DBA hace backups automáticos de las 3 bases?
2. Frecuencia y retención (por ejemplo: diarios, 30 días).
3. ¿A qué destino se hace el backup? (Storage institucional, cinta, cloud.)
4. ¿El equipo del ServiceDesk necesita hacer backup adicional o basta con el
   institucional?
5. ¿Cuál es el procedimiento de restore (RPO/RTO)?

## 10. Auditoría y contactos

- Nombre y contacto del DBA responsable.
- Canal seguro para credenciales (KeePass, Bitwarden, PGP).
- Método para reportar incidentes / cambios (ticket interno, email).
- Contacto de emergencia (fuera de horario) si se cae la instancia SQL Server.

## 11. Antes de la Fase F (cambio de producción)

Confirmar con el DBA:
- [ ] Bases creadas o instrucción para crearlas.
- [ ] Credenciales entregadas por canal seguro.
- [ ] Conectividad desde VPS validada (comando `nc -vz` documentado abajo).
- [ ] Colación acorde a la recomendación.
- [ ] TLS validado.
- [ ] Ventana de mantenimiento acordada (~2 horas la primera vez).
- [ ] Contacto disponible durante la ventana.

Prueba de red desde VPS **cuando ya tengamos los datos**:
```bash
# Sustituir <HOST> y <PORT> por los reales; nunca inventar.
nc -vz <UTA_MSSQL_HOST> <UTA_MSSQL_PORT>
# o
timeout 5 bash -c '</dev/tcp/<UTA_MSSQL_HOST>/<UTA_MSSQL_PORT>' && echo OK
```

Prueba de conexión (sin escribir datos):
```bash
node scripts/check-uta-mssql.js
```

## 12. Qué NO se necesita del DBA UTA

Para claridad:
- **No** se necesita acceso SSH al servidor SQL.
- **No** se necesita permiso para `xp_cmdshell` u otras extensiones peligrosas.
- **No** se necesita crear Linked Servers.
- **No** se necesita modificar `master` ni `msdb`.
- **No** se necesita SQL Server Agent jobs (el proyecto no los usa).
- **No** se necesita replicación ni AlwaysOn (single instance basta).
