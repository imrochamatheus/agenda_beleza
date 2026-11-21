# D-032 T-2 DevOps

- `AVALIACAO_SEGREDO` (HMAC dos links de avaliação, >= 32 caracteres): `src/server/env.ts` (obrigatória só com `NODE_ENV=production`, no `check-env`; fora do `Env`), teste em `env.test.ts`, `.env.example` (vazio), `docker-compose.yml` (app e worker, padrão local), README (tabela de variáveis, rotação invalida links não usados).
- CI: nenhuma mudança (testes e smoke não rodam em produção sem compose; o compose já traz o padrão).
- Sem ferramenta nova. Pendente manual: definir segredo real no provedor de produção.
- Verificação: `npm run lint`, `npm run typecheck`, `npx vitest run --project unit src/server/env.test.ts src/server/check-env`.
