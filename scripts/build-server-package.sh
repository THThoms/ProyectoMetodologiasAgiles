#!/usr/bin/env bash
# =============================================================================
# scripts/build-server-package.sh — genera el paquete de instalación del servidor
#
#   scripts/build-server-package.sh [VERSION]
#
# Salida (carpeta release/, excluida de Git):
#   release/servicedesk-uta-server-<VERSION>.tar.gz
#   release/servicedesk-uta-server-<VERSION>.tar.gz.sha256
#   release/servicedesk-uta-server-<VERSION>.MANIFEST.md   (también dentro del tar)
#   release/servicedesk-uta-server-<VERSION>.FILES.txt     (también dentro del tar)
#
# Incluye solo lo necesario para construir y operar en el servidor: fuentes de
# los 5 componentes, Dockerfiles, deploy/, scripts/ de servidor, .env.example y
# documentación vigente. EXCLUYE: .env reales, secretos, node_modules, dist,
# build, Android/APK, backups, uploads, .git, archivo PostgreSQL, historial.
#
# Verificaciones antes de empaquetar (aborta si fallan):
#   · ningún .env real, clave privada, keystore ni google-services.json
#   · ningún VALOR secreto de los .env locales aparece en el contenido
#   · ninguna referencia de runtime a PostgreSQL en deploy/ y scripts/
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
NAME="servicedesk-uta-server-$VERSION"
OUT="$ROOT/release"
STAGE="$(mktemp -d)/$NAME"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT
mkdir -p "$OUT" "$STAGE"

INCLUDE=(
  api-gateway auth-service catalog-service ticket-service frontend
  deploy scripts .env.example README.md
  docs/architecture docs/installation docs/operations docs/security docs/troubleshooting
)
EXCLUDES=(
  --exclude='node_modules' --exclude='dist' --exclude='build' --exclude='coverage'
  --exclude='*.tsbuildinfo' --exclude='.gradle' --exclude='frontend/android'
  --exclude='uploads/*' --exclude='*.log' --exclude='.DS_Store'
  --exclude='.env' --exclude='.env.*' --exclude='*/.env' --exclude='*/.env.*'
  --exclude='google-services.json' --exclude='*service-account*.json'
  --exclude='*.keystore' --exclude='*.jks' --exclude='*.pem' --exclude='*.key' --exclude='*.pfx'
  --exclude='*.apk' --exclude='*.aab' --exclude='*.bak' --exclude='*.tar.gz'
  --exclude='scripts/legacy' --exclude='.install-state*'
  --exclude='deploy/backup-lab' --exclude='*.pass' --exclude='backup.env' --exclude='scripts/testing/backup-dr-simulation.sh'
)
PRESENT=()
for p in "${INCLUDE[@]}"; do
  if [ -e "$p" ]; then PRESENT+=("$p"); else echo "  ⚠ no existe (se omite): $p"; fi
done
for req in api-gateway auth-service catalog-service ticket-service frontend deploy scripts .env.example; do
  [ -e "$req" ] || { echo "✘ Falta componente obligatorio: $req"; exit 1; }
done
echo "==> Copiando fuentes a staging"
tar -cf - "${EXCLUDES[@]}" "${PRESENT[@]}" | tar -xf - -C "$STAGE"
echo "$VERSION" > "$STAGE/VERSION"
# La plantilla .env.example sí debe ir (el patrón .env.* la habría excluido).
cp .env.example "$STAGE/.env.example"

echo "==> Verificaciones de seguridad"
bad="$(cd "$STAGE" && find . \( -name '.env' -o -name '.env.*' ! -name '.env.example' -o -name 'google-services.json' \
        -o -name '*.keystore' -o -name '*.jks' -o -name '*.pem' -o -name '*.key' -o -name '*.apk' \) -print)"
[ -z "$bad" ] || { echo "✘ Archivos prohibidos en el paquete:"; echo "$bad"; exit 1; }
grep -rIl -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$STAGE" && { echo "✘ Clave privada encontrada"; exit 1; } || true

# Valores secretos de los .env locales (no se imprimen; solo se cuentan).
SECRET_KEYS='PASSWORD|SECRET|PRIVATE_KEY|SMTP_PASS|API_KEY|CLIENT_SECRET|JWT_SECRET'
leaks=0; checked=0
for envf in .env .env.mssql deploy/server/.env; do
  [ -f "$envf" ] || continue
  while IFS= read -r line; do
    key="${line%%=*}"; val="${line#*=}"; val="${val%$'\r'}"; val="${val#\"}"; val="${val%\"}"
    [[ "$key" =~ $SECRET_KEYS ]] || continue
    [ "${#val}" -ge 8 ] || continue
    checked=$((checked + 1))
    if grep -rIqF -- "$val" "$STAGE"; then leaks=$((leaks + 1)); echo "✘ El valor de $key ($envf) aparece en el paquete"; fi
  done < <(grep -E '^[A-Z_]+=' "$envf")
done
[ "$leaks" -eq 0 ] || exit 1
echo "  ✔ $checked valores secretos locales comprobados: 0 apariciones"

