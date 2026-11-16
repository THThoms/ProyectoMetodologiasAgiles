#!/usr/bin/env sh
set -e
echo "[ticket-mssql] Aplicando prisma db push..."
# Fase P: PRISMA_ACCEPT_DATA_LOSS (default "true" = comportamiento histórico).
# El compose del servidor nuevo lo fija en "false": si un cambio de esquema
# implicara pérdida de datos, el arranque FALLA en vez de borrar columnas.
if [ "${PRISMA_ACCEPT_DATA_LOSS:-true}" = "true" ]; then
  npx prisma db push --skip-generate --accept-data-loss
else
  npx prisma db push --skip-generate
fi
echo "[ticket-mssql] Iniciando servicio Node como usuario sin privilegios (node)..."
# El proceso que atiende peticiones corre como `node`. El volumen de imágenes
# pudo crearse con otro propietario (las versiones anteriores corrían como root,
# y una restauración copia los archivos como root): se corrige al arrancar, solo
# en lo que haga falta. Si el contenedor ya arranca sin root, se ejecuta tal cual.
if [ "$(id -u)" = "0" ]; then
  UPLOADS="${UPLOAD_DIR:-/app/uploads}"
  mkdir -p "$UPLOADS"
  find "$UPLOADS" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec env HOME=/home/node setpriv --reuid=node --regid=node --init-groups node dist/index.js
fi
exec node dist/index.js
