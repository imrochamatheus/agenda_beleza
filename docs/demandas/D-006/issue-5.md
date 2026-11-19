## Objetivo
Garantir que todo push/PR execute os mesmos gates da definição de pronto.

## Origem e contexto
CLAUDE.md, "Comandos e cobertura" ("A CI executa o mesmo comando") e "Definição de pronto". Atual: inexistente.

## Escopo
Workflow `.github/workflows/ci.yml` com os gates na ordem `npm ci → prisma generate → typecheck → lint → build → migrate deploy → test:coverage → e2e`, PostgreSQL de serviço (mesma major do compose, com `btree_gist` do contrib), e job de `docker build` (sem push) com `docker compose config`.

## Fora do escopo
Push de imagem, deploy e alteração dos workflows do Claude já existentes no repositório. A proteção da branch `main` exigindo os checks é passo manual do dono do repositório (pendência registrada, não CA).

## Especificação
Decidido:
- RN-1: a CI usa o mesmo comando de cobertura do desenvolvimento local; falha abaixo de 90% de linhas.
- RN-2: os testes de integração rodam contra PostgreSQL real com as migrações aplicadas; nenhum mock de banco.
- RN-3: a CI usa adaptadores simulados; nenhum segredo real é necessário.
- RN-4: `node-version-file: .nvmrc`; `permissions: contents: read`; `concurrency` cancela execuções antigas do mesmo ref.
- RN-5: relatório de cobertura e traces do Playwright publicados como artefatos.

## Critérios de aceite
- [ ] CA-1: Dado um PR, quando o workflow roda, então lint, typecheck, build, testes com cobertura e E2E são executados e o PR mostra o status de cada um.
- [ ] CA-2: Dado um PR descartável (fechado sem merge) que reduz a cobertura de linhas abaixo de 90%, quando o workflow roda, então o job de testes falha.
- [ ] CA-3: Dado um teste de integração mínimo (conexão e `SELECT 1`), quando o workflow roda, então ele se conecta ao serviço postgres da CI e passa.
- [ ] CA-4: Dado um PR, quando o workflow roda, então o job de `docker build` e `docker compose config` termina verde sem publicar imagem.

## Validação
Execução real do workflow em PRs de teste, com links dos runs registrados pelo tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #4 (E0.2)
- Bloqueia: #55 (E9.3)

## Entregáveis
- .github/workflows/ci.yml com jobs lint, typecheck, build, test:coverage (serviço postgres + migrate deploy) e test:e2e
- Artefatos: relatório de cobertura e traces do Playwright
- tests/integration/smoke-db.test.ts (SELECT 1)
- Links de runs (PR verde e PR com cobertura < 90% falhando) registrados pelo tester
- Job docker build (sem push) e docker compose config
- Pendência manual registrada: proteção da branch main exigindo os checks

## Papel responsável
- DevOps
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.3`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E0.3 -->