pg="$(grep -rIniE --exclude=build-server-package.sh 'postgres|5432|pg_dump' "$STAGE/deploy" "$STAGE/scripts" | grep -viE '^[^:]+:[0-9]+:\s*#|PostgreSQL (fue|está) retirado|no (usa|requiere|instala) PostgreSQL|sin PostgreSQL|PostgreSQL retirado' || true)"
[ -z "$pg" ] || { echo "✘ Referencias de runtime a PostgreSQL:"; echo "$pg"; exit 1; }
echo "  ✔ deploy/ y scripts/ sin dependencias de PostgreSQL"
chmod +x "$STAGE"/scripts/*.sh "$STAGE"/scripts/*/*.sh "$STAGE"/deploy/server/mssql-init/init.sh 2>/dev/null || true

echo "==> Manifest"
GIT_REV="$(git rev-parse HEAD 2>/dev/null || echo 'sin git')"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
( cd "$STAGE" && find . -type f ! -name FILES.txt | LC_ALL=C sort | sed 's#^\./##' ) > "$STAGE/FILES.txt"
NFILES="$(wc -l < "$STAGE/FILES.txt" | tr -d ' ')"
cat > "$STAGE/MANIFEST.md" <<EOF
# ServiceDesk UTA — paquete de servidor \`$NAME\`

| Campo | Valor |
|---|---|
| Versión | \`$VERSION\` |
| Fecha (UTC) | $(date -u +%FT%TZ) |
| Commit base | \`$GIT_REV\` (archivos sin commitear al empaquetar: $DIRTY) |
| Archivos | $NFILES (lista completa en \`FILES.txt\`) |
| Motor de base de datos | SQL Server 2022 (único). PostgreSQL retirado: no se incluye. |

## Contenido
| Ruta | Para qué |
|---|---|
| \`auth-service/\`, \`catalog-service/\`, \`ticket-service/\` | Fuentes + \`Dockerfile.mssql\` + schemas Prisma (\`provider = "sqlserver"\`) |
| \`api-gateway/\`, \`frontend/\` | Fuentes + Dockerfile (la app Android no va en este paquete) |
| \`deploy/server/compose.yaml\` | Compose de producción (6 servicios + init) |
| \`deploy/server/mssql-init/\` | Bootstrap idempotente de bases y logins |
| \`deploy/nginx/\` | Plantillas nginx del host (TLS y arranque ACME) |
| \`deploy/systemd/\` | Timers de backup, verificación, retención, restore drill y alertas |
| \`deploy/backup/\` | Plantilla de /etc/servicedesk/backup.env (Restic → B2/S3) |
| \`scripts/install-server.sh\` | Instalador (\`--mode clean\` / \`--mode restore\`) |
| \`scripts/backup-mssql.sh\`, \`scripts/restore-mssql.sh\` | Backup y restauración |
| \`scripts/backup/\` | Restic: init, backup, check, retención, restauración, claves, restore drill |
| \`scripts/operations/\` | Smoke, gestión de usuarios, verificación de backups, alertas |
| \`scripts/testing/smoke-e2e.mjs\` | Prueba E2E funcional (requiere Node 20+, opcional) |
| \`.env.example\` | Plantilla única de configuración (sin valores) |
| \`docs/\` | Arquitectura, instalación, operación, seguridad y solución de problemas |

## Qué NO contiene
Ningún \`.env\` real, contraseña, JWT, clave FCM, service account de Firebase,
credencial SMTP o Cloudinary, certificado TLS, APK, \`node_modules\`, backups,
imágenes de usuarios, datos personales, \`.git\` ni archivos de PostgreSQL.

## Verificar e instalar
\`\`\`bash
sha256sum -c $NAME.tar.gz.sha256
sudo mkdir -p /opt/servicedesk && sudo tar -xzf $NAME.tar.gz -C /opt/servicedesk --strip-components=1
cd /opt/servicedesk && less docs/installation/INSTALACION_SERVIDOR_NUEVO.md
\`\`\`
Backup: \`docs/operations/BACKUPS_MSSQL.md\` · Restore y rollback: \`docs/operations/RESTAURACION_Y_ROLLBACK.md\`
EOF
( cd "$STAGE" && find . -type f ! -name FILES.txt | LC_ALL=C sort | sed 's#^\./##' ) > "$STAGE/FILES.txt"

echo "==> Empaquetando"
TARBALL="$OUT/$NAME.tar.gz"
MTIME="$(git log -1 --format=%cI 2>/dev/null || date -u +%FT%TZ)"
( cd "$(dirname "$STAGE")" && tar --sort=name --mtime="$MTIME" --owner=0 --group=0 --numeric-owner -cf - "$NAME" | gzip -n -9 > "$TARBALL" )
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
cp "$STAGE/MANIFEST.md" "$OUT/$NAME.MANIFEST.md"
cp "$STAGE/FILES.txt" "$OUT/$NAME.FILES.txt"
echo "✔ $TARBALL ($(du -h "$TARBALL" | cut -f1), $NFILES archivos)"
echo "✔ $(cat "$OUT/$NAME.tar.gz.sha256")"
