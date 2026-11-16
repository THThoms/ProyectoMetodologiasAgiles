#!/usr/bin/env sh
set -e
echo "[catalog-mssql] Aplicando prisma db push..."
# Fase P: PRISMA_ACCEPT_DATA_LOSS (default "true" = comportamiento histórico).
# El compose del servidor nuevo lo fija en "false": si un cambio de esquema
# implicara pérdida de datos, el arranque FALLA en vez de borrar columnas.
if [ "${PRISMA_ACCEPT_DATA_LOSS:-true}" = "true" ]; then
  npx prisma db push --skip-generate --accept-data-loss
else
  npx prisma db push --skip-generate
fi
echo "[catalog-mssql] Ejecutando seed..."
# Fase P: RUN_SEED (default "true" = comportamiento histórico). En modo
# RESTAURACIÓN el instalador lo fija en "false" para no sembrar sobre datos reales.
if [ "${RUN_SEED:-true}" = "true" ]; then
  npx prisma db seed || echo "[catalog-mssql]   seed reportó fallo (posible re-ejecución idempotente); continuando."
else
  echo "[catalog-mssql] RUN_SEED=false — seed omitido."
fi
echo "[catalog-mssql] Iniciando servicio Node como usuario sin privilegios (node)..."
# Las tareas previas (db push, mantenimiento, seed) corren como root dentro del
# contenedor; el proceso que atiende peticiones NO. Si el contenedor ya arranca
# sin root (user: en compose), se ejecuta tal cual.
if [ "$(id -u)" = "0" ]; then
  exec env HOME=/home/node setpriv --reuid=node --regid=node --init-groups node dist/index.js
fi
exec node dist/index.js
