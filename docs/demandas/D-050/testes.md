# D-050 (E3.6, issue #111) — Relatório do tester

## Rodada 1 (23/11/2026)

### Ambiente
- Branch `feat/d-050-servicos-independentes`, HEAD `08859c1` + alterações não commitadas da demanda (nada commitado).
- Node v24.21.0; PostgreSQL 17 do `docker compose` (`postgres`); adaptadores simulados.
- Gates rodados no repositório (lint, typecheck) e numa cópia própria
  `/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/0981b645-ff19-4016-836e-cec5d272d26c/scratchpad/tester/copia`
  (rsync do repositório, `node_modules` por hard link, `.env` = `.env.example`) para cobertura, build e E2E, sem tocar
  no `.next`/`coverage` do repositório. E2E sem `.env`, `LANG=en_US.UTF-8`, `E2E_PORT=3987`,
  `E2E_DATABASE_URL=…/agenda_beleza_tester`; uma única execução de Playwright por vez (combinado com a T-17).
- Viewport do E2E: 375×812, `isMobile`/`hasTouch` (projeto `mobile-chromium`).
- Alterações locais do usuário (`README.md` anteriores à demanda, `docs/GUIA_TESTES_LOCAIS.md`) não avaliadas.

### Gates
| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` (repo) | 0 erros |
| Lint | `npm run lint` (repo) | 0 erros, 0 avisos |
| Cobertura + Vitest | `npm run test:coverage` (cópia) | 601 arquivos, 7285 testes, 0 falhas; **linhas 99,04%** (10958/11064), instruções 98,41%, ramos 96,29%, funções 99,32%; 5 min 16 s |
| Build + E2E | `npm run test:e2e` (cópia: `next build` + `build:node` + preparar banco + Playwright) | build ok; **373 testes dos specs existentes passaram**, 0 falha (2,1 min) |
| E2E do tester | `npx playwright test e2e/tester-d050.spec.ts` | 1/1 (ver "Testes do tester") |
| Estabilidade ×10 | laço do design §8 (`reservas/{concorrencia,idempotencia,travas}` + `alteracao/concorrencia-itens` + `alteracao/tester-d050`) | 10/10 rodadas, 42/42 testes por rodada, sem 23505, 40P01 nem erro |
| Fuso | `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/domain/disponibilidade src/server/reservas src/server/mensagens src/server/reserva-publica tests/integration/reservas/alteracao/fuso-itens.test.ts tests/integration/reservas/fuso.test.ts` | 33 arquivos, 393/393 nos dois fusos |
| Migração | `tests/integration/db/migracao-itens.test.ts` (na suíte de cobertura) | verde; revisado (abaixo) |

Exclusões de cobertura: `vitest.config.ts`, `playwright.config.ts`, `.github`, `.env.example`, `package.json` e
`eslint.config.mjs` sem alteração na demanda (`git diff --stat`): nenhuma exclusão nova. Sem `test.skip`/`only`.

Estático (web-design §9, critérios 1, 2, 6, 7, 8): nos CSS tocados não há cor literal nem `outline: none`, e toda
media query é `(min-width: 48rem)`; "com o mesmo profissional", "Sem preferência" e "Alterar profissional" não
existem em `src/` (fora de testes).

### Testes do tester (independentes do desenvolvedor)
- `tests/integration/reservas/alteracao/tester-d050.test.ts` (5 testes, sessão real, PostgreSQL real):
  1. Remarcar item de profissional desativada (gestor): sonda do DEF-1 (abaixo).
  2. Enviar explicitamente a profissional inativa → erro de campo "Este profissional está inativo ou não realiza este
     serviço.", nada gravado, revisão 0.
  3. CA-33: HTML do detalhe para a profissional em 8 vistas (`?remarcar=`/`?cancelar=` próprios e alheios,
     `?cancelar=todos`, `?resultado=` com o item alheio) nunca contém horário, id, nome do profissional nem (fora do
     catálogo do select de serviço) nome/preço do item da outra profissional; a seção de mensagens não traz o
     cancelamento do item alheio.
  4. CA-33: agenda dia e semana da profissional sem serviço, horário e id do item alheio.
  5. Caso limite 2 da spec: "Cancelar todos" × cancelar um item em paralelo, 10 vezes: os dois desfechos ocorreram
     (`atualizada/atualizada` e `atualizada/recusado`); cada item cancelado é citado por exatamente uma mensagem de
     cancelamento, revisões distintas, derivados coerentes.
- `e2e/tester-d050.spec.ts`: o cenário do usuário em `/e2e-reservas-1` (nenhum outro spec usa este salão), **só
  teclado e sem JavaScript ao mesmo tempo**, em 375×812: Escova com Bia 09:00 e Hidratação com Cris **09:30
  (adjacente)** de manhã e Manicure com Duda 14:00. Confere: Escova oferece Ana e Bia, Hidratação não oferece Bia;
  08:30–09:15 não aparecem para Ana nem Cris (RN-10), 09:30 aparece (semiaberto); Manicure sem 09:00–10:00; sem
  rolagem horizontal em cada tela; confirmação com 3 paradas em ordem e total R$ 180,00; telefone fora da URL; no
  banco, 1 reserva com 3 itens `confirmado` e exatamente 1 `confirmacao` pendente sem item. (Sem JS o axe não
  injeta; o axe das mesmas telas é coberto pelos specs com JS.)
- **WhatsApp ponta a ponta (CA-37/CA-51)**: depois do E2E, o worker real (`node dist/worker/main.js`, simulado) rodou
  200 s contra a base do E2E. A reconciliação reenfileirou a confirmação e o adaptador simulado registrou, para a
  reserva acima, uma única chamada: modelo `confirmacao`, parâmetros
  `{"salao": "Salão E2E 1", "data": "26/11/2026", "itens": "09:00 Escova com Bia; 09:30 Hidratação com Cris; 14:00 Manicure com Duda"}`,
  chave `<reservaId>:confirmacao:0`, resultado `sucesso`; mensagem `enviada` com 1 tentativa; sem quebra de linha.

### Capturas (servidor `next start` da cópia, vitrines e página pública real)
Pasta `/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/0981b645-ff19-4016-836e-cec5d272d26c/scratchpad/tester/capturas/`
(`<tela>-375.png` e `<tela>-1280.png`): `dev-reserva`, `dev-reserva-reescolha`, `dev-reserva-confirmada`,
`dev-reserva-nova`, `dev-reserva-nova-encaixe`, `dev-agenda`, `dev-acoes`, `dev-acoes-remarcar-inativa`,
`dev-acoes-cancelar-todos`, `dev-acoes-profissional`, `publico-salao-1`, `remarcar-inativa-select`.
`scrollWidth` = largura da janela em todas (375 e 1280).

### Critérios de aceitação
| CA | Situação | Evidência |
|---|---|---|
| CA-1, CA-2, CA-4 | passou | `disponibilidade/por-servico.test.ts`, `domain/disponibilidade/escolhidos.test.ts`; E2E do tester (profissionais por serviço; descontos RN-10) |
| CA-3 | passou | `disponibilidade/{consultas,plano}.test.ts` na suíte |
| CA-5, CA-7 | passou | `reservas/itens.test.ts`, `reservas/validacao.test.ts` |
| CA-6 | passou | `reserva-publica/fluxo-itens.test.ts`; `publico-reserva.spec.ts`; E2E do tester |
| CA-8, CA-9 | passou | `reserva-publica/passos.test.ts`; `publico-reserva.spec.ts` "CA-9" |
| CA-10 | passou | `fluxo-itens.test.ts`; `publico-conflito-captcha.spec.ts` com e sem JS |
| CA-11, CA-17, CA-18, CA-22 | passou | `reservas/{idempotencia,concorrencia,travas}.test.ts`, laço ×10 do tester |
| CA-12, CA-13 | passou | `publico-reserva-teclado.spec.ts`, `publico-reserva.spec.ts` sem JS; E2E do tester (teclado + sem JS juntos) |
| CA-14, CA-31 | passou | `publico-suspenso.spec.ts`; `politica/reservas.test.ts`; `permissoes-itens.test.ts` "CA-31" |
| CA-15, CA-16 | passou | `protecao/futuras.test.ts`; `publico-conflito-captcha.spec.ts` (captcha) |
| CA-19, CA-20 | passou | `db/reserva-item-exclusion.test.ts` |
| CA-21 | passou | `alteracao/concorrencia-itens.test.ts` (laço ×10) |
| CA-23, CA-24 | passou | `reservas/equipe/itens.test.ts`; `reserva-nova.spec.ts` com banco |
| CA-25..CA-30 | passou | `alteracao/{remarcar,cancelar,permissoes,convite}-itens.test.ts`; `status.test.ts` |
| CA-32..CA-35 | passou | `agenda/d050-ui-paginas.test.ts`, `agenda/*`; `agenda.spec.ts`, `mensagens-situacao.spec.ts`; tester (CA-33) |
| CA-36 | passou | `reserva-nova*.spec.ts`, `reserva-acoes*.spec.ts` |
| CA-37 | passou | `mensagens/itens.test.ts` (worker real); verificação ponta a ponta do tester acima |
| CA-38..CA-42 | passou | `mensagens/{itens,vigencia,substituicao}.test.ts`; `permissoes-itens.test.ts` "CA-42" |
| CA-43 | passou | `integrations/whatsapp/real.test.ts`, `integracoes/whatsapp-real.test.ts`; `docs/whatsapp-templates.md` |
| CA-44, CA-45 | passou | `alteracao/convite-itens.test.ts`; `avaliacoes/status-derivado.test.ts` |
| CA-46..CA-49 | passou | `db/migracao-itens.test.ts` revisado: base dedicada com as 14 migrações anteriores por `migrate deploy` real, dados antigos de 1 e 3 itens, todos os status, encaixe, remarcada, cancelada e ordens com lacuna; guarda com as 4 contagens e catálogo/dados intactos + P3009 + `resolve --rolled-back`; união das ocupações idêntica; contagens iguais; reversão extraída do cabeçalho devolve catálogo e dados iguais e a migração reaplica; reversão aborta sem alterar quando há reserva não representável. Única mudança de vigência: confirmação `falhou` de reserva remarcada (R-4, aceito no design) |
| CA-50 | passou | `equipe/itens.test.ts`, `permissoes-itens.test.ts`, testes de isolamento de cada módulo |
| CA-51 | passou | `seed/fixtures-e2e.test.ts`; `publico-reserva.spec.ts`; tester (WhatsApp ponta a ponta) |
| CA-52 | passou | gates acima |

Critérios visuais do web-design §9: 1–25 cobertos pelos specs da T-15 (axe 4.14.0 com JS, `scrollWidth`, alvos
≥ 44 px, foco visível) e conferidos pelo tester nos critérios 1, 2, 3, 6, 7, 8, 10, 13, 15 e 16 (estático, E2E do
tester e capturas).

### Defeitos

```
DEF-1 — Remarcar item de profissional desativada pré-seleciona outra profissional sem avisar   Severidade: média   Estado: verificado (Rodada 2)
CA relacionado: CA-25 (RN-22); desvio da T-13
Ambiente: cópia do tester, branch feat/d-050-servicos-independentes, Node 24.21.0, PostgreSQL 17, simulado; 375 e 1280 px
Passos para reproduzir:
  1. Reserva com item C da Bia (2027-03-09 10:30) e item A da Ana; desativar a Bia (corrida aceita, ou item
     passado não marcado: a desativação comum é recusada com item confirmado futuro).
  2. Gestor abre /painel/agenda/reservas/<id>?remarcar=<item da Bia>.
  3. Troca só a hora para 11:00 e clica "Remarcar serviço".
Resultado esperado: o gestor percebe que a profissional vai mudar (campo sem seleção ou aviso "Bia está inativa;
  escolha outra profissional") e escolhe conscientemente.
Resultado observado: o <select name="profissionalId"> não tem a Bia nem nenhuma opção `selected`; o navegador
  mostra a 1ª ativa ("Ana"). Sem aviso no formulário (só a parada acima diz "com Bia (inativo)"). O envio move o
  item para a Ana, sobe a revisão e registra a `remarcacao` para a cliente com a Ana; o resultado do PRG diz
  "… foi remarcado para 11:00 com Ana." Prova: tester-d050.test.ts, 1º teste; captura
  dev-acoes-remarcar-inativa-375.png (select "Ana Demonstração" sob a parada "com Carla Antiga (inativo)").
Classe de falha: UX/validação de formulário (troca implícita de profissional)
Sugestão: `textoVazio` ("Escolha a profissional") quando a atual está inativa, com erro de campo se enviado vazio,
  ou ajuda no campo; contorno atual: o gestor confere o select antes de enviar.
```

```
DEF-2 — Formulário de remarcar da profissional oferece opções que o servidor sempre recusa   Severidade: baixa   Estado: aberto
CA relacionado: CA-26 (RN-22), M-5
Passos: profissional Ana abre ?remarcar=<item dela> numa reserva que também tem item da Bia.
Observado: a data aparece como campo `type="date"` (ela não vê o outro item) e o select de serviço lista o serviço
  do item da Bia; trocar a data recusa com `data_diferente`, escolher esse serviço recusa com `servico_repetido`.
  Nada é gravado. Desvio documentado pela T-13 (decidir sem vazar o item alheio). Sem vazamento de horário/preço
  do item alheio (tester-d050.test.ts, CA-33).
Classe de falha: UX
```

```
DEF-3 — Com JavaScript, o foco não vai para #resultado após ação por item   Severidade: baixa   Estado: aberto
CA relacionado: critério 6/CA-36 (pendência da T-15)
Observado: o PRG com `#resultado` é navegação do cliente: a página rola e o texto está em role="status" (anunciado),
  mas o foco fica no topo. Sem JS o comportamento é o padrão do navegador. Não viola critério escrito do web-design.
Classe de falha: acessibilidade (gerência de foco)
```

Observações (não são defeitos):
- Visão da profissional com login real coberta só na integração (`d050-ui-paginas.test.ts`, `equipe/itens.test.ts`,
  `permissoes-itens.test.ts`) e pelos testes do tester com sessão real; no E2E só a vitrine `?vista=profissional`.
  Lacuna de E2E aceitável: as regras são de servidor e estão provadas contra o PostgreSQL real.
- Em 375 px o texto do select de serviço do remarcar é cortado ("Manicure · 45 min · R…"), comportamento nativo do
  `<select>`; cosmético.
- O `axe` não roda com `javaScriptEnabled: false` (trava na injeção): specs sem JS devem usar só
  `semRolagemHorizontal`, como os da T-15 já fazem.

### Veredito: **APROVADO**
Todos os CAs passaram com evidência, todos os gates passaram (lint, typecheck, build, 7285 testes Vitest, 374 E2E),
cobertura de linhas 99,04% ≥ 90%, laços ×10 e dois fusos verdes. Nenhum defeito crítico ou alto aberto; DEF-1
(média), DEF-2 e DEF-3 (baixa) ficam como pendências não bloqueantes, a critério do líder.

Arquivos do tester adicionados ao repositório (não commitados): `tests/integration/reservas/alteracao/tester-d050.test.ts`,
`e2e/tester-d050.spec.ts` (lint e typecheck ok; o spec usa só `/e2e-reservas-1`).

## Rodada 2 (23/11/2026) — reteste do DEF-1

### Correção recebida
`dev.md`, T-13, "Correção DEF-1": com a profissional atual inativa, o select do gestor ganha a opção vazia
"Escolha a profissional" (selecionada) e a ajuda "Atual: {nome} (inativo)."; o servidor (`remarcar.ts`, sob as
travas) responde `invalido` com `erros.profissional` = "Escolha a profissional." quando o campo vem vazio ou ausente
e a atual está inativa, antes de qualquer escrita; o id inativo explícito continua recusado.

### O que foi feito
- A sonda da Rodada 1 em `tests/integration/reservas/alteracao/tester-d050.test.ts` (que afirmava a troca silenciosa
  e passou a falhar com a correção) foi invertida para o comportamento corrigido, e ganhou um caso de controle:
  1. Gestor, item da Bia desativada: a 1ª opção é `""` "Escolha a profissional", a ÚNICA `selected`; a Bia não é
     oferecida; o formulário traz "Atual: Bia (inativo).". Envio com `profissionalId=''` (o que o navegador manda
     sem escolha) e POST forjado SEM o campo: ambos `erros.profissional` = "Escolha a profissional.", item idêntico
     campo a campo, revisão 0, mensagens inalteradas. Escolhendo a Ana explicitamente: PRG `resultado=remarcado`,
     item com a Ana, revisão 1, `remarcacao` do item registrada, derivados coerentes.
  2. Controle: com a profissional atual ATIVA não há opção vazia e a atual é a única selecionada.
  3. (mantido) id inativo explícito → erro de campo "Este profissional está inativo…", nada gravado.
- Vitrine `/dev/reserva-acoes?remarcar=item-manicure#remarcar` (item da "Carla Antiga", inativa) no build da cópia
  do tester (`next build` + `next start`, porta 3987), 375×812 com toque, com e sem JavaScript (script Chromium
  avulso, fora do Playwright Test; nenhuma execução de Playwright Test na rodada):
  - select mostra "Escolha a profissional" (valor `""`), opções Ana e Bia (sem a inativa), ajuda "Atual: Carla Antiga
    (inativo)." ligada por `aria-describedby`; `scrollWidth` 375; botão "Remarcar serviço" com 44 px de altura;
  - enviar só trocando a hora (16:00): resumo de erros "Corrija os campos indicados… Profissional: Escolha a
    profissional.", campo com `aria-invalid="true"` e "Erro: Escolha a profissional." no `aria-describedby`, hora
    digitada preservada, `scrollWidth` 375 — igual com e sem JS.
  - Capturas: `rodada2-remarcar-inativa-375.png`, `rodada2-remarcar-inativa-375-semjs.png`,
    `rodada2-remarcar-inativa-erro-375.png`, `rodada2-remarcar-inativa-erro-375-semjs.png` em
    `/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/0981b645-ff19-4016-836e-cec5d272d26c/scratchpad/tester/capturas/`.

### Comandos (repositório)
| Comando | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/reservas/alteracao tests/integration/agenda tests/integration/politica` (regressão do remarcar, cascas do detalhe, agenda, política) | 22 arquivos, 520/520 |
| `npx vitest run --project unit src/app/painel src/app/dev/reserva-acoes src/server/reservas src/components` | 68 arquivos, 579/579 |
| `npx vitest run --project integration tests/integration/reservas/alteracao/tester-d050.test.ts` | 6/6 |
| `npm run typecheck` | 0 erros |
| `npm run lint` | 0 erros, 0 avisos |
| `next build` (cópia do tester) | ok |

A suíte completa com cobertura e o E2E completo (incluindo `e2e/tester-d050.spec.ts`) ficam para a rodada final da
T-17 (dev-t17), combinada para não haver duas execuções de Playwright ao mesmo tempo; a mudança da correção é local
(formulário de remarcar e uma guarda em `remarcar.ts`), e a regressão acima cobre os módulos tocados.

### Defeitos
- DEF-1: **verificado** (corrigido).
- DEF-2 (baixa) e DEF-3 (baixa): abertos, não bloqueantes (sem mudança).

### Veredito: **APROVADO**
Sem defeito crítico, alto ou médio aberto. Condição: a rodada final da T-17 (cobertura ≥ 90% e E2E completo)
precisa terminar verde; se falhar, a demanda volta ao tester.
