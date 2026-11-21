# D-021 — DevOps (T-1)

## O que mudou e por quê
- `package.json`/lock: `sharp` 0.35.5 e `@aws-sdk/client-s3` 3.1163.0 (publicada em 2026-11-05, 15 dias), exatas, em `dependencies`. `sharp` já era opcional do Next no lock; agora é direta. Sem `allowScripts` novo (sem script de instalação; binários em `@img/sharp-linux-x64` e `@img/sharp-libvips-linux-x64`, glibc). `npm ci --dry-run` ok.
- `Dockerfile` (final): `/app/.armazenamento` criado com dono `node` antes do `USER node` (o volume nomeado herda o dono).
- `docker-compose.yml`: volume `armazenamento` montado só no `app` em `/app/.armazenamento`; `environment` do `app` repete `DATABASE_URL` (merge raso da âncora) e define `ARMAZENAMENTO_DIR`. Worker não monta.
- `docker/smoke.sh`: após os cabeçalhos, `docker compose exec -T app node -e` prova que `sharp` converte para WebP e que `ARMAZENAMENTO_DIR` é gravável (arquivo `.smoke.tmp-teste`, fora do formato de chave, criado e apagado).
- `.gitignore`: `.armazenamento/`. CI: sem mudança (o job `docker` já roda o smoke). Sem variável nova no `.env.example` (é do T-3).

## Reproduzir
`npm ci`; `sh docker/smoke.sh` (porta 3000 livre).

## Evidência
- `sh docker/smoke.sh`: `/api/health -> 200`, `referrer-policy` nas duas páginas, `sharp converte para WebP e ARMAZENAMENTO_DIR é gravável`, `smoke: OK`.
- Persistência (CA-17, manual): marcador gravado como `node` em `/app/.armazenamento` (`drwxr-xr-x node node`), `docker compose down`, `up -d --wait`, marcador lido de volta (`marcador-d021`), removido. Não virou script.
- Estado final: só `postgres` no ar, porta 3000 livre.

## Riscos e pendências
- `npm audit` acusa 3 altas em `effect` (via Prisma), preexistentes e não ligadas a esta demanda.
- Memória do compose sem limite novo (não medida).
- Produção real exigirá `STORAGE_ADAPTER=real` e segredos `S3_*` no provedor (nada cadastrado).
