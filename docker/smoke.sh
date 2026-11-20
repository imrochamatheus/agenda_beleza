#!/bin/sh
# Smoke da imagem (D-012, correção R-A): sobe o compose do zero e prova que a app atende.
# É o mesmo comando do job `docker` da CI (.github/workflows/ci.yml); localmente:
#   sh docker/smoke.sh            (porta 3000 livre; não derruba nada ao terminar)
# Falha (exit != 0) se algum serviço não ficar saudável, se /api/health não responder 200 ou se
# as páginas com token na URL perderem o cabeçalho Referrer-Policy definido em next.config.ts.
set -eu

URL_BASE="${SMOKE_URL_BASE:-http://localhost:3000}"
ESPERA_S="${SMOKE_WAIT_TIMEOUT:-180}"

falhar() {
  echo "smoke: FALHOU: $1" >&2
  docker compose ps -a >&2 || true
  docker compose logs --no-color --tail=80 app worker >&2 || true
  exit 1
}

echo "smoke: docker compose up -d --build --wait (até ${ESPERA_S}s)"
docker compose up -d --build --wait --wait-timeout "$ESPERA_S" || falhar "algum serviço não ficou saudável"

status=$(curl -sS -o /dev/null -w '%{http_code}' "$URL_BASE/api/health") || falhar "GET /api/health sem resposta"
[ "$status" = "200" ] || falhar "GET /api/health respondeu $status"
echo "smoke: GET /api/health -> 200"

for caminho in /confirmar-email /redefinir-senha; do
  cabecalhos=$(curl -sS -o /dev/null -D - "$URL_BASE$caminho") || falhar "GET $caminho sem resposta"
  printf '%s\n' "$cabecalhos" | tr -d '\r' | grep -qix 'referrer-policy: strict-origin' \
    || falhar "GET $caminho sem 'referrer-policy: strict-origin'"
  echo "smoke: GET $caminho -> referrer-policy: strict-origin"
done

echo "smoke: OK"
