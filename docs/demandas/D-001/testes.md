# D-001 — Testes (tester) — Rodada 1

Objeto: testabilidade do **backlog** (não há código). Fontes lidas: `PLAN.md` (11 CAs), `CLAUDE.md` (gate de cobertura), `spec.md` (55 blocos `### ITEM`), bloco ```json backlog de `design.md` (§13), `dev.md`, `devops.md`, `dba.md`.

Verificações automatizadas executadas (script Python sobre o spec e o JSON extraído de `design.md` linhas 259–1649):
- chaves do spec = chaves do JSON, mesma ordem: **sim** (55 = 55, diferença vazia);
- toda chave citada na tabela R1 existe no JSON: **sim** (11 linhas, nenhuma chave ausente);
- sub-issues fora de R1: `E2.5`, `E4.3`, `E9.1`;
- fecho transitivo de `blocked_by` cruzado com as referências feitas nos CAs (resultado na seção 2, coluna "Classe");
- seções "Validação" sem "Gate padrão": E0.3, E4.4, E9.3, E9.4; sem menção a testes unitários: 22 sub-issues (ver DEF-B1).

## 1. Veredito

**REPROVADO.** 10 defeitos altos, 17 médios e 13 baixos. Nenhum é crítico.

Os altos são todos da mesma classe: o **CA depende de um item a jusante que, por sua vez, está bloqueado pelo item do CA** (ciclo entre o CA e o `blocked_by`). Esse CA não pode ser comprovado quando a issue for fechada. A correção é mecânica: reescrever o CA no nível da função ou da fábrica de testes, ou movê-lo para o item a jusante. Nenhum ajuste exige mudar o desenho.

O que está aprovado:
- a R1 cobre os 11 CAs do PLAN e bate com o JSON;
- os testes obrigatórios do CA 11 têm dono (seção 3, O-1);
- existe caminho para o gate de 90% (E0.1 → E0.3 → gate por item → E9.4), com as lacunas DEF-M1 e DEF-M2;
- a grande maioria dos CAs está em Dado/Quando/Então, com resultado concreto (SQLSTATE, linha no banco, texto, código de saída).

## 2. Defeitos

Classes de falha: **ciclo-CA** (CA depende de item que depende dele), **dep-faltante** (CA ou escopo depende de item que não está no `blocked_by`, sem ciclo), **observabilidade** (resultado vago), **cobertura-gate**, **rastreabilidade**, **lacuna-CA** (escopo ou RN sem CA).

### Altos

| ID | Chave | Classe | Problema | Correção concreta |
|---|---|---|---|---|
| DEF-A1 | E2.2 | ciclo-CA | CA-1 "pode ser vinculado a serviços": o vínculo é de E2.1, que é bloqueada por E2.2. | CA-1: "…então ele aparece ativo na lista e `profissional.ativo = true` no banco". Mover "pode ser vinculado" para E2.1 (já coberto pelo escopo de E2.1). |
| DEF-A2 | E2.2 | ciclo-CA | CA-4 "some da página pública e o histórico continua exibindo seu nome": a página pública (E4.1) e a agenda (E3.3) dependem de E2.2. | CA-4: "…permanece no banco com `ativo = false`, a consulta de profissionais elegíveis/ativos do salão não o retorna e as reservas da fábrica continuam com `profissional_id` dele". Exibição do nome → novo CA em E3.3. Sumir da página pública → coberto por E3.1 RN-1 e E4.1 CA-2. |
| DEF-A3 | E2.1 | ciclo-CA | CA-3 "some da página pública": E4.1 (e E3.1) dependem de E2.1. | CA-3: "…continua no banco com `ativo = false`, a função de leitura de serviços públicos do salão não o retorna e os itens de reserva existentes ficam inalterados". Declarar essa função de leitura como entregável de E2.1, ou mover a verificação pública para E4.1. |
| DEF-A4 | E4.3 | ciclo-CA | CA-1 "formulário… enviado diretamente ao servidor" e CA-2 "reserva pública concluída": o formulário e o fluxo público são de E4.1, que é bloqueada por E4.3. | E4.3: CA-1 → "Dado `registrarConsentimento`/validador do payload público sem aceite, então devolve erro de validação e nenhuma linha em `consentimento`"; CA-2 → "Dado `registrarConsentimento(origem='publico')`, então a linha tem data UTC e versão = `src/config/termos.ts`". Novos CAs em E4.1: "envio sem aceite → recusado, nenhuma reserva" e "reserva pública grava consentimento com a versão exibida". |
| DEF-A5 | E5.1 | ciclo-CA | CA-3 "nova reserva usa o mesmo número": a reserva é de E3.2, que é bloqueada por E5.1. | CA-3: "Dado a cliente 'Maria'…, quando `upsertCliente(salaoA, '+5511987654321', 'Maria S.')` é chamado, então existe uma única cliente, agora 'Maria S.'". |
| DEF-A6 | E7.1 | ciclo-CA | CA-1 "reserva pública criada", CA-5 e CA-7 "remarcações" e CA-8 "quando a reserva é criada": a criação (E3.2) e a remarcação (E3.5) dependem de E7.1. | Reescrever com a fábrica e a função de outbox do próprio item: CA-1 "Dado reserva da fábrica e registro gravado por `registrarMensagem` numa transação…"; CA-5/CA-7 "Dado `registrarMensagem(remarcacao, revisao=1)` e depois `(revisao=2)`…"; CA-8 "Dado um registro `pendente` sem job (`boss.send` falhou), quando a reconciliação roda, então o job é criado e a mensagem fica `enviada`". O caso "fila indisponível no commit da reserva" fica só em E3.2 CA-4. |
| DEF-A7 | E8.1 | ciclo-CA | CA-4 "TOTP inválido no login do super admin": o login TOTP é de E1.5, que é bloqueada por E8.1. Além disso, duplica E1.5 CA-3. | Remover o CA-4 de E8.1, que fica coberto por E1.5 CA-3. Substituir por: "Dado `registrarFalhaAuditoria` chamada dentro de uma transação principal que sofre rollback, então o registro de falha persiste". |
| DEF-A8 | E2.1 | dep-faltante | CA-2 "as reservas existentes continuam **exibindo** R$ 80,00": a exibição é de E3.3, que não está no fecho de E2.1. | CA-2: "…então os itens de reserva existentes (criados pela fábrica) mantêm `preco_centavos = 8000` no banco". |
| DEF-A9 | E4.1 | ciclo-CA | CA-5 (fluxo só por teclado) e CA-1 (viewport 375 px): a Validação remete ao "Playwright em E4.4", que é bloqueado por E4.1, e nenhum CA de E4.4 cobre teclado. | Ou E4.1 entrega o próprio `e2e/reserva-teclado.spec.ts` (CA-1 e CA-5), ou esses CAs migram para E4.4 como CAs explícitos (ver DEF-M9). |
| DEF-A10 | E3.1 | ciclo-CA | A Validação exige `EXPLAIN (ANALYZE)` "com volume do seed", mas o seed (E9.2) depende de E3.2 → E3.1. | "…com volume gerado por fábrica no teste (ex.: 2 salões × 10 profissionais × 5.000 reservas)". |

### Médios

| ID | Chave | Classe | Problema | Correção concreta |
|---|---|---|---|---|
| DEF-M1 | E0.1 | cobertura-gate | CA-3 "deixa **um módulo** de `src/` abaixo de 90%": o limiar é **global** (`thresholds.lines`). Com um módulo descoberto, a média global pode continuar ≥ 90% e o CA falha por motivo errado. | "…uma alteração descartável que reduz a cobertura **global** de linhas para menos de 90% (ex.: arquivo novo em `src/` sem teste)…". |
| DEF-M2 | E0.1 | cobertura-gate | O JSON entrega `@testing-library/react` + `jsdom` para `*.test.tsx` e `passWithNoTests` no projeto `integration`, mas o spec de E0.1 só cita os projetos `unit` e `integration` e nenhum CA cobre isso. Sem teste de componente, o código de UI em `src/**` derruba a cobertura (E0.8, E3.3, E7.3, E8.3 e E9.1 dependem disso). | No escopo de E0.1, acrescentar o ambiente de teste de componente. Novo CA: "Dado um `*.test.tsx` que renderiza `src/app/page.tsx`, quando `npm run test:coverage` roda, então o teste passa e o arquivo aparece coberto no relatório único". |
| DEF-M3 | E3.2 | lacuna-CA | CA-2 usa **o mesmo telefone** nas 10 requisições. Pela RN-7, o upsert trava a linha da cliente primeiro, então as transações se serializam antes do INSERT da reserva e a exclusion constraint não é exercida sob corrida real. "As 9 recusas vêm de `23P01`" também não diz como o teste observa o SQLSTATE. | Manter o CA-2 e acrescentar o CA-2b: "10 requisições simultâneas com **10 telefones distintos**, mesmo profissional e horário → exatamente 1 reserva, 9 erros `HorarioIndisponivel` com causa `23P01`, 0 clientes órfãs de reserva parcial". Definir que a causa é exposta no erro tipado. |
| DEF-M4 | E3.2 | dep-faltante | A RN-7 grava o **consentimento** na transação, mas o registro de consentimento (`src/server/consentimento/registrar.ts`) é entregue por E4.3, que não está no `blocked_by` de E3.2. | Acrescentar `E4.3` a `blocked_by` de E3.2. Não cria ciclo, e E4.3 é P0. |
| DEF-M5 | E1.4 | dep-faltante | CA-2 "vê apenas a própria agenda": a agenda é de E3.3, que não está no fecho de E1.4. | CA-2: "…consegue entrar, a sessão tem papel `profissional` com `profissional_id` = convidado, e uma ação de gestor devolve `AcessoNegado`". Alternativa: `blocked_by += E3.3`. |
| DEF-M6 | E1.2 | ciclo-CA | CA-3 usa como exemplo "criar serviço" (E2.1 → E2.2 → E1.2). | "…chama diretamente uma ação registrada com `papeis: ['gestor']` (ação de teste do registro de E0.5)…". |
| DEF-M7 | E5.2 | dep-faltante | CA-4 "nova reserva com o número antigo" depende de E3.2, que está fora do fecho de E5.2. | "…quando `upsertCliente` é chamado com o número antigo, então é criada uma nova cliente, sem ligação com a anonimizada". |
| DEF-M8 | E5.2 / E4.2 | dep-faltante | CA-5 verifica `rate_limit_janela`, mas a chave HMAC do número é de E4.2, que está fora do fecho de E5.2. Antes de E4.2 a tabela está vazia e o teste passa sem verificar nada. | Retirar `rate_limit_janela` do CA-5 de E5.2. Novo CA em E4.2: "após N tentativas de um número, nenhuma linha de `rate_limit_janela` contém o E.164 em claro (chave = HMAC-SHA256)". |
| DEF-M9 | E4.4 | lacuna-CA | O escopo cita "filtragem de profissionais" e "horário indisponível", mas não há CA para eles. O CA 2 do PLAN ("só aparecem profissionais que executam todos", **pelo celular**) só é comprovado de ponta a ponta aqui. | Novos CAs: "Dado serviços com vínculos parciais do seed, quando escolhe A+B, então só os profissionais que fazem ambos aparecem"; "Dado o horário tomado por fixture entre a escolha e o envio, então vê 'horário indisponível' e volta à etapa de horário com os dados preservados"; "o fluxo é concluído só com teclado" (de DEF-A9). |
| DEF-M10 | E3.3 / R1 | lacuna-CA | A RN-3 ("cliente removida") não tem CA, e é ela que prova a parte "o histórico da agenda continua íntegro" do CA 7 do PLAN. E5.2 a declara fora do escopo. | Novo CA em E3.3: "Dado uma reserva de cliente anonimizada (fábrica), quando a agenda e o detalhe são abertos, então mostram 'cliente removida', os itens e os preços snapshot". Acrescentar `E3.3` à linha 7 da R1. |
| DEF-M11 | E8.3 | dep-faltante | CA-4 pressupõe ações de **suspensão** registradas, que são de E8.2, fora do fecho de E8.3. | `blocked_by += E8.2` (sem ciclo) ou "Dado registros de auditoria de suspensão e de reenvio inseridos por `registrarAuditoria`…". |
| DEF-M12 | E9.4 | dep-faltante | E9.1 (página inicial, item de "Interface" do PLAN) não está no fecho de E9.4, que valida "a v1 completa". | `blocked_by += E9.1` em E9.4. |
| DEF-M13 | global (convenções do spec) | observabilidade | "Recusado"/"recusa" aparece em cerca de 25 CAs (E1.1 CA-3, E2.1 CA-4/5, E2.3 CA-2/4, E2.5 CA-2/3/4, E3.2 CA-3, E3.4 CA-1/3, E3.5 CA-2/4, E4.2 CA-1, E5.1 CA-2, E6.4 CA-2, E8.2 CA-4, E8.3 CA-3…) sem forma definida. A G-1 só define 403 e 404. | Nova convenção G-3: "'recusado' = a ação devolve erro tipado (`ErroValidacao{campo}` / `ErroNegocio{codigo}`) com mensagem pt-BR, e nenhuma linha é criada ou alterada no banco (verificado no teste)". |
| DEF-M14 | global (Gate padrão) | cobertura-gate | 22 sub-issues não pedem testes unitários na Validação (E0.4, E0.5, E0.7, E1.4, E2.2, E2.4, E3.3, E4.1, E4.3, E5.2, E6.1, E6.2, E6.4, E6.5, E6.6, E7.1, E7.2, E7.3, E8.1, E8.2, E8.3, E9.1, E9.2), e a definição de "Gate padrão" não diz "testes passando". Para persistência, integração real basta, porque mocks de banco são proibidos. Mas há lógica pura sem unitário exigido (ver DEF-B1). | Redefinir o "Gate padrão" no topo do spec: "…testes unitários de toda lógica pura nova e integração com PostgreSQL real de toda persistência, todos passando; build, lint, typecheck; cobertura ≥ 90%; APROVADO do tester". |
| DEF-M15 | global (isolamento) | lacuna-CA | E0.5 prova o isolamento só nos 4 agregados (serviço, profissional, cliente, agendamento). Jornada, bloqueio, mensagens, assinatura e configurações não têm CA A×B (E2.3, E2.4, E2.5, E6.5, E7.3). O §9 do design pede isso "em cada item com dados de tenant", mas o spec não. | Convenção G-4: "todo item que cria leitura ou mutação de entidade de tenant inclui teste de integração A×B (gestor de A recebe `NaoEncontrado` para ID de B, e o registro de B fica inalterado)", citada na Validação desses itens. |
| DEF-M16 | E4.1 | ciclo-CA | CA-3 "Dado dados válidos **e captcha válido**": o widget e a validação Turnstile são de E4.2, que é bloqueada por E4.1. A condição fica vazia em E4.1. | Remover "e captcha válido" do CA-3 de E4.1. O captcha já é comprovado por E4.2 CA-5 e E4.4 CA-4. |
| DEF-M17 | E6.1 | ciclo-CA | CA-3 "quando o retorno **ou o webhook**": o webhook é de E6.2, que é bloqueada por E6.1. | "…quando a página de retorno é processada…". O webhook fica em E6.2. |

### Baixos

| ID | Chave | Problema | Correção concreta |
|---|---|---|---|
| DEF-B1 | E2.4, E6.2, E6.4, E8.3, E4.1 | Há lógica pura sem unitário exigido: conversão de dia inteiro local → UTC (com DST) em E2.4; extração da chave de dedupe em E6.2; matriz de capacidades × estado em E6.4; máscara de telefone em E8.3; estado do assistente (preservar dados ao voltar) em E4.1. | Acrescentar "unitários de …" na Validação de cada um. Em E6.4, teste orientado por tabela com as 3 linhas × 6 capacidades. |
| DEF-B2 | E2.5 | O título ainda diz "com redirecionamento", mas o redirecionamento passou para E4.1. | Novo título: **"Configurar fuso, regras de horário e troca de slug com histórico"**. Na R1 (linha após a tabela), manter "E2.5 (histórico) e E4.1 (redirecionamento permanente 301/308)". |
| DEF-B3 | E0.2 | CA-5 "a resposta não é 200" está vago. | "…responde 503". |
| DEF-B4 | E2.4 | CA-4 "o sistema avisa" está vago. | "…a resposta da ação contém a lista com o ID da reserva afetada e a reserva continua `confirmado`". |
| DEF-B5 | E1.2 | CA-1 "é levado ao painel do gestor"; CA-5 depende de desativação (E2.2, a jusante). | CA-1: "…redirecionado para `/painel`". CA-5: "Dado um profissional com `ativo = false` (fábrica)…". |
| DEF-B6 | E3.3, E9.1 | CA de teclado e de "sem rolagem horizontal" com Validação "E2E/teste de componente" ou "e/ou Playwright". O jsdom não mede layout. | Exigir Playwright para esses CAs: E3.3 CA-4, E9.1 CA-2 e CA-3. O JSON já prevê `e2e/landing.spec.ts`. |
| DEF-B7 | E6.1 | CA-4 "procura qualquer coluna com número de cartão" está vago. | "…nenhuma coluna de `information_schema.columns` com nome `%cart%`/`%card%`/`%cvv%`/`%pan%`, e nenhum `corpo` de webhook gravado contém sequência de 13–19 dígitos". |
| DEF-B8 | E6.3 | CA-5 "sem nenhuma cobrança registrada". | "…o MP simulado não registra cobrança e não há linha em `assinatura_pagamento`". |
| DEF-B9 | E8.1 | CA-3 "quando se procura uma rota ou ação…" é inspeção manual. | "Dado o registro de ações (E0.5), quando o teste o percorre, então nenhuma ação altera ou apaga `auditoria`". O trigger já é provado por E0.4 CA-12. |
| DEF-B10 | E3.4 | O encaixe **sobre bloqueio** (RN-2) não tem CA; só "fora da jornada". | Novo CA: "Dado bloqueio de Ana 14:00–15:00, quando a equipe cria às 14:00 sem confirmar, então é recusado com 'horário bloqueado'; com confirmação, é criado". |
| DEF-B11 | E3.5 | As transições do S2 só têm o CA-4. | Acrescentar: `cancelado` é final; cancelar após o fim é recusado; correção `concluido` ↔ `nao_compareceu` é aceita (unitário da máquina). |
| DEF-B12 | R1 | E2.5 (regras de horário, CA 3), E4.3 (consentimento, CAs 2 e 6) e E0.6/E4.4 (captcha simulado, CA 10) estão fora das linhas pertinentes. | Linha 3: + E2.5. Linhas 2 e 6: + E4.3. Linha 10: + E0.6 e E4.4. Linha 7: + E3.3 (DEF-M10). |
| DEF-B13 | Épicos E1, E3, E4, E5, E6, E7, E8, E9 | O CA-2 dos épicos não segue Dado/Quando/Então (ex.: E1 CA-2 "funcionam com o e-mail simulado"). | "Dado as sub-issues fechadas, quando o tester reexecuta os CAs X do PLAN, então todos têm evidência em `testes.md`". |

## 3. Observações

- **O-1, donos do CA 11 do PLAN (conferido):**
  - isolamento entre salões: E0.5 CA-1/CA-2, mais E2.1 CA-4 e E5.1 CA-4;
  - concorrência da agenda: E0.4 CA-2/CA-7, E3.2 CA-2 (reforçar com DEF-M3) e E4.2 CA-7;
  - permissões: E1.2 CA-3, E1.5 CA-4, E2.3 CA-3, E2.4 CA-2, E3.3 CA-1, E3.4 CA-4, E3.5 CA-6, E5.1 CA-5 e E6.5 CA-4;
  - eventos de assinatura: E6.2 CA-1..6 e E6.3 CA-1..8.

  Todos têm dono. Falta só a generalização do isolamento (DEF-M15).
- **O-2, caminho da cobertura:**
  - E0.1 CA-3/CA-6 cria o limiar e o relatório único (corrigir DEF-M1 e DEF-M2);
  - E0.3 CA-2 faz a CI falhar abaixo de 90%;
  - cada sub-issue carrega o "Gate padrão" (reforçar com DEF-M14);
  - E9.4 CA-2 faz a medição final.

  Um item dedicado de elevação de cobertura **não é necessário**, porque o gate é por PR. Sugestão (não defeito): acrescentar a E9.4 a RN-4 "cobertura < 90% reabre o item responsável; nunca se resolve com exclusão".
- **O-3:** E0.3, E4.4, E9.3 e E9.4 sem "Gate padrão" é aceitável: são CI, E2E (fora da métrica), documentação e validação final. Mesmo assim, o código E2E de E4.4 deve passar no lint e no typecheck. Sugestão: "lint e typecheck incluem `e2e/**`".
- **O-4:** P1 e P2 continuam como pendências do usuário. Os CAs afetados (E0.4 RN-8, E3.5 CA-1, E7.1 CA-5/CA-7, E6.6 CA-5, E8.2 CA-3) estão escritos para a opção (a). Se o usuário escolher outra opção, esses CAs mudam.
- **O-5:** a ordem das RNs em E9.2 (RN-1, RN-4, RN-2, RN-3) e a posição da RN-4 de E8.2 (depois da "Pendência") são cosméticas e não afetam a testabilidade.
- **O-6, reteste:** na Rodada 2, reexecutar o mesmo script de cruzamento (chaves, R1 e fecho de `blocked_by` × referências dos CAs) e reler só os itens corrigidos.

---

# Rodada 2

Objeto: reteste dos 40 defeitos da Rodada 1 contra o `spec.md` (1720 linhas) e o JSON do `design.md` (bloco ```json backlog a partir da linha 276), corrigidos pelo analista e pelo arquiteto (`design.md` §15).

## R2.1 Verificações automatizadas (mesmo script da Rodada 1)

| Verificação | Resultado |
|---|---|
| Chaves do spec = chaves do JSON, mesma ordem | sim, 55 = 55 |
| Ciclos no grafo `blocked_by` | nenhum |
| Dependências novas presentes | E3.2 ← E4.3, E9.4 ← E9.1, E8.3 ← E8.2, E1.4 ← E3.3: todas presentes |
| P0 bloqueado por P1/P2 | nenhum |
| Chaves citadas na R1 existem no JSON | sim, nas 11 linhas |
| Referências `Ex.y` em CAs/Validação a itens fora do fecho de `blocked_by` | 8 ocorrências, todas **remissões explícitas de verificação** ("verificado em …"), sem condição do CA que dependa do item a jusante: E0.4→E0.5 (harness), E2.4 CA-3→E3.1, E3.5→E6.4, E4.1→E4.4 CA-7, E6.6/E7.2→E9.3, E7.1 CA-8→E3.2 CA-4, E8.1 CA-4→E1.5 CA-3. Aceitas. |

## R2.2 Reteste por defeito

| ID | Estado | Evidência (spec Rodada 2) |
|---|---|---|
| DEF-A1 | verificado | E2.2 CA-1 em `profissional.ativo = true`; o vínculo passou para E2.1 CA-6 |
| DEF-A2 | verificado | E2.2 CA-4 no nível do banco e da consulta; a exibição do nome passou para E3.3 CA-6 |
| DEF-A3 | verificado | E2.1 entrega a função de leitura de serviços públicos (escopo); CA-3 a usa |
| DEF-A4 | verificado | E4.3 CA-1/CA-2 no nível do validador e de `registrarConsentimento`; E4.1 ganhou CA-5 (sem aceite) e CA-7 (consentimento da reserva pública) |
| DEF-A5 | verificado | E5.1 CA-3 usa `upsertCliente(...)` |
| DEF-A6 | verificado | E7.1 CA-1/5/7/8 reescritos com fábrica e `registrarMensagem`; a fila indisponível ficou em E3.2 CA-4 |
| DEF-A7 | verificado | E8.1 CA-4 = falha auditada persiste após rollback; o TOTP ficou em E1.5 CA-3 |
| DEF-A8 | verificado | E2.1 CA-2: `preco_centavos = 8000` no banco |
| DEF-A9 | verificado | O teclado e os 375×812 foram para E4.4 CA-7; E4.1 remete a ele na Validação |
| DEF-A10 | verificado | E3.1: `EXPLAIN` com volume de fábrica (2 × 10 × 5.000) |
| DEF-M1 | verificado | E0.1 CA-3: cobertura **global** < 90% |
| DEF-M2 | verificado | E0.1: escopo com Testing Library + jsdom e `passWithNoTests`; CA-7 novo |
| DEF-M3 | verificado | E3.2 CA-2b com 10 telefones distintos; RN-3 expõe a causa `23P01` em `HorarioIndisponivel` |
| DEF-M4 | verificado | JSON E3.2 `blocked_by` contém E4.3 |
| DEF-M5 | verificado | JSON E1.4 `blocked_by` contém E3.3 (alternativa aceita; CA-2 mantido) |
| DEF-M6 | verificado | E1.2 CA-3 usa ação de teste com `papeis: ['gestor']` |
| DEF-M7 | verificado | E5.2 CA-4 usa `upsertCliente` |
| DEF-M8 | verificado | `rate_limit_janela` saiu de E5.2 CA-5; E4.2 ganhou CA-9 (HMAC, sem E.164 em claro) |
| DEF-M9 | verificado | E4.4 CA-5 (filtragem), CA-6 (horário indisponível) e CA-7 (teclado, 375×812) |
| DEF-M10 | verificado | E3.3 CA-5 ("cliente removida"); R1 linha 7 inclui E3.3 |
| DEF-M11 | verificado | JSON E8.3 `blocked_by` contém E8.2 |
| DEF-M12 | verificado | JSON E9.4 `blocked_by` contém E9.1 |
| DEF-M13 | verificado | Convenção G-3 ("recusado" = erro tipado + banco inalterado) |
| DEF-M14 | verificado | "Gate padrão" redefinido: unitários de lógica pura, integração de persistência, todos passando |
| DEF-M15 | verificado | Convenção G-4 citada na Validação de E2.1, E2.2, E2.3, E2.4, E2.5, E3.3, E6.5 e E7.3 |
| DEF-M16 | verificado | E4.1 CA-3 sem "captcha válido" |
| DEF-M17 | verificado | E6.1 CA-3 só com a página de retorno |
| DEF-B1 | verificado | Unitários exigidos em E2.4 (DST), E6.2 (chave de dedupe), E6.4 (tabela 3 × 6), E8.3 (máscara) e E4.1 (estado do assistente) |
| DEF-B2 | verificado | E2.5: "Configurar fuso, regras de horário e troca de slug com histórico"; a R1 cita 301/308 em E4.1 |
| DEF-B3 | verificado | E0.2 CA-5: 503 |
| DEF-B4 | verificado | E2.4 CA-4: lista com o ID da reserva afetada |
| DEF-B5 | verificado | E1.2 CA-1 `/painel`; CA-5 com `ativo = false` (fábrica) |
| DEF-B6 | verificado | Playwright exigido para E3.3 CA-4 e E9.1 CA-2/CA-3 |
| DEF-B7 | verificado | E6.1 CA-4 com `information_schema` e varredura de 13–19 dígitos |
| DEF-B8 | verificado | E6.3 CA-5: sem cobrança no simulado e sem linha em `assinatura_pagamento` |
| DEF-B9 | verificado | E8.1 CA-3 percorre o registro de ações |
| DEF-B10 | verificado | E3.4 CA-6 (encaixe sobre bloqueio) |
| DEF-B11 | verificado | E3.5 CA-7 (transições do S2) |
| DEF-B12 | verificado | R1: linha 2 +E4.3, linha 3 +E2.5, linha 6 +E4.3, linha 7 +E3.3, linha 10 +E0.6/E4.4 |
| DEF-B13 | verificado | O CA-2 dos épicos E1–E9 está em Dado/Quando/Então com evidência em `testes.md` |

Sugestões O-2 e O-3 incorporadas: E9.4 RN-4 (cobertura < 90% reabre o item) e lint/typecheck sobre `e2e/**`.

## R2.3 Itens alterados fora dos defeitos (revisados)

E6.3 RN-6 detalhada conforme `design.md` §15, com os novos CA-9 a CA-12. Conferi a aritmética:
- CA-1: fim do teste 10/03, pagamento 10/03 → 10/04;
- CA-9: pagamento antecipado 01/03 → 10/04, base `max(fim_teste, data)`;
- CA-10: 31/01/2027 → 28/02/2027 (2027 não é bissexto);
- CA-11: regularização 20/05 → 20/06, ignorando o `pago_ate` antigo de 05/05;
- CA-12: `pagamento_id` aplicado uma vez, e a falha ao gravá-lo não altera `pago_ate`.

Todos são observáveis (data no banco) e coerentes com a RN.

## R2.4 Observações (não bloqueiam)

- **O-7:** E9.4 (P1) agora depende de E9.1 (P2). O arquiteto aceitou isso (§15). Sugestão: elevar E9.1 para P1, para a prioridade refletir o bloqueio.
- **O-8:** E4.3 CA-1 diz "validador **ou** `registrarConsentimento`". Recomenda-se testar os dois caminhos. Não muda o veredito.
- **O-9:** P1 e P2 continuam pendentes do usuário, sem mudança desde a O-4.

## R2.5 Veredito

**APROVADO** (backlog, D-001 T-4).
- Os 40 defeitos da Rodada 1 estão verificados.
- Não há defeito crítico, alto, médio ou baixo em aberto.
- Não há ciclo no grafo.
- A R1 cobre os 11 CAs do PLAN e bate com o JSON.
- Os donos dos testes do CA 11 do PLAN estão definidos.
- O caminho para o gate de cobertura ≥ 90% está explícito (E0.1 CA-3/CA-6/CA-7 → E0.3 CA-2 → Gate padrão por item → E9.4 CA-2 e RN-4).
- Nenhuma classe de falha recorrente.
