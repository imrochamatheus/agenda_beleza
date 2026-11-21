# D-036 — testes (Rodada 1)
Ambiente: branch feat/d-036-seed-home-e2e (não commitado), Node 24, postgres:17 (compose), adaptadores simulados.

## Gates (reexecutados pelo tester)
- lint, typecheck, build: OK.
- `npm run test:coverage`: 470 arquivos / 5294 testes OK; linhas 99,25% (>= 90%). Na 1a execução 1 timeout de 5 s em `reservas/alteracao/concorrencia.test.ts` (carga; arquivo não tocado pela D-036; 3x isolado e a 2a cobertura passaram). Sem exclusões novas.
- `npm run test:e2e` completo 2x seguidas: 205/205 nas duas, retries 0, porta 3000 livre, sem concorrência.
- `sh docker/smoke.sh` OK; seed no container 2x com `SEED_PERMITIR_PRODUCAO=true` exit 0, totais iguais; sem a flag recusa (exit 1, nada gravado); `/studio-aurora` 200. app/worker derrubados.
- `npm run db:seed` local 2x: contagens iguais (salao/reserva/avaliacao/foto/cliente/usuario).
- Limites PROTECAO_* = 100000 só em `e2e/suporte/ambiente.ts` (playwright.config); ausentes de docker-compose/Dockerfile; `.env.example` mantém 10/60/5/5/5. CI: job `e2e` com service postgres:17 e TEST_DATABASE_URL. `build:node` é um único esbuild. D-021/spec.md inalterado. Sem `waitForTimeout`/`eslint-disable`/`any` em e2e/suporte e publico-*. Home sem "Trinks", preço/dias de `plano.ts`.

## CAs
CA-1..CA-15, CA-17..CA-24: passaram (integração `tests/integration/seed/`, unit `page.test.tsx`, E2E `landing`/`publico-*`; CI verde a confirmar pelo líder no push).
CA-16: NÃO atendido na letra (ver DEF-1).

## Defeitos
DEF-1 — Conflito de horário não preserva nome e telefone   Severidade: alta (CA-16 literal; contornável)   Estado: verificado (Rodada 2)
CA relacionado: CA-16 (D-036) / #44 CA-6
Passos: abrir `/e2e-reservas-N`, escolher serviços, horário, preencher dados; tomar o horário por fixture; confirmar.
Esperado (spec D-036 CA-16): volta à etapa do horário com serviços e dados preservados. D-026 CA-9/RN-10 exige só "volta ao passo de horário com horários atualizados" (e CA-10 preserva valores em erro de validação).
Observado: serviços/profissional/dia preservados (URL); nome e telefone não (comportamento D-026 pré-existente; declarado em dev.md).
Classe: validação/UX do fluxo público. Decisão do líder: (a) corrigir no fluxo da D-026 (preservar nome/telefone no redirecionamento) ou (b) emendar o CA-16 formalmente. Se (b), rebaixar a baixa e aprovar.
Observações baixas: home não traz o texto "sem limite de profissionais" (RN-10, sem CA); fotos PNG por zlib e chave `fotos/demo-…` (desvios documentados, aceitos).

## Rodada 2
lint, typecheck, build OK; cobertura 99,21% (470 arquivos, 5301 testes); `test:e2e` completo 2x: 206/206 nas duas; E2E sem banco (smoke, entrar, a11y-base, landing) sem .env/DATABASE_URL: 32/32. DEF-1 corrigido: conflito devolve estado `horario_indisponivel` na resposta (sem redirect, sem PII em URL), reenvio passa por `reservarPelaPagina` (consentimento, Turnstile, limite inalterados); contratos D-026 CA-9/RN-10 mantidos (o teste antigo de redirecionamento foi substituido por contrato equivalente na resposta). Home com "sem limite de profissionais".

## Veredito final: APROVADO
