// =============================================================================
// scripts/check-uta-mssql.js — Fase E · Validación READ-ONLY del SQL Server UTA
//
// Objetivo
//   Conectar al SQL Server institucional (o al lab en modo dry-run) y ejecutar
//   ÚNICAMENTE consultas de metadatos. No escribe absolutamente nada.
//
// Reglas de seguridad
//   · SÓLO ejecuta SELECT.
//   · No hace INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER / CREATE.
//   · Si el servidor tolera esas operaciones, tampoco se ejecutan aquí.
//   · Nunca imprime la contraseña ni la connection string en claro.
//
// Uso
//   1) Copiar .env.uta.example a .env.uta y rellenar con datos del DBA.
//   2) Ejecutar:
//        node scripts/check-uta-mssql.js [--target=uta|lab]
//      · --target=uta (default): usa las variables UTA_MSSQL_* de .env.uta.
//      · --target=lab: usa .env.mssql, útil para verificar que el script
//        funciona sin tocar la instancia UTA todavía.
//
// Requisitos
//   npm i --no-save tedious dotenv  (o instalar tedious localmente)
//   O ejecutarlo en el contenedor node:20 con esos paquetes disponibles.
// =============================================================================
"use strict";

const path = require("path");
const fs = require("fs");

const argv = process.argv.slice(2);
const target = (argv.find((a) => a.startsWith("--target=")) || "--target=uta")
  .split("=")[1];

// -----------------------------------------------------------------------------
// Carga de .env (sin depender de dotenv si el usuario no lo tiene instalado).
// -----------------------------------------------------------------------------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const envFile = target === "lab" ? ".env.mssql" : ".env.uta";
const envAbs = path.resolve(process.cwd(), envFile);
const env = { ...process.env, ...loadEnvFile(envAbs) };

// -----------------------------------------------------------------------------
// Resolución de parámetros según target.
// -----------------------------------------------------------------------------
function param(name) {
  return typeof env[name] === "string" ? env[name].trim() : "";
}

let host, port, user, password, encrypt, trustCert, authDb, catalogDb, ticketDb;

if (target === "lab") {
  host = "localhost";
  port = Number(param("MSSQL_HOST_PORT") || 14330);
  user = "sa";
  password = param("MSSQL_SA_PASSWORD");
  encrypt = true;
  trustCert = true;
  authDb = param("AUTH_DB_NAME") || "auth_db";
  catalogDb = param("CATALOG_DB_NAME") || "catalog_db";
  ticketDb = param("TICKET_DB_NAME") || "ticket_db";
} else {
  host = param("UTA_MSSQL_HOST");
  port = Number(param("UTA_MSSQL_PORT") || 1433);
  user = param("UTA_MSSQL_USER");
  password = param("UTA_MSSQL_PASSWORD");
  encrypt = (param("UTA_MSSQL_ENCRYPT") || "true").toLowerCase() === "true";
  trustCert = (param("UTA_MSSQL_TRUST_SERVER_CERTIFICATE") || "false").toLowerCase() === "true";
  authDb = param("UTA_AUTH_DB") || "auth_db";
  catalogDb = param("UTA_CATALOG_DB") || "catalog_db";
  ticketDb = param("UTA_TICKET_DB") || "ticket_db";
}

const missing = [];
if (!host) missing.push(target === "lab" ? "(host lab)" : "UTA_MSSQL_HOST");
if (!user) missing.push(target === "lab" ? "(user lab)" : "UTA_MSSQL_USER");
if (!password) missing.push(target === "lab" ? "MSSQL_SA_PASSWORD" : "UTA_MSSQL_PASSWORD");

console.log(`[check] archivo   = ${envFile}${fs.existsSync(envAbs) ? "" : "  (NO EXISTE)"}`);
console.log(`[check] target    = ${target}`);
console.log(`[check] host:port = ${host || "<vacío>"}:${port}`);
console.log(`[check] user      = ${user ? user : "<vacío>"}`);
console.log(`[check] encrypt   = ${encrypt}  trustCert = ${trustCert}`);
console.log(`[check] dbs       = ${authDb}, ${catalogDb}, ${ticketDb}`);
if (missing.length) {
  console.error(`\n❌ Faltan variables: ${missing.join(", ")}. Aborto sin conectar.`);
  process.exit(2);
}

