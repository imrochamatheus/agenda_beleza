# D-027 (E4.2) — Implementação (T-2 a T-6)

## Tarefas e arquivos
- **T-2 (núcleo e env):** `src/server/protecao/{tipos,config,ip,chaves,widget-tipos}.ts`; `src/server/env.ts` (`TRUSTED_PROXY_HOPS`, `RATE_LIMIT_SEGREDO`, `PROTECAO_*`, `lerProtecao`; segredo exigido em produção), `.env.example`, `docker-compose.yml` (segredo local do compose, pois a imagem roda com `NODE_ENV=production`).
- **T-3 (limite e limpeza):** `protecao/{limite,limpeza}.ts`, `repos/rate-limit.ts` (`removerExpiradas`, lote com `FOR UPDATE SKIP LOCKED` do parecer do DBA), `worker/handlers/limpar-rate-limit.ts` (cron `17 * * * *` UTC), `registry.ts`, contrato `limpar-rate-limit` em `queue/filas.ts`.
- **T-4 (futuras e Turnstile):** `repos/reserva.ts` (`contarFuturasDaCliente`), `protecao/{futuras,turnstile}.ts`.
- **T-5 (serviço e página):** `reserva-publica/{servico,tipos,pagina}.ts` (resultado `limitado`, `carregarPassoComLimite`, visão `limitado`), `(publico)/[slug]/{page,acoes,formulario}.ts(x)`, `_componentes/{WidgetTurnstile,FormularioDados,PaginaDoSalao}.tsx`, `protecao/widget.ts`, vitrine `/dev/reserva` (`?vista=limitado`, ação com Turnstile simulado), `integrations/turnstile/{port,simulado}.ts` (token e URL do script movidos para `port.ts` por causa do lint RN-16; `simulado.ts` reexporta).
- **T-6:** `e2e/protecao.spec.ts`, `e2e/protecao-sem-js.spec.ts`, README (seção "Proteção da página pública"). CLAUDE.md fica para o líder.

## Testes (CA)
- Unidade: `protecao/{ip,chaves,config,limite,limpeza,turnstile,futuras,widget}.test.ts`, `WidgetTurnstile.test.tsx`, `limpar-rate-limit.test.ts`, `env.test.ts`/`check-env.test.ts` (CA-15, CA-6, segredo), ajustes em `handlers/iniciar/filas.test.ts`.
- Integração (PostgreSQL real) `tests/integration/protecao/`: `reserva-publica` (CA-1, CA-2, CA-3, CA-4, CA-5, CA-9, CA-10, CA-16, CA-17, idempotência, isolamento entre salões), `concorrencia` (CA-7: 2 futuras + 2 com barreira dentro das transações, 5 e 10 em paralelo, cliente nova, profissionais iguais e diferentes), `limites` (CA-11, CA-12, incrementos paralelos, lotes), `pagina-limite` (CA-8, CA-14), `futuras-repo`. `acao.test.ts`/`pagina.test.ts` (D-026) passaram a simular `next/headers`.
- E2E: CA-5/CA-10/CA-13/CA-14 (com e sem JS, 375×812, axe, teclado).

## Bug achado pelos testes
`chave_requisicao IS DISTINCT FROM NULL` excluía reservas sem chave (equipe) da contagem de futuras; corrigido com `(:chave IS NULL OR … IS DISTINCT FROM :chave)`.

## Desvios e riscos
- Sem desvio de arquitetura. O `Env` não ganhou campo `protecao` (lido por `lerProtecao`), para não mudar o contrato testado de `validarEnv`.
- Com `TRUSTED_PROXY_HOPS=0` (padrão) o App Router não expõe o IP do socket: todos caem em `desconhecido` (balde único, aceito no design R-2); documentado.
- Envios idênticos simultâneos de um mesmo número acima de `PROTECAO_LIMITE_NUMERO` ficam limitados (a checagem da chave precede o commit). O teste de 10 envios paralelos da D-026 sobe esse limite.
- Testes de integração dos limites usam IPs únicos por caso e `vi.stubEnv` (a configuração é lida a cada uso).
- Medição de cobertura e estabilidade: ver resposta ao líder.
