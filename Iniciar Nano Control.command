#!/bin/bash
# Doble clic en el Finder para arrancar Nano Control en el Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js. Instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir este archivo."
  read -n 1 -s -r -p "Pulsa una tecla para salir"; exit 1
fi
[ -d node_modules ] || npm install --omit=dev
exec node bridge/server.js "$@"
