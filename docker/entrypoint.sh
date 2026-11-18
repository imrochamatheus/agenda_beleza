#!/bin/sh
# Entrypoint da imagem: `app` (migrate deploy + next start) ou `worker`.
# Usa exec para que o processo Node receba SIGTERM/SIGINT diretamente (RN-8).
set -eu

# Valida o ambiente nos dois papéis; sai com código != 0 nomeando a variável inválida.
node /app/dist/scripts/check-env.js

case "${1:-}" in
  app)
    # Só a app aplica migrações (RN-7); o worker nunca roda migrate.
    /app/node_modules/.bin/prisma migrate deploy
    exec node /app/node_modules/next/dist/bin/next start
    ;;
  worker)
    exec node /app/dist/worker/main.js
    ;;
  *)
    echo "uso: entrypoint.sh app|worker" >&2
    exit 64
    ;;
esac
