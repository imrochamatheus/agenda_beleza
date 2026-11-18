#!/bin/sh
# Cria a base de testes de integração a partir do nome em TEST_DATABASE_URL.
# Roda só na primeira inicialização (volume vazio). Para um volume já existente:
#   docker compose exec postgres createdb -U agenda agenda_beleza_test
set -eu

# Se este script falhar, o volume fica parcialmente inicializado: o initdb não roda de novo
# nos próximos `up`, e o Postgres sobe sem a base de teste (DBA A-1).
DICA='Corrija a variável e rode "docker compose down -v" (o volume ficou parcialmente inicializado).'

url="${TEST_DATABASE_URL:-}"
if [ -z "$url" ]; then
  echo "10-base-de-teste: TEST_DATABASE_URL vazia; nenhuma base de teste criada."
  exit 0
fi

# Nome da base: trecho depois da última "/", sem a query string.
nome="${url##*/}"
nome="${nome%%[?]*}"

# Até 63 caracteres: o Postgres trunca identificadores maiores (DBA A-2).
if ! printf '%s' "$nome" | grep -Eq '^[a-z0-9_]{1,63}$'; then
  echo "10-base-de-teste: nome de base inválido em TEST_DATABASE_URL (esperado [a-z0-9_], de 1 a 63 caracteres). $DICA" >&2
  exit 1
fi

# Proteção: a base de teste nunca pode ser a de desenvolvimento (RN-9) nem uma base do sistema (DBA A-2).
case "$nome" in
  "$POSTGRES_DB")
    echo "10-base-de-teste: TEST_DATABASE_URL aponta para a base de desenvolvimento ($POSTGRES_DB). $DICA" >&2
    exit 1
    ;;
  postgres|template0|template1)
    echo "10-base-de-teste: TEST_DATABASE_URL aponta para a base de sistema \"$nome\". $DICA" >&2
    exit 1
    ;;
esac

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$nome\""
echo "10-base-de-teste: base \"$nome\" criada."
