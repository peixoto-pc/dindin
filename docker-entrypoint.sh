#!/bin/sh

echo "Rodando migrations..."
MIGRATED=0
for i in 1 2 3 4 5; do
  if NODE_PATH=/app/migrate/node_modules /app/migrate/node_modules/.bin/drizzle-kit push; then
    MIGRATED=1
    break
  fi
  echo "Tentativa $i/5 falhou. Aguardando 5s..."
  sleep 5
done

[ "$MIGRATED" -eq 0 ] && echo "Aviso: migrations não foram aplicadas."

exec "$@"
