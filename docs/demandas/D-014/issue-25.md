# Issue #25 — Gerenciar serviços e definir quais profissionais executam cada um

## Objetivo
Permitir ao gestor manter o catálogo de serviços e seus profissionais habilitados.

## Origem e contexto
PLAN.md, "Serviços e profissionais"; CLAUDE.md, invariante "Soft deletes". Atual: inexistente.

## Escopo
Listar, criar, editar, ativar/desativar serviço; vincular/desvincular profissionais; função de leitura de serviços públicos do salão (ativos e com ao menos um profissional ativo vinculado), usada por E3.1 e E4.1.

## Fora do escopo
Preço ou duração por profissional (fora da v1).

## Especificação
Decidido:
- RN-1: campos: nome (obrigatório), preço fixo em BRL (≥ 0, centavos), duração em minutos (> 0, múltiplo de 5), situação.
- RN-2: serviço nunca é apagado; desativar o remove da página pública e de novas reservas, sem alterar reservas existentes (snapshot).
- RN-3: alterar preço/duração não altera itens de reservas já criadas.
- RN-4: vínculo só com profissionais do mesmo salão.
- RN-5: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
- RN-6: nome duplicado no salão é permitido, sem aviso.
Casos limite: serviço sem profissional vinculado não aparece na página pública.

## Critérios de aceite
- [ ] CA-1: Dado o gestor, quando cria o serviço "Corte" a R$ 80,00 com 45 min, então ele aparece na lista como ativo.
- [ ] CA-2: Dado um serviço de R$ 80,00 com itens de reserva criados pela fábrica, quando o gestor altera o preço para R$ 90,00, então esses itens mantêm `preco_centavos = 8000` no banco.
- [ ] CA-3: Dado um serviço ativo, quando o gestor o desativa, então ele continua no banco com `ativo = false`, a função de leitura de serviços públicos do salão não o retorna e os itens de reserva existentes ficam inalterados.
- [ ] CA-4: Dado o gestor do salão A, quando tenta vincular um profissional do salão B, então a operação é recusada.
- [ ] CA-5: Dado duração 0 ou preço negativo, quando salva, então o servidor recusa com mensagem de validação.
- [ ] CA-6: Dado um profissional ativo do mesmo salão (fábrica), quando o gestor o vincula ao serviço, então o vínculo é persistido e aparece na edição do serviço.

## Validação
Unitários (validação); integração com PostgreSQL real (soft delete, snapshot, isolamento conforme G-4). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #15 (E2)
- Bloqueada por: #16 (E2.2)
- Bloqueia: #27 (E3.1)

## Entregáveis
- src/app/painel/servicos/** (lista, criar, editar, ativar/desativar, vínculo com profissionais)
- src/server/servicos/*.ts com schemas zod (preço em centavos ≥ 0, duração > 0 múltipla de 5)
- tests/integration/servicos/*.test.ts (CA-1..CA-5, soft delete, snapshot, isolamento)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E2.1`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E2.1 -->