// -----------------------------------------------------------------------------
// tedious (driver SQL Server para Node). Si no está instalado, damos guía.
// -----------------------------------------------------------------------------
let Connection, Request, TYPES;
try {
  ({ Connection, Request, TYPES } = require("tedious"));
} catch (e) {
  console.error("\n❌ Falta el paquete 'tedious'. Instalar con:");
  console.error("    npm install --no-save tedious");
  console.error("O ejecutar el script en el contenedor node:20 con tedious disponible.");
  process.exit(3);
}

function connect(database) {
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: host,
      authentication: {
        type: "default",
        options: { userName: user, password },
      },
      options: {
        port,
        database,
        encrypt,
        trustServerCertificate: trustCert,
        connectTimeout: Number(param("UTA_MSSQL_CONNECT_TIMEOUT") || 15) * 1000,
        appName: param("UTA_MSSQL_APP_NAME") || "ServiceDeskUTA-Check",
        rowCollectionOnRequestCompletion: true,
        useColumnNames: true,
      },
    });
    conn.on("connect", (err) => (err ? reject(err) : resolve(conn)));
    conn.connect();
  });
}

function query(conn, sql) {
  return new Promise((resolve, reject) => {
    const request = new Request(sql, (err, rowCount, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
    conn.execSql(request);
  });
}

// -----------------------------------------------------------------------------
// Guardarraíl: si por accidente alguien edita este script y añade texto que
// parezca DML/DDL, abortamos antes de conectar. Doble red de seguridad.
// -----------------------------------------------------------------------------
const forbidden = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|ALTER|EXEC|MERGE|GRANT|REVOKE|DENY)\b/i;
function safe(sql) {
  if (forbidden.test(sql)) throw new Error(`SQL bloqueado: contiene DML/DDL — ${sql}`);
  return sql;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  console.log("\n== 1) Conexión al servidor (master) ==");
  let master;
  try {
    master = await connect("master");
    console.log("  ✔ conexión establecida");
  } catch (e) {
    console.error(`  ✘ conexión fallida: ${e.message}`);
    process.exit(4);
  }

  const info = await query(
    master,
    safe(
      "SELECT @@SERVERNAME AS server, @@VERSION AS version, DB_NAME() AS db, " +
        "ORIGINAL_LOGIN() AS login_user, SUSER_SNAME() AS effective_user, " +
        "SYSUTCDATETIME() AS utc_now, SERVERPROPERTY('Collation') AS server_collation"
    )
  );
  const r = info[0] || {};
  console.log(`  · server              = ${r.server?.value ?? "n/a"}`);
  console.log(`  · version             = ${(r.version?.value ?? "").split("\n")[0]}`);
  console.log(`  · db (contexto)       = ${r.db?.value ?? "n/a"}`);
  console.log(`  · login_user          = ${r.login_user?.value ?? "n/a"}`);
  console.log(`  · effective_user      = ${r.effective_user?.value ?? "n/a"}`);
  console.log(`  · utc_now             = ${r.utc_now?.value?.toISOString?.() ?? r.utc_now?.value}`);
  console.log(`  · server_collation    = ${r.server_collation?.value ?? "n/a"}`);

  console.log("\n== 2) Acceso a sys.databases ==");
  let dbs;
  try {
    dbs = await query(
      master,
      safe(
        "SELECT name, collation_name, state_desc, recovery_model_desc " +
          "FROM sys.databases WHERE database_id > 4 ORDER BY name"
      )
    );
  } catch (e) {
    console.log(`  · sin permiso para leer sys.databases: ${e.message}`);
    dbs = [];
  }
  for (const row of dbs) {
    console.log(
      `  · ${row.name.value} — collation=${row.collation_name.value}  state=${row.state_desc.value}  recovery=${row.recovery_model_desc.value}`
    );
  }

  console.log("\n== 3) Presencia de las 3 bases esperadas ==");
  const expected = { auth: authDb, catalog: catalogDb, ticket: ticketDb };
  const dbNames = new Set(dbs.map((r) => r.name.value));
  const dbCollations = Object.fromEntries(dbs.map((r) => [r.name.value, r.collation_name.value]));
  for (const [key, name] of Object.entries(expected)) {
    if (dbNames.has(name)) {
      console.log(`  ✔ ${key}: ${name}  (collation=${dbCollations[name]})`);
    } else {
      console.log(`  · ${key}: ${name}  — NO EXISTE (el DBA debe crearla)`);
    }
  }

  console.log("\n== 4) Permisos efectivos (server-level) ==");
  try {
    const perms = await query(
      master,
      safe("SELECT permission_name FROM sys.fn_my_permissions(NULL, 'SERVER') ORDER BY permission_name")
    );
    console.log(`  · permisos server: ${perms.map((r) => r.permission_name.value).join(", ") || "<ninguno>"}`);
  } catch (e) {
    console.log(`  · sin visibilidad a fn_my_permissions server: ${e.message}`);
  }

  master.close();

  console.log("\n== 5) Inspección por base (READ-ONLY) ==");
  for (const [key, dbName] of Object.entries(expected)) {
    if (!dbNames.has(dbName)) {
      console.log(`\n· ${dbName}: (no existe — se omite inspección)`);
      continue;
    }
    let conn;
    try {
      conn = await connect(dbName);
    } catch (e) {
      console.log(`\n· ${dbName}: no se pudo conectar (${e.message})`);
      continue;
    }
    console.log(`\n· ${dbName} (conectado)`);
    // Colación de la base
    const c = await query(
      conn,
      safe(
        "SELECT DATABASEPROPERTYEX(DB_NAME(),'Collation') AS db_collation, " +
          "USER_NAME() AS db_user"
      )
    );
    console.log(`    collation = ${c[0].db_collation.value}`);
    console.log(`    db_user   = ${c[0].db_user.value}`);

    // Permisos db-level
    try {
      const dbp = await query(
        conn,
        safe(
          "SELECT permission_name FROM sys.fn_my_permissions(NULL, 'DATABASE') ORDER BY permission_name"
        )
      );
      console.log(`    permisos db: ${dbp.map((r) => r.permission_name.value).join(", ") || "<ninguno>"}`);
    } catch (e) {
      console.log(`    permisos db: <no visibles> ${e.message}`);
    }

    // Tablas
    const tables = await query(
      conn,
      safe(
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES " +
          "WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME"
      )
    );
    console.log(`    tablas (${tables.length}):`);
    for (const t of tables) {
      console.log(`      - ${t.TABLE_SCHEMA.value}.${t.TABLE_NAME.value}`);
    }

    // Conteos sólo si tiene permiso; SELECT es READ-ONLY.
    for (const t of tables.slice(0, 20)) {
      try {
        const cnt = await query(
          conn,
          safe(`SELECT COUNT_BIG(*) AS n FROM [${t.TABLE_SCHEMA.value}].[${t.TABLE_NAME.value}]`)
        );
        console.log(`      · count(${t.TABLE_NAME.value}) = ${cnt[0].n.value}`);
      } catch (e) {
        console.log(`      · count(${t.TABLE_NAME.value}) = <sin permiso o error: ${e.message.split(/\r?\n/)[0]}>`);
      }
    }
    conn.close();
  }

  console.log("\n== 6) Recomendación de collation ==");
  const recommended = "SQL_Latin1_General_CP1_CI_AS";
  const serverCol = r.server_collation?.value ?? "";
  if (serverCol && serverCol !== recommended) {
    console.log(
      `  ⚠ collation del servidor '${serverCol}' difiere de la recomendada '${recommended}'.`
    );
    console.log(
      "    Implicación: las búsquedas del proyecto (KB / tickets) asumen CI. Si el server es CS,"
    );
    console.log(
      "    las queries `contains` sin `LOWER()` sólo matchearán case-sensitive."
    );
    console.log(
      "    Acción sugerida: crear las 3 bases con `COLLATE SQL_Latin1_General_CP1_CI_AS`."
    );
    console.log("    NO se ejecutará ALTER DATABASE desde este script.");
  } else if (serverCol) {
    console.log(`  ✔ collation servidor coincide con la recomendada (${serverCol}).`);
  }

  console.log("\n===== CHECK COMPLETO — SIN ESCRITURAS =====");
}

main().catch((e) => {
  console.error("\n❌ Error no controlado:", e.message);
  process.exit(1);
});
