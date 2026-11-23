# D-050 (E3.6) — Registro do desenvolvedor

## T-2 — Núcleo de dados e suporte de teste (23/11/2026)

### Arquivos
- `src/server/repos/tipos.ts`: §3.1. Novos `ItemDeReservaDTO` e `ReservaDTO` (sem `profissionalId`/`ocupadoAte`/`encaixe`, com `canceladaEm` e itens por (inicio, id)); `ReservaItemDTO` removido. `ReservaBloqueanteDTO` e `ReservaCobertaDTO` ganharam `itemId` (uma linha por item). `ReservaHistoricoDTO` por reserva com itens (§3.1). `ContextoDeEnvio` com `itens` (§3.1). Para a T-4: `ConferirVigenciaFn` recebe `r: { status; itens: { revisao; status }[] }` (§3.7/M-4); `NovaMensagem.reservaItemId?` (opcional); `MensagemLinhaDTO.reservaItemId` e `MensagemDaReservaRepoDTO.reservaItemId` (`string | null`).
- `src/server/repos/reserva.ts`: §3.3. `criar` sem profissional/ocupação/encaixe (envelope); `criarItens` num único `INSERT … SELECT FROM unnest(…)` com `'confirmado'` literal, revisão 0, devolve `{ id, ordem }[]` (lista vazia → `RangeError`); `contarFuturasDaCliente` com o SQL do dba.md Q5; `listarBloqueantesDeDesativacao` e `listarConfirmadasQueCruzam`/`consultaReservasQueCruzam` sobre `reserva_item` (literal e `tstzrange(i.inicio, i.ocupado_ate, '[)')` mantidos); `atualizarStatus` removido.
- `src/server/repos/servico.ts`: §3.8 `travarParaItens` (+ `chaveVinculo`, `ServicosTravadosParaItens`); cabeçalho da ordem canônica atualizado com o §4.6. `travarParaReserva` permanece (sai na T-6).
- `src/server/repos/profissional.ts`: `travarVariosParaReserva` (laço de `travarParaReserva` sobre ids distintos em minúsculas e ordenados; Map por id minúsculo, null = ausente/outro salão/malformado sem consulta); cabeçalho atualizado.
- `src/server/repos/index.test.ts`: `atualizarStatus` sai; casos sem consulta das APIs novas.
- `src/server/reservas/itens.ts` + `itens.test.ts` (novos): §3.2 `derivarStatus`, `envelope`, `derivarReserva`; e `conferirItens(itens, fuso)` (data local única, RN-8, RN-9; ignora cancelados; resultado `ok` | `data_diferente` com índices | `entre_itens` com `conflitos[k] = j`).
- `src/server/reservas/erros-banco.ts` + teste: só 23P01 + `"reserva_item_sem_sobreposicao"`; nome antigo e `reserva_item_mesma_reserva_sem_sobreposicao` não reconhecidos.
- `tests/support/sql.ts`: `inserirReserva` compatível (reserva + 1 item num único comando com CTEs; aceita `Date`/string, `encaixe`, `servicoId`, `revisao`); novo `inserirReservaComItens` (derivados por `derivarReserva`).
- `tests/support/reservas.ts`: `conferirDerivados(reservaId | { salaoId })` (SQL independente da função pura); `inserirReservaDireta` com 1 item; `entradaReserva` no formato `itens` da §3.5 (tipo local `EntradaReservaDeTeste`).
- `tests/support/factories.ts`: reserva da fábrica com 2 itens encadeados do profissional. `tests/support/mensagens.ts`: itens por serviço com status/revisão da reserva; `mudarReserva` propaga status/revisão aos itens.
- `tests/integration/repos/reserva-itens.test.ts` (novo diretório, sem outro dono): repositórios e suporte com PostgreSQL real.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run src/server/reservas/itens.test.ts src/server/reservas/erros-banco.test.ts src/server/repos/index.test.ts` | 3 arquivos, 52 testes verdes |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/reservas/itens.test.ts` | 29/29 nos dois |
| `npx vitest run --project integration tests/integration/db tests/integration/harness tests/integration/repos` | 20 arquivos, 400 testes verdes (inclui `mensagem-reconciliacao.test.ts`) |
| laço ×10 `tests/integration/repos` | 10/10 verdes |
| `npx eslint` nos arquivos da T-2 `--max-warnings=0` | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-2 | vazio |

### Desvios e riscos
- `conferirItens` ficou em `itens.ts` (puro, sem textos), não em `validacao.ts`: T-5/T-6 só mapeiam o resultado para `MENSAGENS_RESERVA` e para `horario_indisponivel/entre_itens`.
- `travarVariosParaReserva` é método novo do repositório (o design citava o laço sobre `travarParaReserva`; o laço agora é único e testado com `pg_stat_activity`).
- R-1: o typecheck global continua quebrado em arquivos de outras tarefas. Fora de qualquer posse listada: `src/server/bloqueios/apresentacao.test.ts` (fixtures de `ReservaCobertaDTO` sem `itemId`).

## T-14 — Seed e suporte do E2E (23/11/2026)

### Arquivos
- `prisma/seed/dados.ts`: `ReservaSpec` passa a ter duas formas: a abreviada (um `profissional`, `inicioMin` e `servicos` encadeados) e a explícita `itens: ItemSpec[]` (`{ servico, profissional, inicioMin?, status? }`); `status` da spec é o padrão dos itens.
- `prisma/seed/plano.ts`: `ReservaPlanejada` sem `profissionalId`/`ocupadoAte`; novo `ItemPlanejado` com profissional, início, fim, `ocupadoAte` = fim + intervalo do salão (mesma regra da criação, §3.5 passo 5) e status. Na forma abreviada o item seguinte começa no `ocupado_ate` do anterior (RN-9: no salão B, intervalo de 10 min, o 2º item começa 10 min depois do fim do 1º). `status`/`inicio`/`fim`/`canceladaEm` da reserva vêm de `derivarReserva` (`src/server/reservas/itens.ts`), com `agora` = 1 dia antes do primeiro item (o `cancelada_em` das canceladas continua igual ao da D-036). `sobreposicoes` agora é por item (`<chave>:<ordem>`), entre reservas.
- `prisma/seed/salao-a.ts`: `r9` (CA-51, daqui a 2 dias): Escova com Marcos 10:00, Hidratação com Beatriz 10:30, Manicure com Helena 14:00; `r10` (3 dias atrás): Corte com Helena `concluido` + Manicure com Beatriz `cancelado` (reserva derivada `concluido`).
- `prisma/seed/complemento-e2e.ts`: serviço Manicure (45 min, R$ 45,00) e a profissional Duda (só Manicure) nos salões `e2e-reservas-N`/`e2e-suspenso` (o suspenso só tem Ana, então Manicure não é ofertável lá), para a T-15 poder rodar o exemplo escova + hidratação + manicure num salão isolado.
- `prisma/seed.ts`: `reserva` grava só os derivados (sem `profissional_id`, `ocupado_ate`, `encaixe`); `reserva_item` grava profissional, início, fim, ocupado-até e status (revisão 0, encaixe false pelos DEFAULTs).
- `e2e/suporte/fixtures.ts`: `ReservaDoBanco` = `{ id, inicio, fim, status, itens }` (sem `profissional` no topo; cada item tem `servico`, `profissional`, `ordem`, `inicio`, `fim`, `status`, `precoCentavos`, `duracaoMin`, por (inicio, id)). `ocuparHorario(slug, nome, inicio, minutos, servicoNome?)` e `criarReservaConcluida` gravam reserva + 1 item num ÚNICO comando (CTE; derivados iguais aos do item; `ocupado_ate` = fim + intervalo do salão; a exclusion `reserva_item_sem_sobreposicao` continua sendo a árbitra). `ocuparHorario` usa o 1º serviço (por nome) que o profissional executa, ou `servicoNome`.
- Testes: `tests/integration/seed/plano.test.ts` (sobreposição por item, `conferirItens` em toda reserva planejada, encadeamento com intervalo, CA-51 puro, derivados = `derivarReserva`, erros do plano), `tests/integration/seed/seed.test.ts` (CA-7 sobre `reserva_item` com 23P01 de `reserva_item_sem_sobreposicao`; novo bloco "D-050": `conferirDerivados` em todos os salões com total = reservas semeadas, CA-51 no banco com roteiro "Escova com Marcos Pires; Hidratação com Beatriz Lima; Manicure com Helena Moura", item cancelado fora do envelope) e o novo `tests/integration/seed/fixtures-e2e.test.ts` (complemento E2E com `conferirDerivados`; as fixtures contra o PostgreSQL real com `E2E_DATABASE_URL` = base do worker: forma do `reservasDoTelefone`, 23P01 sem reserva órfã, serviço não executado, outro profissional no mesmo horário, reserva concluída).

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/seed` | 4 arquivos, 44 testes verdes |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run --project integration tests/integration/seed/plano.test.ts` | 11/11 nos dois |
| `npx vitest run --project integration tests/integration/lint/importacao-{fila,integracoes,prisma}.test.ts` | 329 verdes (leem `prisma/seed` e `e2e/suporte`) |
| `npx eslint --max-warnings=0 prisma/seed.ts prisma/seed e2e/suporte tests/integration/seed` | ok |
| `npx tsc --noEmit` filtrado por `prisma/`, `e2e/suporte/`, `tests/integration/seed/` | vazio (o global segue com erros de outras tarefas, R-1) |
| `npm run build:node` | ok (o bundle não quebrou por R-1: esbuild não checa tipos) |
| `E2E_DATABASE_URL=…/agenda_beleza_t14_e2e node --env-file-if-exists=.env dist/e2e/preparar-banco.js` | migrações aplicadas (inclui `20261127000000_reserva_item_autonomo`), seed + complemento: 35 reservas, 44 itens; base temporária apagada depois |

Playwright não foi executado (T-15).

### Desvios e riscos
- `ReservaDoBanco` perdeu o campo `profissional` do topo (não existe com N profissionais). `e2e/publico-reserva.spec.ts` compara `itens` com objetos sem `profissional`/`inicio`/`fim`/`status`: a T-15 precisa ajustar essa asserção (o `toEqual` falharia).
- Complemento E2E ganhou Manicure/Duda (não pedido explicitamente no design, só "complemento E2E"): nenhuma spec atual cita os profissionais desses salões, mas a lista de serviços da página pública desses salões tem um item a mais.
- Seed B: as reservas multi-serviço de um só profissional agora têm um vão de 10 min entre os itens (regra RN-9 da criação), em vez de itens colados como na migração de dados.

## T-3 — Disponibilidade por serviço (23/11/2026)

### Arquivos
- `src/domain/disponibilidade/tipos.ts`, `calcular.ts`: `EntradaDeCalculo.ocupacoesDaCliente?` (RN-8: `[t, t + duracaoMin)` × união das ocupações da cliente, para todos os profissionais, sem intervalo; instante inválido → `RangeError`). `duracaoMin` passa a ser a do serviço. Nenhuma outra regra mudou.
- `src/domain/disponibilidade/escolhidos.test.ts` (novo): CA-4 no domínio, compatibilidade sem o campo, união, adjacência, outra data, entrada inválida.
- `src/server/repos/disponibilidade.ts`: `candidatos(ctx, servicoIds, profissionalIds: string[] | null)` → `{ id, nome, ativo, servicos: string[] }` (1 SQL; `ARRAY(SELECT … ORDER BY servico_id)`; lista com id malformado → `NaoEncontrado` sem SQL; `[]` → `[]` sem SQL). `consultaOcupacoes` sobre `reserva_item i` (SQL do dba.md Q6, literais `i.status IN ('confirmado', 'concluido', 'nao_compareceu')` e `tstzrange(i.inicio, i.ocupado_ate, '[)')`).
- `src/server/disponibilidade/tipos.ts`, `servico.ts`, `validacao.ts` (+ `validacao.test.ts`): §3.4. **Removidos** `consultarDisponibilidade`, `listarProfissionaisElegiveis`, `EntradaDisponibilidade`, `ResultadoDisponibilidade`, `ResultadoElegiveis`, `ServicoEscolhido`.
- `tests/integration/disponibilidade/`: `apoio.ts` (`inserirReserva`/`inserirReservaComItens` reexportados de `tests/support/sql.ts`; `rotulos(r, idx, dia, servico)`, `rotulosDe`, `profissionaisDe`), `servico.test.ts`, `isolamento.test.ts`, `repo.test.ts`, `consultas.test.ts` e `plano.test.ts` reescritos; `por-servico.test.ts` (novo).

### API final (para T-5, T-10, T-12)
```ts
import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
consultarDisponibilidadePorServico(ctx, {
  servicoIds,                 // 1..10, sem repetição
  de, ate, agora,
  escolhidos?: { servicoId, profissionalId, inicio: Date }[],   // ≤ 1 por serviço, servicoId ∈ servicoIds
  calcular?: string[],        // subconjunto não vazio de servicoIds (padrão todos)
  profissionalPorServico?: Record<servicoId, profissionalId>,   // se não vazio, cobre TODO serviço calculado
}, leitor?)  // T-5: passe r.disponibilidade da transação
→ { resultado: 'ok'; fuso; intervaloMin; servicos: { servicoId; nome; duracaoMin; precoCentavos;
      profissionais: { profissionalId; nome; dias }[]; vazioPorConflito }[] }   // só os calculados, ordem de servicoIds
  | { resultado: 'servico_indisponivel' }       // algum de servicoIds (inclusive dos escolhidos) não ofertável
  | { resultado: 'entrada_invalida'; motivo }   // + 'escolhidos_invalidos' | 'calculo_invalido'
horarioOferecido(servicoDoResultado, profissionalId, inicio): boolean   // puro; comparação exata do instante
```
- Escolhido para o serviço k é ignorado no cálculo de k; para os demais ocupa a cliente `[inicio, fim)` e o profissional dele `[inicio, fim + intervalo)` (fim = início + duração ATUAL do serviço).
- `profissionalPorServico`: valor malformado → `NaoEncontrado` sem SQL; de outro salão/inexistente → `NaoEncontrado` (depois de 3 SQL); inativo ou sem vínculo com o serviço → aquele serviço com `profissionais: []`. Ids em maiúsculas são aceitos (comparação em minúsculas).
- Revalidação (T-5, `modo: 'normal'`): uma chamada com `escolhidos` = todos os itens e `profissionalPorServico`; o item `k` passa se `horarioOferecido(servicos[k], item.profissionalId, item.inicio)`.
- Profissional sem jornada no dia continua listado com dias vazios (D-018). Toda data pedida aparece em `dias` (fora da janela → vazia).

### Comandos
| Comando | Resultado |
|---|---|
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run --project unit src/domain/disponibilidade src/server/disponibilidade` | 103/103 nos dois |
| `npx vitest run --project integration tests/integration/disponibilidade` | 6 arquivos, 108 testes verdes |
| laço ×10 `plano.test.ts consultas.test.ts por-servico.test.ts` | 10/10 |
| cobertura só dos arquivos da T-3 (domínio + serviço + repo) | 100% linhas (99,62% ramos) |
| `npx eslint src/domain/disponibilidade src/server/disponibilidade src/server/repos/disponibilidade.ts tests/integration/disponibilidade --max-warnings=0` | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-3 | vazio |

### Testes e CAs
- CA-1/CA-2: `por-servico.test.ts` ("A lista só Ana e B só Carla", "um serviço sem profissional elegível não impede o outro").
- CA-3: `consultas.test.ts` (24 cenários 1/3/10 serviços × 1/8 profissionais × 1/14 datas × com/sem funcionamento = 6 instruções; escolhidos/`calcular`/restrição = 6; C3 sem instrução a mais; só 1 instrução lê `reserva_item`, nenhuma lê `reserva`; curtos-circuitos 0/1/2/3) e `plano.test.ts` (`[CA-3]`: 100.000 itens em 50.000 reservas de 2 itens; custom e genérico, 10 prof. × 61 dias ≈ 2,5 ms e 1 × 1 dia ≈ 0,05 ms, Bitmap Index Scan em `reserva_item_sem_sobreposicao`, sem Seq Scan em `reserva_item`).
- CA-4: `escolhidos.test.ts` (domínio) e `por-servico.test.ts` (serviço, grade 5, intervalo 10).
- C3: `por-servico.test.ts` ("vazioPorConflito").
- CA-50 (disponibilidade): `isolamento.test.ts` (itens de S2 nunca ocupam S1; escolhido com profissional de S2 só ocupa a cliente; ids de S2 indistinguíveis de inexistentes).

### Desvios e riscos
- `MotivoEntradaInvalida` ganhou `escolhidos_invalidos` e `calculo_invalido` (o design não definia o desfecho dessas entradas mal formadas).
- `profissionalPorServico` precisa cobrir todo serviço calculado (o design deixava o parcial em aberto); assim `candidatos` continua com a assinatura `string[] | null` e 1 SQL.
- Novo helper puro `horarioOferecido` (não previsto) para T-5/T-10/T-12 não reimplementarem a busca.
- Chamadores antigos ficam quebrados até T-5/T-10/T-12 (R-1): `src/server/reservas/criar-reserva.ts`, `src/server/reserva-publica/pagina.ts` e os testes `tests/integration/reservas/{revalidacao,fuso}.test.ts`, `tests/integration/reservas/alteracao/alteracao.test.ts`, `tests/integration/reserva-publica/pagina.test.ts`.

## T-8 — Leitores restantes e regressão (23/11/2026)

### Arquivos de produção
- `src/server/repos/cliente.ts`: `historico` lê, por reserva (envelope derivado, da mais recente à mais antiga), TODOS os itens por (inicio, id) com serviço, profissional, status, início, preço e duração do item (§3.1 `ReservaHistoricoDTO`). `buscarContato` com `so.profissionalId` exige um ITEM da cliente com o profissional, em qualquer status (RN-38).
- `src/server/clientes/tipos.ts`: `ItemHistorico` agora tem `status` (derivado da reserva), `servicos: ServicoHistorico[]` (serviço, profissional, hora local, status, `cancelado`, preço) e `precoTotal` + `totalDaCancelada`. Saíram `profissional` e `duracaoTotal`: com vários profissionais a soma das durações não é o tempo decorrido (mesma decisão D4 do web-design para o detalhe).
- `src/server/clientes/servico.ts`: `paraItemHistorico` (exportada) aplica a RN-35: total = itens não cancelados; reserva toda cancelada → soma de todos e `totalDaCancelada`.
- `src/app/painel/clientes/HistoricoCliente.tsx` e `Clientes.module.css` (`.itensReserva`, `.itemCancelado` com `--cor-texto-suave` + `line-through`; o rótulo "(Cancelado)" fica fora do trecho riscado); `src/app/dev/clientes/demonstracao.ts` (uma reserva de 2 serviços com profissionais diferentes, um cancelado, e uma toda cancelada).

### Testes alterados ou novos (CA coberto)
- `src/app/painel/clientes/HistoricoCliente.test.tsx`: itens com hora/profissional/preço/status, riscado só no item cancelado, "Total (cancelada)" (RN-35).
- `src/server/bloqueios/apresentacao.test.ts`: fixtures com `itemId`; novo caso de 2 itens da mesma reserva → 2 linhas (RN-38).
- `tests/integration/clientes/`: `apoio.inserirReservaComPreco` sobre `inserirReservaComItens` (profissional/status por item, `revisao`); `historico.test.ts` reescrito + 2 casos novos RN-35 (itens de 2 profissionais com cancelado; concluído + não compareceu = "Concluído"); `contato.test.ts` + caso RN-38 (item cancelado e não primeiro dá acesso; profissional sem item → NaoEncontrado); `anonimizacao-concorrencia.test.ts`: reserva com revisão 1 (o `cancelamento` da T-4 exige revisão ≥ 1).
- `tests/integration/profissionais/`: `apoio` (`cancelarReservasDoSalao`/`cancelarReservas` cancelam itens e derivados; `inserirReservaComItens` local sobre o suporte, itens encadeados preservando o envelope); `repos.test.ts`, `desativar.test.ts`, `paginas.test.ts` esperam UMA LINHA POR ITEM; novo `D-050 RN-38` em `desativar.test.ts` (item cancelado de um profissional não bloqueia; o confirmado do outro, na mesma reserva, bloqueia só ele); `regressao-tester.test.ts` (D-7 insere reserva + item sem commit).
- `tests/integration/bloqueios/`: `apoio.criarReservaEm` = `inserirReserva` compatível + `itemDe`; `repos.test.ts` com `itemId`, `i.status = 'confirmado'` e plano genérico em `reserva_item_sem_sobreposicao` (removendo os btree de `reserva_item` na transação desfeita) + controle com status parametrizado; `criar-editar-remover.test.ts`: empate por id do item e reserva da fábrica = 2 linhas.
- `tests/integration/avaliacoes/`: `apoio.criarAvaliavel` com itens (`itens?: status[]`, profissionais alternados) e `definirStatus` (itens + derivado); `esquema.test.ts` (50 mil reservas com item); `envio`, `visibilidade`, `independente-tester`, `concorrencia` (caso determinístico) sem escrever só no derivado. **Novo `status-derivado.test.ts` (CA-45)**: todos "não compareceu" → link inválido e nada gravado; concluído + não compareceu → aceita e exibe, uma por reserva; item ainda confirmado → inválido; avaliação some quando o último concluído vira "não compareceu" e volta; concluído + cancelado é concluído.
- `tests/integration/tenant/`: `isolamento.test.ts` (CA-2 da reserva agora escreve um item por `criarItens` depois de `buscarPorId` escopado; outro salão → 404 sem item novo em B), `transacao.test.ts` (CA-14 com `criar` + `criarItens` e `conferirDerivados`; novo caso de rollback da reserva e itens), `contextos.test.ts` (AdminContext recusado em `criarItens`), `fabricas.test.ts` (profissional/status/encadeamento por item + `conferirDerivados`).
- `tests/integration/concorrencia/`: `disputa.ts` grava reserva + item; constraint esperada `reserva_item_sem_sobreposicao`.
- `tests/integration/consentimento/transacao.test.ts`: o 23P01 vem de `reserva_item_sem_sobreposicao`.
- Sem mudança necessária: `denuncias`, `convites` (exceto o abaixo), `salao`, `fila`, `worker`, `politica/{publicos,estatico,varredura}`.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run src/app/painel/clientes src/app/dev/clientes src/server/clientes src/server/bloqueios src/components/conformidade.test.ts` | 160/160 |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/clientes tests/integration/clientes/historico.test.ts` | 90/90 nos dois |
| `npx vitest run --project integration tests/integration/{clientes,profissionais,bloqueios,avaliacoes,denuncias,consentimento,convites,tenant,salao,politica,concorrencia,fila,worker}` | 91 arquivos: 1121 verdes, 26 vermelhos, todos dependentes de outras tarefas (abaixo); `clientes` depois do ajuste da revisão: 137/137 |
| 3× `anonimizacao-concorrencia` + `concorrencia/` + `profissionais/{concorrencia,regressao-tester}` | 22/22 nas três |
| `npx eslint --max-warnings=0` nos arquivos alterados (exceto o CSS, fora do ESLint) | ok |
| `npx tsc --noEmit` filtrado pelos arquivos alterados | vazio |

### Pendências (dependem de outras tarefas; não são defeitos da T-8)
- **Posse transferida à T-6 (decisão do líder):** `tests/integration/politica/reservas.test.ts` (criação no formato `itens` da T-5, operações antigas e `../reservas/alteracao/apoio`; continua com erros de tsc), `tests/integration/politica/varredura.test.ts` (linhas 52–55 com as ações antigas de `reservas-status.acao.ts`) e `tests/integration/avaliacoes/concorrencia.test.ts` (R-1 chama `marcarStatusReserva`). A T-8 não os altera mais; as edições já feitas em `avaliacoes/concorrencia.test.ts` (caso determinístico: item antes do derivado) ficam para a T-6 conferir.
- `tests/integration/clientes/anonimizacao-concorrencia.test.ts` continua da T-8 e depende de `RepoMensagem.substituirPendentes`/`registrarMensagem` da T-4: hoje verde (137/137 em `clientes`) com a reserva em revisão 1; reconferir quando a T-4 terminar (o líder reaciona).
- `convites/aceite.test.ts` (1) e `politica/paginas.test.ts` (1): quebram em `repos/agenda.ts` (`r.profissional_id`), da T-7.

### Desvios e riscos
- `HistoricoCliente.tsx` e `Clientes.module.css` ficam em `src/app/painel/clientes/` (fora de `[id]/**`), mas são o histórico do detalhe e não têm outro responsável; editados aqui.
- Chave React duplicada (uma linha por item repete o id da reserva): corrigida na T-8 com posse estendida pelo líder (abaixo).
- CA-2 de isolamento da reserva: sem a primitiva `atualizarStatus`, a escrita é acrescentar um item; a linha de `reserva` em si não muda no controle (o teste confere o item novo).

### Posse estendida pelo líder: chave por item na desativação e no aviso de bloqueio
- `src/server/profissionais/tipos.ts` (`ReservaBloqueante.itemId`), `src/server/profissionais/servico.ts` (só `desativar`: copia `itemId` do DTO), `src/app/painel/profissionais/ControleAtivacao.tsx` (`key={r.itemId}`).
- `src/server/bloqueios/tipos.ts` (`ReservaCoberta.itemId`), `src/server/bloqueios/apresentacao.ts` (`paraAviso` copia `itemId`), `src/app/painel/bloqueios/AvisoReservasCobertas.tsx` (`key={r.itemId}`), `src/app/dev/bloqueios/acoes.ts` (exemplo com `itemId`).
- Testes: `ControleAtivacao.test.tsx` e `AvisoReservasCobertas.test.tsx` ganharam um caso de 2 itens da MESMA reserva que confere as duas linhas e que o React não emite aviso de "same key" (`console.error` espionado). Prova de que o teste pega o defeito: com `key={r.id}` restaurado temporariamente, os 2 casos novos falham; com `itemId`, passam. `FormularioBloqueio.test.tsx` e `apresentacao.test.ts` com `itemId` nas fixtures; integração `profissionais/desativar.test.ts` (CA-3 com os `itemId` reais, distintos), `bloqueios/criar-editar-remover.test.ts` e `bloqueios/paginas.test.ts` com `itemId`.

| Comando | Resultado |
|---|---|
| `npx vitest run src/app/painel/profissionais/ControleAtivacao.test.tsx src/app/painel/bloqueios/AvisoReservasCobertas.test.tsx` com `key={r.id}` (controle) | 2 falhas (os casos novos), 8 verdes |
| `npx vitest run src/app/painel/profissionais src/app/painel/bloqueios src/app/dev/bloqueios src/server/bloqueios src/server/profissionais src/components/conformidade.test.ts` | 121/121 |
| `npx vitest run --project integration tests/integration/profissionais tests/integration/bloqueios` | 140/140 |
| `npx eslint --max-warnings=0` nos 14 arquivos desta extensão | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-8 (inclui a extensão) | vazio |


## T-4 — Mensagens e WhatsApp (23/11/2026)

### Arquivos
- `src/server/repos/mensagem.ts`: `PREDICADO_VIGENTE: Prisma.Sql` exportado (texto do `dba.md` M-4, aliases fixos `m`/`r`, literais, sem parâmetros). `substituirPendentes` saiu; entrou `substituirNaoVigentes(ctx, reservaId, agora): Promise<number>`, UM comando (CTE `… AND NOT ${PREDICADO_VIGENTE} ORDER BY m.id FOR UPDATE OF m` + UPDATE para `substituida`, `erro_codigo = 'substituida'`, destinatário e parâmetros nulos, `atualizado_em = agora`). `inserir` grava `reserva_item_id` (id malformado → NaoEncontrado; item de outra reserva → 23503 da FK, não capturado). `reenviar` confere a vigência com o status derivado e os itens (revisão/status), lidos num comando. `listarDaReserva`/`listarDaReservaDaEquipe` devolvem `reservaItemId`; a da equipe, com profissional, exige item dele na reserva (senão NaoEncontrado) e lista só as mensagens sem item e as dos itens dele (RN-37), ainda em um comando e sem trava.
- `src/server/repos/mensagem-sistema.ts`: `iniciarEnvio` lê os itens (nomes atuais de serviço e profissional, por (inicio, id), `jsonb_agg` no mesmo comando) para o novo `ContextoDeEnvio`.
- `src/server/mensagens/elegibilidade.ts`: `conferirVigencia(tipo, m, { status, itens })` pela regra M-4 (confirmação sem revisão).
- `src/server/mensagens/parametros.ts`: `montarParametros(tipo, { salaoNome, fuso, itens, revisao })` (§3.7; sem `\r\n\t`; seleção vazia → RangeError). Novo tipo `ItemDosParametros`.
- `src/server/mensagens/registrar.ts`: `reservaItemId?` (só `remarcacao`/`cancelamento`, senão RangeError antes de ler o banco); `cancelamento` também exige revisão ≥ 1 (RN-28); NÃO substitui mais.
- `src/server/mensagens/envio.ts`: vigência e parâmetros a partir dos itens. `consultar-por-reserva.ts`, `situacao-tipos.ts` (`reservaItemId?` opcional, para as vitrines não quebrarem), `tipos.ts` (`MensagemDaReservaDTO.reservaItemId`).
- `src/server/integrations/whatsapp/mapeamento.ts`: `ORDEM_PARAMETROS.confirmacao = ['salao', 'data', 'itens']`. Simulado sem mudança.
- `docs/whatsapp-templates.md`: novo modelo sugerido `agenda_confirmacao_itens` e o aviso R-3.
- Testes: `src/server/mensagens/{elegibilidade,parametros,registrar,envio}.test.ts`, `src/server/integrations/whatsapp/{mapeamento,real,tester-d047}.test.ts`, `src/worker/handlers/whatsapp-reserva.test.ts` (só a fixture do contexto); integração: novos `tests/integration/mensagens/{vigencia,substituicao,itens}.test.ts`, adaptados `apoio.ts` (`registrar` com `{ reservaItemId, substituir }`, `registrarESubstituir`, `itensDa`), `envio`, `registro`, `repos`, `concorrencia`, `isolamento`, `leitura`, `migracao`, `reenvio`, `situacao-equipe` (helper local sobre `inserirReservaComItens`, porque `tests/integration/agenda/apoio.ts#reservar`, da T-7, ainda grava colunas removidas), `tests/integration/integracoes/whatsapp-real.test.ts` (CA-43).

### Testes × CA
| CA | Teste |
|---|---|
| CA-37 | `itens.test.ts` "CA-37" (3 itens, 3 profissionais, worker real); `parametros.test.ts`; `envio.test.ts` (integração) CA-1 |
| CA-38 | `itens.test.ts` "CA-38" (revisões 1 e 2, `reserva_item_id` de cada uma, parâmetros do próprio item) |
| CA-39 | `itens.test.ts` "CA-39" (2 casos) e `substituicao.test.ts` |
| CA-40 | `itens.test.ts` "CA-40"; `substituicao.test.ts` "CA-40"; `elegibilidade.test.ts` |
| CA-41 | `itens.test.ts` "CA-41"; `registro.test.ts` CA-4; `idempotencia.test.ts` |
| CA-42 | `itens.test.ts` "CA-42"; `registro.test.ts` CA-13 |
| CA-43 | `mapeamento.test.ts`, `real.test.ts`, `tester-d047.test.ts`, `whatsapp-real.test.ts` "D-050 CA-43"; `documentacao.test.ts` (ordem no doc) |
| Paridade M-4 | `vigencia.test.ts`: 364 reservas × 4 tipos × 3 revisões (4.368 casos), SQL × pura, sem divergência; literais e "fonte única" (o texto `vi.revisao = m.revisao` só existe em `repos/mensagem.ts`) |
| RN-37 | `situacao-equipe.test.ts` (2 casos novos) |

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run src/server/mensagens src/server/integrations/whatsapp src/worker/handlers` (`TZ=UTC` e `TZ=America/Sao_Paulo`) | 21 arquivos, 291/291 nos dois |
| `npx vitest run --project integration tests/integration/mensagens tests/integration/integracoes/whatsapp-real.test.ts` | 17 arquivos (incluídos os 3 novos), 171/171 + CA-43 (5/5 no arquivo) |
| `npx vitest run --project integration tests/integration/integracoes/documentacao.test.ts` | 17/17 |
| laço ×10 `concorrencia` + `idempotencia` + `substituicao` | 10/10 |
| cobertura restrita a `src/server/mensagens/**`, `repos/mensagem*.ts`, `integrations/whatsapp/**` | 97,5% linhas (`repos/mensagem.ts` 91,4%: o restante é `anonimizarDaCliente`, coberto pelos testes de clientes) |
| `npx eslint --max-warnings=0` nos arquivos da T-4 | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-4 | vazio |

### API para T-5/T-6/T-7
- `registrarMensagem(ctx, { reservaId, tipo, reservaItemId? }, agora, r)`; depois, na mesma transação, `r.mensagens.substituirNaoVigentes(ctx, reservaId, agora)` (T-6 em toda operação; T-5 não precisa: a criação só registra a confirmação).
- `import { PREDICADO_VIGENTE } from '@/server/repos/mensagem'` para o EXISTS da agenda (T-7), com aliases `m` e `r`.
- `conferirVigencia(tipo, { revisao }, { status, itens: { revisao, status }[] })`.

### Desvios e riscos
- `substituirNaoVigentes` também anula destinatário/parâmetros e grava `erro_codigo = 'substituida'` (como o antigo `substituirPendentes`); por isso o rótulo D-043 continua "substituída por remarcação posterior" mesmo quando a causa é um cancelamento. Texto inalterado de propósito (tocaria vitrine/E2E de outras tarefas); fica como sugestão de ajuste para a T-13.
- `MensagemSituacao.reservaItemId` é opcional no tipo (só as vitrines `/dev/*` deixam de preencher); `consultarMensagensDaReserva` sempre o preenche.
- Quebras esperadas fora da minha posse (dependem desta API): `src/server/reservas/alterar-status.ts` usa `substituirPendentes` (T-6 troca por `substituirNaoVigentes`); `tests/integration/agenda/falha-mensagem.test.ts` usa a assinatura antiga de `conferirVigencia` e `repos/agenda.ts` ainda tem a regra D-043 duplicada (T-7 importa `PREDICADO_VIGENTE`); `tests/integration/agenda/apoio.ts#reservar` grava colunas removidas (T-7).

## T-7 — Agenda (servidor) (23/11/2026)

### Arquivos
- `src/server/repos/agenda.ts`: §3.9 sobre `reserva_item`. `listarAgenda(ctx, { periodo, profissionalId, limite, comPosicao })` → `{ blocos: LinhaAgenda[], truncada }`, UM comando `reserva_item i JOIN reserva r JOIN cliente c JOIN servico s` com `i.inicio < ate AND i.fim > de AND i.inicio >= de - interval '1 day'` (M-2), filtro `i.profissional_id`, `ORDER BY i.inicio, i.id LIMIT limite+1`; `tem_falha_mensagem` = `EXISTS (… m.estado = 'falhou' AND ${PREDICADO_VIGENTE})` importado de `@/server/repos/mensagem` (nada copiado); "n de N" pelas duas subconsultas correlacionadas do dba.md Q7 só com `comPosicao` (senão `NULL::int`). `detalhe(ctx, id, profissionalId)` → `DetalheAgendaDTO` (reserva com envelope/status derivados + `itens` por (inicio, id) em `json_agg`, instantes como epoch ms para não depender do `TimeZone` da sessão), UM comando; com `profissionalId`, só se existir item dele e só os itens dele. O `profissional` saiu do JOIN da listagem (as colunas já vêm de `bloqueios.listarProfissionais`). Telefone nunca lido.
- `src/server/agenda/tipos.ts`: `BlocoDaAgenda` (§3.9) substitui `ReservaDaAgenda`/`ItemDaAgenda`; `ColunaDaAgenda.blocos`; `DetalheDaReserva` novo (§3.9 + `fuso`, `anonimizada`, `contato`, `temFalhaDeMensagem`), `ItemDoDetalhe`, `AcoesDoItem`, `TotalDoDetalhe`; `LIMITES_AGENDA.itens = 200` (era `reservas`); `MENSAGENS_AGENDA.truncada` = texto do web-design §5.9; novos `apenasSeusServicos` (ND-2) e `canceladosForaDoTotal` (RN-35).
- `src/server/agenda/consultar.ts`: `consultarAgenda` com `blocos` e `comPosicao` só para o gestor; continua com 6 instruções. `lerReservaDaAgenda(ctx, id, agora)` (**novo parâmetro `agora`**): itens com `acoes` de `acoesPermitidas` (por item, `src/server/reservas/status.ts`), `data` = data local do envelope no fuso do salão, `total` por `totalDoDetalhe` (exportada; RN-35), `temItemCancelado`, `podeCancelarTodos` (gestor e 2+ itens com `acoes.cancelar`), `papel`.
- `src/server/agenda/montagem.ts`: `EntradaDaVista.blocos`; cada bloco vai para a coluna do profissional DO ITEM.
- `src/server/agenda/rotulos.ts`: `rotuloDoStatusDoItem` + `ROTULO_STATUS_DO_ITEM` (masculino) e `ROTULO_TOTAL` (`Total` / `Total dos seus serviços` / `Total (cancelada)`).
- Testes: `src/server/agenda/{montagem,rotulos}.test.ts`; `tests/integration/agenda/apoio.ts` (`reservar` sobre `inserirReservaComItens` da T-2; novo `reservarComItens` com profissional/início/status/encaixe por item, itens sem início encadeados; tipos `ItemNovo`, `StatusSql`); `repo.test.ts`, `consultar.test.ts`, `falha-mensagem.test.ts`, `isolamento.test.ts` reescritos; `fuso.test.ts` (só a parte do detalhe, que passou a conferir o DTO).

### API para T-6/T-13
```ts
consultarAgenda(ctx, entrada, agora): AgendaVista            // vista.colunas[k].blocos: BlocoDaAgenda[]
// BlocoDaAgenda = { itemId, reservaId, profissionalId, inicio, fim, status (do item), origem, encaixe (do item),
//   clienteNome | null, servicoNome, precoCentavos, duracaoMin, temFalhaDeMensagem (da reserva),
//   posicao: { n, de } | null }   // null: profissional, item cancelado ou reserva com < 2 não cancelados
lerReservaDaAgenda(ctx, id, agora): DetalheDaReserva
// { id, clienteId, fuso, clienteNome, anonimizada, contato, data: DataCivil, status (derivado), origem,
//   temFalhaDeMensagem, itens: { id, servicoId, servicoNome, profissionalId, profissionalNome, profissionalAtivo,
//   inicio, fim, status, encaixe, precoCentavos, duracaoMin, acoes: { remarcar, cancelar, concluir, naoCompareceu } }[],
//   total: { centavos, servicos, rotulo: 'reserva' | 'seus_servicos' | 'cancelada' }, temItemCancelado,
//   podeCancelarTodos, papel: 'gestor' | 'profissional' }
montarVista({ …, blocos })                                   // vitrine /dev/agenda
rotuloDoStatusDoItem(status), ROTULO_TOTAL[total.rotulo], MENSAGENS_AGENDA.{truncada, apenasSeusServicos, canceladosForaDoTotal}
```
A página do detalhe deixa de chamar `acoesPermitidas` (vem pronto em `item.acoes`) e passa `agora` a `lerReservaDaAgenda`.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project unit src/server/agenda` | 5 arquivos, 36/36 |
| `npx vitest run --project integration tests/integration/agenda/{repo,consultar,falha-mensagem,isolamento,estatico}.test.ts` | 5 arquivos, 59/59 |
| `TZ=UTC` e `TZ=America/Sao_Paulo` com `src/server/agenda` + os 5 arquivos acima | 10 arquivos, 95/95 nos dois |
| plano (`repo.test.ts -t plano --silent=false`, 60.000 itens, 10 profissionais) | dia/semana × todos/um × com/sem posição: Index Scan em `reserva_item_salao_id_inicio_idx` (sem filtro) ou `reserva_item_salao_id_profissional_id_inicio_idx` (um), `Index Cond` com `inicio >= de - 1 day`, sem Seq Scan em `reserva_item`/`reserva`/`mensagem`; EXISTS por `mensagem_reserva_id_tipo_revisao_key`; posição por `reserva_item_salao_id_reserva_id_servico_id_key`; 0,10–2,39 ms |
| cobertura restrita a `src/server/agenda/**` e `repos/agenda.ts` | 99,43% linhas (`repos/agenda.ts` 100%; falta só o `catch` do contato em `consultar.ts`, coberto pelos testes de página quando a T-13 terminar) |
| `npx eslint --max-warnings=0 src/server/agenda src/server/repos/agenda.ts tests/integration/agenda` | ok |
| `npx tsc --noEmit` filtrado por `src/server/agenda`, `src/server/repos/agenda.ts`, `tests/integration/agenda` | vazio |

### Testes × CA
| CA | Teste |
|---|---|
| CA-32 | `consultar.test.ts` "CA-32" (bloco por item nas colunas de Bia, Ana e Carla, mesmo `reservaId`, "n de 3"; detalhe com 3 itens, ações por item, total 20500) |
| CA-33 | `consultar.test.ts` "CA-33" (profissional: só o próprio bloco e item, `posicao` null, total "seus serviços", JSON sem ids/nomes/preços/horários dos outros; sem item na reserva → NaoEncontrado; item próprio cancelado abre); `repo.test.ts` "profissional: só os próprios" |
| CA-34 | `falha-mensagem.test.ts` (falha vigente marca os 3 blocos e o da profissional; 6 instruções com 1 e 50 reservas de 2 itens; paridade SQL × `conferirVigencia` em 128 combinações tipo × status de 2 itens × revisão); `consultar.test.ts` / `repo.test.ts` CA-16 (6 e 1 instrução, gestor e profissional, com e sem posição) |
| CA-35 | `consultar.test.ts` "201 itens no período" (200 + truncada + texto; 200 exatos não truncam); `repo.test.ts` "limite conta ITENS" |
| RN-35 | `consultar.test.ts` "RN-35" (cancelado fora do total; toda cancelada → `cancelada` com a soma de todos, inclusive para a profissional) e "status derivado concluído" |
| RN-36 | `repo.test.ts` (bloco no profissional do item, posição, item cancelado sem posição) e `montagem.test.ts` |
| M-2 | `repo.test.ts` "item de 1440 min que começa 1 dia antes" e o plano |
| CA-50 (agenda) | `isolamento.test.ts` (reservas de 2 itens em 2 profissionais por salão; listagem, detalhe com e sem profissional, jornadas) |

### Desvios
- `DetalheDaReserva` mantém `fuso`, `anonimizada`, `contato` e `temFalhaDeMensagem` (não listados no §3.9, mas usados pela tela) e cada item ganhou `servicoId` (para o formulário de remarcar pré-selecionar o serviço). Saíram `profissional`, `inicio`, `fim`, `encaixe`, `totalCentavos` e `duracaoTotalMin` (o envelope revelaria horários de outros profissionais ao papel profissional; D4 do web-design dispensa a duração total).
- `posicao` é `null` também no item cancelado e quando a reserva tem menos de 2 itens não cancelados (o web-design só mostra "1 de 3" com 2+); a UI só precisa testar `!== null`.
- `podeCancelarTodos` usa o papel derivado do escopo de `agenda.ver` (gestor = `salao`), que coincide com a linha `reserva.cancelar_todos` (salao/negado) da T-6; não depende de `podeCancelarTodos` de `status.ts` (ainda não existe) e conta os itens com `acoes.cancelar` (mesma `decidirTransicao`). A ação da T-6 continua sendo a guarda real.
- `lerReservaDaAgenda` ganhou o parâmetro `agora` (as ações por item dependem do relógio).

### Pendências e posse (decisão do líder)
- `tests/integration/agenda/paginas.test.ts` e `tests/integration/agenda/fuso.test.ts` passaram à **T-13** (renderizam a tela; vermelhos até os componentes e `reservas/[id]/page.tsx` usarem `blocos`/`lerReservaDaAgenda(ctx, id, agora)`). `tests/integration/politica/paginas.test.ts` ("/painel/agenda") depende da mesma tela.
- `tests/integration/convites/aceite.test.ts` passou à T-7 (a T-8 terminou): troca mecânica para `blocos`, `x.reservaId` e `comPosicao: false`, e uma asserção a mais para a checagem de isolamento não passar vazia (`todas.blocos.length > 1`).

| Comando | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/convites` | 4 arquivos, 46/46 |
| `npx eslint --max-warnings=0 tests/integration/convites/aceite.test.ts` | ok |
| `npx tsc --noEmit` filtrado por `convites/aceite` | vazio |

## T-5 — Criação atômica com N itens (23/11/2026)

### Arquivos de produção
- `src/server/reservas/tipos.ts`: §3.5. `ItemPedido`; `EntradaCriarReserva.itens` (saem `servicoIds`/`profissionalId`/`inicio`); `CausaIndisponibilidade` + `'entre_itens'`; `ErrosReserva` com `itens` e `porItem[k].{servico,profissional,inicio}` (sai a chave `servicos`); `ItemDeReservaCriada` (id, profissional, início, fim, ocupado-até, encaixe e status por item) e `ReservaCriada` sem `profissionalId`/`ocupadoAte`/`encaixe` (itens por (inicio, id)); `horario_indisponivel` com `itens` (+ `conflitos` em `entre_itens`), `profissional_indisponivel` com `itens`, `encaixe_requer_confirmacao` com `motivos: { indice, motivos }[]`; `DecisaoEncaixe` = `{ encaixes: boolean[] } | { motivos }` e `decidirEncaixe(ctx, r, { fuso, itens })` em lote; `MENSAGENS_RESERVA.dataDiferente`. `EntradaReservaEquipe` passou ao formato da §3.11 (`data` + `itens[{ servicoId, profissionalId, hora }]`).
- `src/server/reservas/validacao.ts`: §3.5 passo 1 (1..10 itens, `servicoId` distintos via `validarServicos`, `inicio` em minuto cheio por item → `porItem[k].inicio`; ids em minúsculas; `malformados = { servicos, profissionais: índices }`).
- `src/server/reservas/montar-itens.ts` (reescrito): `montarItens(pedidos, snapshotPorServico, intervaloMin)` → `NovoItemDeReserva[]` sem encadeamento (`fim = inicio + duração`, `ocupadoAte = fim + intervalo`, `ordem` = posição, `encaixe = false`); `itensCriados` (casa os ids de `criarItens` por ordem); `paraReservaCriada` (itens por (inicio, id)); `conferirCompativel(existente, itens)` compara o CONJUNTO {servicoId, profissionalId, inicio}.
- `src/server/reservas/decisor-encaixe.ts` (novo): `criarDecisorDeEncaixe(confirmou)` em lote, exatamente 3 instruções para N itens (`r.disponibilidade.jornadas`, `r.disponibilidade.bloqueios` em [menor início, maior fim), `r.funcionamento.ler`); detecção por item com `detectarMotivos` (encaixe.ts, inalterado); sem confirmação → `motivos` só dos itens que os têm; confirmado → `encaixes[k]` true só nos itens com motivo.
- `src/server/reservas/criar-reserva.ts`: §3.5 passos 1–9. Salão FOR SHARE → `travarVariosParaReserva` → `travarParaItens` (inativo/ausente → `servico_indisponivel`; par sem vínculo → `profissional_indisponivel` com índices) → `montarItens` → **`conferirItens` antes de qualquer INSERT** (M-6; `data_diferente` → `invalido` com `porItem[k].inicio = dataDiferente`; RN-8/RN-9 → `horario_indisponivel/entre_itens`) → revalidação com UMA `consultarDisponibilidadePorServico` (`escolhidos` = todos os itens, `profissionalPorServico`, `r.disponibilidade`) e `horarioOferecido` por item (todos os índices que falham) | encaixe (início no passado → `porItem`; `decidirEncaixe` em lote; sem decisor, todos `encaixe = true`) → upsert → `antesDaReserva({ clienteId, inicio: envelope.inicio })` → `reservas.criar` (envelope) → `criarItens` → consentimento → `registrarMensagem('confirmacao')` sem item. 23P01 fora da transação → `itens: []`. Log `reserva.criar` com `itens: n` (sai `profissionalId`).
- `src/server/protecao/futuras.ts`: só o comentário (RN-18: a regra está em `contarFuturasDaCliente` da T-2; a reserva nova conta uma vez).

### API final (T-6, T-10, T-12)
```ts
criarReserva(ctx, {
  itens: { servicoId, profissionalId, inicio: Date }[],   // 1..10, serviço sem repetição, mesma data local
  cliente: { nome, telefone }, aceites, chaveRequisicao?, modo?: 'normal' | 'encaixe', agora,
}, deps?)  // deps.decidirEncaixe: criarDecisorDeEncaixe(confirmou) de '@/server/reservas/decisor-encaixe'
→ 'criada' { reserva: { id, clienteId, inicio, fim, status, origem, revisao, itens[...] }, confirmacao }
| 'repetida' { reserva } | 'horario_indisponivel' { causa: '23P01'|'revalidacao'|'entre_itens', itens: number[], conflitos? }
| 'servico_indisponivel' | 'profissional_indisponivel' { itens: number[] }
| 'invalido' { erros: { itens?, nome?, telefone?, chave?, porItem?: { [k]: { inicio? } } } }
| 'encaixe_requer_confirmacao' { motivos: { indice, motivos }[] } | 'consentimento_ausente' | 'chave_reutilizada' | 'recusado' | 'salao_indisponivel'
```
- T-6 (remarcação, lote de 1): `criarDecisorDeEncaixe(confirmou)(ctx, r, { fuso, itens: [{ inicio, fim, profissionalId }] })` → `{ encaixes: [b] } | { motivos: [{ indice: 0, motivos }] }`. `montarItens` mudou de assinatura.
- T-10: `profissional_indisponivel.itens` e `horario_indisponivel.itens` apontam posições em `itens` (vazio no 23P01, R-6); `porItem` usa só `inicio`.
- T-12: `EntradaReservaEquipe` já está no formato §3.11; `reserva-equipe.ts` importa o decisor de `decisor-encaixe.ts`.

### Testes (CA)
- Unidade: `validacao.test.ts` (passo 1, índices, malformados), `montar-itens.test.ts` (snapshot por item, sem encadeamento, `itensCriados`, conjunto em `conferirCompativel`), `criar-reserva.test.ts` (fase pura sem banco).
- `tests/integration/reservas/apoio-itens.ts` (novo): `item`, `um`, `jornadaDaBia`, `revalidacao` e `ocupar` (reserva + 1 item num único comando).
- `itens.test.ts` (novo): **CA-5** (A 09:00–10:00 + B 09:30 → `entre_itens` no item 1, nada gravado; adjacentes aceitos), **M-6** (dois itens cruzados do mesmo profissional → `entre_itens`, nunca 23P01, também em modo encaixe), **CA-20** (09:30 recusado, 09:40 aceito com intervalo 10), **CA-7** (item em outra data → `invalido`/`dataDiferente`, público e equipe), indisponibilidade por item (índices), **CA-6** (3 itens, 3 profissionais, 2 consentimentos, 1 confirmação sem item, `conferirDerivados`).
- `travas.test.ts` (novo): **CA-18** (×10 cruzados sem impasse; determinístico: com o profissional de menor id travado, a criação espera nele SEM ter travado o de maior id, mesmo pedido primeiro, provado com `NOWAIT`; com um serviço travado, espera em `FOR SHARE OF s` já segurando os dois profissionais).
- `concorrencia.test.ts`: + **CA-17** (10 reservas com um item disputado: 1 criada, 9 `revalidacao` no item 1, sem item gravado) e **CA-22** (criação com item em P1 × desativação de P1).
- `idempotencia.test.ts`: + **CA-11** (10 envios paralelos de 2 itens: 1 criada, 9 repetidas com os mesmos itens; outra ordem = mesma requisição; item a menos = `chave_reutilizada`).
- `encaixe.test.ts`: + RN-17 com o decisor (motivos só dos itens com motivo; `encaixe` real por item; bloqueio próprio não afeta outro profissional; **A-11: 3 instruções para 1 e 3 itens**).
- `estrutura.test.ts`: comandos SQL constantes para 1 e 3 itens do mesmo profissional; +1 por profissional distinto (laço A-10); log com `itens: n` e sem `profissionalId`.
- `criar.test.ts`, `revalidacao.test.ts`, `fuso.test.ts` (+ data única no fuso do salão: São Paulo e Manaus), `atomicidade.test.ts` (+ envelope no `antesDaReserva`; falha forçada em `reserva_item` com 3 itens), `isolamento.test.ts` (**CA-50**: item com profissional/serviço de outro salão = inexistente, com índice), `carga.test.ts`: adaptados ao formato `itens`.
- `suporte.test.ts` (novo): `inserirReservaDireta` e `ocupar` (ver "Posse estendida").
- `tests/integration/protecao/futuras.test.ts` (novo): **CA-15** (2 reservas de 3 itens + a 3ª aceita, a 4ª recusada sem gravar; reserva com todos os itens futuros cancelados não conta, um item confirmado basta; repetida nunca recusada; 10 em paralelo → 3).
- `tests/integration/protecao/futuras-repo.test.ts`: passa a usar `ocupar`.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project unit src/server/reservas` | 8 arquivos, 114/114 |
| `npx vitest run --project integration tests/integration/reservas/*.test.ts tests/integration/protecao/futuras*.test.ts` | 14 arquivos, 120/120 (inclui `carga.test.ts`, 2.165 criações, ~15 s) |
| laço ×10 `reservas/{concorrencia,idempotencia,travas}.test.ts` + `protecao/futuras.test.ts` | 10/10 (32 testes por rodada) |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/reservas tests/integration/reservas/fuso.test.ts tests/integration/reservas/itens.test.ts` | 134/134 nos dois |
| `npx eslint --max-warnings=0` nos arquivos da T-5 | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-5 | vazio |

Playwright não foi executado (T-15). Cobertura medida na T-17.

### Desvios e riscos
- `conferirItens` está em `itens.ts` (T-2), não em `validacao.ts` como no §3.5 passo 6; a criação só traduz o resultado.
- `EntradaReservaEquipe` (§3.11) foi atualizada aqui porque vive em `tipos.ts` (posse da T-5); a T-12 consome.
- `servico_indisponivel` continua sem índices (o §3.5 lista índices só em `profissional_indisponivel`); `porItem` só recebe `inicio` nesta tarefa.
- Revalidação com `entrada_invalida` (não esperado depois da validação) → `invalido` com `porItem[k].inicio` em todos os itens; `NaoEncontrado` da restrição (profissional sumiu sob trava: não deve ocorrer) → `profissional_indisponivel` com todos os índices.
- `decidirEncaixe` que devolva um número de flags diferente do de itens é erro de programação (lança).
- **Defeito corrigido em `inserirReservaDireta`** (`tests/support/reservas.ts`): falhava sempre com `Unknown argument salaoId` (no create aninhado de `itens` o `salaoId` vem da relação). Removida a linha; assinatura e comportamento inalterados para T-6/T-12/política. Os testes da T-5 usam também `ocupar` (`apoio-itens.ts`, comando único com CTE).

### Posse estendida pelo líder
- `tests/support/reservas.ts` passa à T-5 (a T-2 terminou). Mudança: só a correção acima. Teste novo `tests/integration/reservas/suporte.test.ts` (padrão e sobrescritas de `inserirReservaDireta`, duração inválida recusada sem gravar, `ocupar`), todos com `conferirDerivados`: 4/4. Suíte da T-5 depois da correção (`tests/integration/reservas/*.test.ts` + `protecao/futuras*.test.ts`): 15 arquivos, 124/124; nenhuma ocorrência de `Unknown argument salaoId` em `reservas/alteracao`, `reservas/equipe` e `politica/reservas.test.ts`.

### Pendências (fora da posse da T-5)
- `tests/integration/protecao/{concorrencia,reserva-publica,pagina-limite}.test.ts` (posse da T-5 por diretório) testam pelo fluxo público (`reservarPelaPagina`, `tests/support/reserva-publica.ts`) e só voltam a verde quando a T-10 entregar o novo `EntradaReservaPublica`/`entradaPublica`: 21 vermelhos hoje, nenhum por causa da criação. O CA-15 já está coberto sem o fluxo público em `protecao/futuras.test.ts`. Sugestão: a T-10 ajusta esses três arquivos (ou o líder me reaciona depois dela).
- Quebrados até as tarefas donas (R-1): `src/server/reservas/{remarcar,alteracao-comum,alterar-status}.ts` (T-6: `montarItens` e decisor novos), `reserva-equipe.ts`/`reservas-equipe.acao.ts`/`src/app/painel/agenda/nova/**`/`src/app/dev/reserva-nova/**` (T-12/T-13), `src/server/reserva-publica/servico.ts` (T-10).


## T-6 — Operações por item e permissões (23/11/2026)

### Arquivos
- `src/server/repos/reserva-alteracao.ts` (reescrito; com `repos/reserva.ts`, o ÚNICO escritor de `reserva_item`): `travarParaAlterar` (FOR UPDATE OF r; devolve `status`, `revisao`, `canceladaEm`), `travarCliente` (FOR KEY SHARE, inalterado), `lerItens` (1 comando, por (inicio, id), sem trava própria), `atualizarItem(ctx, reservaId, itemId, d)` (literal `status = 'confirmado'` no WHERE; pode lançar 23P01), `atualizarStatusDosItens` (UM UPDATE com `id = ANY` e `status = ANY(de)`; `revisao` null = não mexe), `gravarDerivados`. Saíram `atualizarPosicao`, `atualizarStatus`, `substituirItens`.
- `src/server/reservas/tipos-alteracao.ts`: contratos do §3.6 (`EntradaRemarcarItem`, `EntradaItem`, `EntradaMarcarStatusItem`, `EntradaCancelarTodos`, `ResultadoRemarcarItem`, `ResultadoStatusItem`, `ResultadoCancelarTodos`, `DependenciasAlteracao`) e `MENSAGENS_ALTERACAO` com os textos de recusa do web-design §5.10.
- `src/server/reservas/alteracao-comum.ts`: `localizarItem` (404 uniforme para reserva/item malformado, inexistente, de outro salão ou item de outra reserva; 403 pelo profissional DO ITEM), `localizarReservaParaCancelarTodos` (operação `reserva.cancelar_todos` antes de ler), `itemTravado` (reconfere item e permissão sob a trava da reserva), `aplicarPolitica`, `fecharAlteracao` (relê itens → `derivarReserva` → `gravarDerivados` → mensagens do evento → convite se o derivado PASSOU a `concluido` (RN-33) → `substituirNaoVigentes`).
- `src/server/reservas/remarcar.ts` (`remarcarItem`), `alterar-status.ts` (`alterarStatusDoItem`), `cancelar.ts` (`cancelarItem`), `marcar-status.ts` (`marcarStatusDoItem`), `cancelar-todos.ts` (novo, `cancelarTodos`), `reservas-status.acao.ts` (4 ações novas; as 3 antigas saíram).
- `src/server/reservas/status.ts` + teste: motivo `reserva_final` → `item_final`; novos `itensCancelaveis(itens, agora)` e `podeCancelarTodos(itens, agora)` (2+ canceláveis, regra do botão).
- `src/server/auth/permissoes.ts` + teste: operação `reserva.cancelar_todos` (`salao`/`negado`/`negado`).
- `src/server/repos/index.test.ts`: API nova do `RepoReservaAlteracao`.
- Testes de outras pastas sob posse: `tests/integration/politica/reservas.test.ts` (reescrito por item, + cancelar todos em salão somente leitura), `tests/integration/politica/varredura.test.ts` (4 ações novas), `tests/integration/avaliacoes/concorrencia.test.ts` (R-1 com `marcarStatusDoItem` + `conferirDerivados`; o caso determinístico da T-8 conferido, sem mudança).
- `tests/integration/reservas/alteracao/`: `apoio.ts` reescrito (independente do apoio da equipe: `criarCenario` com serviço C, `criarComItens`, `forcarStatus`, `mensagensDe` com `reservaItemId`); novos `{remarcar,cancelar,convite,permissoes,concorrencia,fuso}-itens.test.ts`; removidos `alteracao.test.ts`, `concorrencia.test.ts`, `fuso.test.ts` (API antiga, substituídos pelos novos).

### API para a T-13 (`src/server/reservas/reservas-status.acao.ts`)
```ts
remarcarItemAcao       // capacidade 'agendar'; { reservaId, itemId, hora, servicoId?, profissionalId?, data?, confirmarEncaixe? }
                       //   servicoId/profissionalId/data ausentes ou '' = manter os atuais do item
  → { resultado: 'atualizada'; itemId; revisao; encaixe; mensagem: { mensagemId; estado } }
  | { resultado: 'invalido'; erros: { servico?; inicio?; data? } }
  | { resultado: 'horario_indisponivel'; causa: '23P01' | 'entre_itens' }
  | { resultado: 'servico_indisponivel' } | { resultado: 'profissional_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] }
  | { resultado: 'recusado'; motivo: 'item_final' | 'transicao_invalida' | 'sem_alteracao' | 'data_diferente' | 'servico_repetido' }
cancelarItemAcao       // capacidade 'cancelar'; { reservaId, itemId }
marcarStatusDoItemAcao // capacidade 'cancelar'; { reservaId, itemId, destino: 'concluido' | 'nao_compareceu' }
  → { resultado: 'atualizada'; itemId; status; statusReserva; revisao; mensagens: { mensagemId; estado }[] }
  | { resultado: 'recusado'; motivo: 'transicao_invalida' | 'ainda_nao_iniciada' | 'ja_terminada' | 'item_final' }
cancelarTodosAcao      // capacidade 'cancelar' + operação reserva.cancelar_todos (profissional → 403); { reservaId }
  → { resultado: 'atualizada'; itemIds; revisao; statusReserva; mensagens } | { resultado: 'recusado'; motivo: 'nenhum_cancelavel' }
MENSAGENS_ALTERACAO.{item_final, data_diferente, servico_repetido, entre_itens, nenhum_cancelavel, ja_terminada, ainda_nao_iniciada, …}
podeCancelarTodos(itens, agora), itensCancelaveis(itens, agora)   // status.ts
```

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/reservas/alteracao/{remarcar,cancelar,convite,permissoes,concorrencia,fuso}-itens.test.ts tests/integration/politica tests/integration/avaliacoes` | 21 arquivos: 494 verdes, 1 vermelho (`politica/paginas.test.ts` "/painel/agenda", dependente da tela da T-13, já registrado pela T-8) |
| laço ×10 `tests/integration/reservas/alteracao/concorrencia-itens.test.ts` | 10/10 (9 testes por rodada) |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/reservas src/server/auth/permissoes.test.ts src/server/repos/index.test.ts tests/integration/reservas/alteracao/{fuso,remarcar,cancelar,convite}-itens.test.ts` | 14 arquivos, 230/230 nos dois |
| cobertura restrita aos arquivos de produção da T-6 | 98,41% linhas (sem linha descoberta em `reserva-alteracao.ts`, `alteracao-comum.ts`, `status.ts`, `permissoes.ts`; faltam só os `throw` de erro inesperado e a guarda de corrida "item mudou entre a prévia e a trava" em `remarcar.ts`) |
| `npx eslint --max-warnings=0` nos arquivos da T-6 | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-6 | vazio |

### Testes × CA
| CA | Teste |
|---|---|
| CA-21 | `concorrencia-itens.test.ts` "CA-21" (×10 dentro do teste, revisão +2, chaves diferentes, item de cada mensagem) |
| CA-25 | `remarcar-itens.test.ts` "CA-25" (Y idêntico campo a campo, revisão 1, `remarcacao` com `reservaItemId` de X, confirmação continua pendente) |
| CA-26 | `remarcar-itens.test.ts` "CA-26"; `fuso-itens.test.ts` (data local ≠ data UTC) |
| CA-27 | `cancelar-itens.test.ts` "CA-27" (inclui o horário de X voltando a `consultarDisponibilidadePorServico`) |
| CA-28 | `cancelar-itens.test.ts` "CA-28" (Y e Z cancelados, X concluído intacto, uma mensagem sem item, convite) |
| CA-29 | `cancelar-itens.test.ts` "CA-29" |
| CA-30 | `permissoes-itens.test.ts` (serviço e ação com sessão real: 403 no item alheio, na troca para outro profissional e em cancelar todos; 404 de outro salão, ids malformados e item de outra reserva) |
| CA-31 | `permissoes-itens.test.ts` "CA-31"; `politica/reservas.test.ts` (todas as situações somente leitura) |
| CA-38 (pelo fluxo) | `cancelar-itens.test.ts` "CA-38 + CA-39" |
| CA-42 | `permissoes-itens.test.ts` "CA-42" |
| CA-44 | `convite-itens.test.ts` (6 casos, inclusive cancelamento do último confirmado com item concluído e sem consentimento) |
| M-5 | `remarcar-itens.test.ts` "M-5" (serviço de item cancelado → `servico_repetido`, nada gravado) |
| M-6 | `remarcar-itens.test.ts` "RN-8/RN-9 entre itens" (`entre_itens`, nunca 23P01) |
| R-9/Q13 e §4.6 | `concorrencia-itens.test.ts` "ordem de travas" (cancelar/marcar/cancelar todos não esperam o profissional travado FOR UPDATE; remarcar espera o alvo; com a reserva travada, remarcar já segura profissionais e serviços e cancelar não segura nenhum dos dois) |
| R-2 | `conferirDerivados` em todos os arquivos novos |

### Desvios e riscos
- `atualizarItem` recebe também `reservaId` (escopo extra no WHERE).
- `ResultadoCancelarTodos.atualizada` ganhou `statusReserva` (a tela precisa do derivado, como em `ResultadoStatusItem`).
- `EntradaRemarcarItem`: `servicoId`, `profissionalId` e `data` ausentes ou vazios = manter os atuais (o profissional logado não precisa enviar o próprio id). Se o item mudou de serviço ou de profissional entre a leitura prévia e a trava e a entrada dependia do "manter", a remarcação é recusada com `transicao_invalida` (corrida rara; o usuário recarrega).
- Remarcar exige o vínculo do serviço com o profissional alvo mesmo sem trocar de serviço (comportamento da D-030); o serviço ATUAL inativo continua remarcável (snapshot mantido); só um serviço NOVO inativo é recusado.
- `MotivoRecusaDeStatus.reserva_final` virou `item_final` (todas as transições são por item). `src/app/painel/agenda/reservas/[id]/{acoes,estado,estado.test}.ts` e `src/app/dev/reserva-acoes/demonstracao.ts` (T-13) ainda usam a API antiga.
- `podeCancelarTodos` exige 2+ itens canceláveis (botão); a AÇÃO aceita 1+ (RN-24 só recusa com nenhum).

### Pendências
- `tests/integration/reservas/alteracao/paginas.test.ts` renderiza a página do detalhe e chama a casca `acoes.ts`: deve passar à **T-13** (como `agenda/paginas.test.ts`); não foi alterado e segue vermelho até a tela nova.
- `tests/integration/reservas/alteracao/paginas.test.ts` passou à T-13 (decisão do líder).
- `lerData`/`lerHora` continuam em `reserva-equipe.ts` (confirmado pela T-12); `criarDecisorDeEncaixe` vem de `decisor-encaixe.ts`.

### Posse estendida pelo líder: `src/server/repos/servico.ts`
- Removidos `RepoServico.travarParaReserva` (interface e implementação) e o tipo `ServicoTravado`, sem chamador em `src/`, `tests/`, `prisma/` e `e2e/`; comentário de `travarParaItens` ajustado (o motivo de ler os vínculos depois da trava passou para ele).

| Comando | Resultado |
|---|---|
| `npx vitest run src/server/repos/index.test.ts src/server/servicos tests/integration/repos tests/integration/servicos tests/integration/reservas/alteracao/{remarcar,cancelar,convite,permissoes,concorrencia,fuso}-itens.test.ts tests/integration/reservas/{itens,travas,criar}.test.ts` | 21 arquivos, 287/287 |
| `npx eslint --max-warnings=0 src/server/repos/servico.ts` | ok |
| `npx tsc --noEmit` filtrado por `repos/servico`, `reservas/remarcar`, `reservas/criar-reserva` | vazio |

## T-10 — Fluxo público (servidor) (23/11/2026)

### Arquivos
- `src/server/reserva-publica/tipos.ts`: `CODIGOS_AVISO` = `horario_indisponivel`, `servico_indisponivel`, `profissional_indisponivel`, `sem_selecao` (`sem_profissional` saiu); `MENSAGENS_PASSO` (textos exatos do web-design §5.3/§5.6/§5.7 como funções que recebem nomes e horas já formatados); `ItemEscolhido`, `ResumoConfirmacao` (§3.10), `EntradaReservaPublica` com `servicoIds` + `itens[{servicoId, profissionalId, inicio ISO}]` na ordem de `s`, `ResultadoReservaPublica` (`voltar` → `servicos` | `servico` + `indice`; novo `reescolher { itens }`), `ConsultaDaUrl`, `VisaoDoPasso` (`servicos`, `data`, `servico`, `dados`, `limitado`), `ReescolhaDosItens`/`ItemDaReescolha`.
- `src/server/reserva-publica/passos.ts` (puro): query `s`, `data`, `de`, `h0..h9` (`<profissionalId>_<isoUTC>`), `f`, `alterar`, `enviado`, `aviso`; `lerPasso` (passo válido mais avançado; o 1º `h<k>` ausente/inválido define o passo; `alterar=k` força o passo k com pré-seleção; `enviado=k` sem `h<k>` → `sem_selecao`; `h` repetido é inválido), `lerItem`/`lerItens`/`valorDoItem`, `lerSelecao` (POST de dados), `montarHref`, `camposOcultos` e os links `hrefAlterarItem`, `hrefFiltro`, `hrefOutroDia`, `hrefAlterarServicos`, `hrefSeguirSem`. Saíram `QUALQUER` e `lerProfissional`.
- `src/server/reserva-publica/pagina.ts`: `carregarPasso(ctx, passo, { servicos, equipe, regras, agora })` (novo campo `equipe`) com UMA consulta `consultarDisponibilidadePorServico` por passo (data: 14 dias sem escolhidos, dia oferecido se cada serviço tem horário; serviço k: `calcular: [s[k]]` + escolhidos = demais itens válidos; dados: todos os itens como escolhidos e todos os serviços calculados); helpers `itemEscolhido`, `porInicio`, `profissionaisComHorarios`, `comoEscolhidos`. `carregarPassoComLimite`: só o passo de serviços não consome cota.
- `src/server/reserva-publica/servico.ts`: `reservarPelaPagina` com N itens (`criarReserva({ itens, … })`), mesma ordem de proteção da D-027; resumo por início com profissional por item.
- `src/server/reserva-publica/reescolha.ts`: `reescolhaDosItens(slug, { s, data, itens }, agora, ip, { reabrir?, limitar? })` (substitui `horariosParaReescolha`/`profissionalDoHorario`).
- `src/server/repos/publico.ts`: `lerRotulosDaReserva(ctx, servicoIds, profissionalIds[])` → `{ fuso, servicos, profissionais }`.
- `tests/support/reserva-publica.ts`: `entradaPublica` no formato novo (atalho de um item com `profissionalId`/`inicio`), `itemPublico`.
- Testes: `src/server/reserva-publica/{passos,tipos}.test.ts`; `tests/integration/reserva-publica/{apoio,passos,fluxo-itens}.ts` (novos), `servico`, `concorrencia`, `pagina`, `acao`, `http` reescritos; `tests/integration/protecao/{concorrencia,reserva-publica,pagina-limite}.test.ts` no formato novo (status de reserva + itens coerentes no CA-2).

### Contrato para a T-11
- Página: `carregarPassoComLimite(ctx, lerPasso(consulta, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora, ip })`.
- Passo `servico`: GET com `camposOcultos(visao.consulta, visao.indice)` + rádios `name="h<indice>"`, `SlotGrid prefixoDoValor = "<profissionalId>_"` (valor = `valorDoItem`), `selecionadoInicial = visao.preSelecionado`; roteiro com `escolhidos` (link `hrefAlterarItem`), a parada em escolha (`alterando` → meta "alterando") e `pendentes`; filtro com `opcoesDeFiltro` (2+) e `hrefFiltro(base, consulta, id|null, alterando ? indice : null)`; `vazio` `calendario`/`conflito`; `aviso` + `horarioPerdidoIso` (`MENSAGENS_PASSO.horarioPerdido`); botão `proximoEhDados ? continuarParaDados : continuar`; navegação `hrefOutroDia`, `hrefAlterarServicos`.
- Passo `dados`: POST com `camposOcultos(visao.consulta)` (sem índice: s, data e todos os `h<k>`); a casca lê com `lerSelecao(params do FormData)` e monta `EntradaReservaPublica.itens[k] = { servicoId: s[k], profissionalId, inicio: inicio.toISOString() }`.
- Resultado `reescolher`: chamar `reescolhaDosItens(slug, { s, data, itens }, agora, ip)` e devolver no estado (sem redirecionar); `null` → voltar aos serviços com `servico_indisponivel`; `sem_queda` → dados com `MENSAGENS_PASSO.reescolhaSemQueda`; `limitado` → `MENSAGENS_PROTECAO.limitado`. O reenvio da reescolha manda `reabrir` (índices dos itens abertos); com erro de campo, a casca recalcula com `{ reabrir }` (o item continua aberto, `caiu: false`, `preSelecionado` = escolha nova). Links "Escolher outro dia"/"Seguir sem X" com `consulta` do resultado.
- `voltar`: `servicos` → `montarHref(base, { aviso })`; `servico` → `montarHref(base, { s, data, h (sem o item do índice), aviso })` (o passo do índice abre pelo 1º `h` ausente). `slug_mudou` → mesmo destino com `s`, `data`, `h<k>`.
- `tests/integration/reserva-publica/acao.test.ts` já descreve esse contrato da casca (FormData `slug`, `s`, `data`, `h<k>`, `reabrir`; estado com `reescolha: ReescolhaDosItens`); `pagina-limite.test.ts` espera `name="h0"` e o valor `<profissionalId>_<iso>` na página.

### Comandos
| Comando | Resultado |
|---|---|
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/reserva-publica tests/integration/reserva-publica/{passos,fluxo-itens,servico}.test.ts` | 101/101 nos dois (antes do `tipos.test.ts`) |
| `npx vitest run --project unit src/server/reserva-publica` | 4 arquivos, 48/48 |
| `npx vitest run --project integration tests/integration/reserva-publica/{servico,passos,fluxo-itens,concorrencia,pagina}.test.ts tests/integration/protecao` | verdes, exceto os 2 testes de HTML de `protecao/pagina-limite.test.ts` (dependem da T-11) |
| `tests/integration/reserva-publica/acao.test.ts` | 10 vermelhos: a casca `acoes.ts`/`estado.ts`/`formulario.ts` ainda é a antiga (T-11) |
| laço ×10 `reserva-publica/concorrencia.test.ts` + `protecao/concorrencia.test.ts` | 10/10 (13 testes por rodada) |
| cobertura só de `src/server/reserva-publica/**` (relatório em diretório próprio) | 95,95% linhas antes do `tipos.test.ts` (tipos.ts era o único abaixo); pagina.ts e passos.ts 100% |
| `npx eslint --max-warnings=0` nos arquivos da T-10 | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-10 | vazio, exceto `acao.test.ts` (tipo de `EstadoReserva.reescolha`, T-11) |

`http.test.ts` (sobe `next start`) não foi executado: depende de build com a UI da T-11. Playwright não executado.

### Testes × CA
- CA-6 (servidor): `servico.test.ts` ("3 itens em 3 profissionais"), `fluxo-itens.test.ts` (percurso completo por GET + POST).
- CA-8: `passos.test.ts` (unidade: inválidos, repetidos, 11+, fora de ordem) e `tests/integration/reserva-publica/passos.test.ts` (outro salão, item de outra data/fora da grade/fora da jornada, profissional de outro salão sem vazar nome/id).
- CA-9: "Alterar" em `passos.test.ts` (integração) e em `fluxo-itens.test.ts`; os horários descontam os outros itens.
- CA-10: `fluxo-itens.test.ts` (item B tomado; 23P01 depois da revalidação; dois itens caem; `reabrir`; `sem_queda`/`null`/`limitado`); `acao.test.ts` (casca, T-11).
- CA-4/RN-10 e C3 pelo fluxo: `passos.test.ts` (integração).
- CA-5/CA-7 forjados, CA-14, CA-50: `servico.test.ts`. CA-11: `concorrencia.test.ts` (10× mesma chave com 3 itens). CA-16: `protecao/reserva-publica.test.ts`.

### Desvios e riscos
- Passo de dados: a consulta NÃO usa `profissionalPorServico` (o §3.10 sugeria); calcula todos os serviços com todos os itens como escolhidos. Mesmas 6 instruções, e o resultado já serve para montar o passo do primeiro item que caiu sem segunda consulta; `conferirItens` não é chamado ali (o serviço k é calculado com os demais como ocupação, o que já cobre RN-8/RN-9 e a data única). A revalidação definitiva continua em `criarReserva`.
- No passo de um serviço, item de outro serviço cujo profissional não está na equipe ativa conta como pendente (não ocupa nada e não aparece no roteiro); o passo de dados o devolve com `profissional_indisponivel`.
- `reescolhaDosItens` faz uma segunda consulta só quando 2+ itens estão abertos (alternativas descontam apenas os mantidos); consome uma unidade de `disponibilidade` por chamada, como a reescolha da D-036. Ganhou `reabrir` (reenvio com erro de campo) e `ItemDaReescolha.caiu`/`preSelecionado`, não previstos no §3.10.
- `ResultadoReservaPublica.voltar` com `profissional_indisponivel` aponta o menor índice que falhou; o 23P01 vira `reescolher` com `itens: []` (a reescolha recalcula).
- Erro geral de forma passou de `erros.servicos`/`erros.inicio` para `erros.itens` (+ `porItem[k].inicio`), como `ErrosReserva` da T-5.

### Pendências
- T-11: `src/app/(publico)/[slug]/{acoes,estado,formulario,page}.ts(x)`, `_componentes/{Passos,PaginaDoSalao}.tsx` e `src/app/dev/reserva/**` não compilam com o contrato novo (`QUALQUER`, `lerProfissional`, `horariosParaReescolha`, `profissionalDoHorario`, `equipe` em `carregarPassoComLimite`). Os vermelhos de `acao.test.ts` e os 2 de `protecao/pagina-limite.test.ts` fecham com ela.

## T-12 — Nova reserva da equipe (23/11/2026)

### Arquivos
- `src/server/reservas/reserva-equipe.ts` (reescrito, §3.11): `criarReservaDaEquipe(ctx, e, agora, deps?)` → `ResultadoReservaEquipe`. Ordem: `exigirPermissao('reserva.criar')` → para cada profissional distinto não vazio das linhas: malformado ou de outro salão = `NaoEncontrado` (todos conferidos antes) → papel profissional com item de outro = `AcessoNegado` (CA-24, antes de qualquer validação ou escrita) → `validarFormularioDaEquipe` (puro) → fuso → `criarReserva` em `modo: 'encaixe'` com `consentimentoOpcional` e `decidirEncaixe = criarDecisorDeEncaixe(confirmou)` de `decisor-encaixe.ts` (o decisor local antigo saiu). Novos exportados puros: `validarFormularioDaEquipe` (1..10 linhas, data, serviço/profissional/hora por linha, "Este serviço já está no Serviço n", nome/telefone), `errosDeSobreposicao` ("Este horário se sobrepõe ao Serviço j (nome, hh:mm–hh:mm)." pelo `format.ts`), `MENSAGENS_FORMULARIO_EQUIPE`, `MAXIMO_ITENS_EQUIPE`, tipos `ErrosReservaEquipe` (= `ErrosReserva` + `data`) e `ResultadoReservaEquipe`. `lerData`/`lerHora` mantidos (usados por `pre-preenchimento.ts`, `dev/reserva-acoes` e `remarcar.ts`).
- `src/server/reservas/reservas-equipe.acao.ts`: tipo do resultado → `ResultadoReservaEquipe`.
- `src/app/painel/agenda/nova/`: `estado.ts` (reescrito: `ValoresReservaManual` com `data` + `itens[]`; estado com `erros` gerais, `errosPorLinha`, `encaixe: MotivosDoItem[]`, `criada.itens` (ISO, formatados no componente com o fuso), `statusLinha`, `foco`; `lerFormularioReservaManual` lê `itens`, `item-<n>-servico|profissional|hora` e `linha`; `aplicarLinha`; `paraEstado`), `acoes.ts` (`linha` presente → `aplicarLinha`, sem chamar o serviço), `FormularioReservaManual.tsx` (botão padrão oculto como 1º filho (C5), Data uma vez com a ajuda, ajuda das linhas, N `LinhaDeItem`, "Adicionar outro serviço" (some com 10), `role="status"` antes da Data, aviso de encaixe com a lista "Serviço n — serviço com profissional às hh:mm: motivos." e UMA caixa "Confirmo o encaixe destes serviços", resumo "Serviço n — Campo: texto" com links `#item-n-campo`, resultado com `RoteiroDoDia` compacto e "Reserva registrada com encaixe em n serviço(s)" com plural por regra; foco no resumo/aviso/resultado/legenda), `LinhaDeItem.tsx` (novo, §4.4), `NovaReserva.module.css` (linha em grade `1fr 10rem` só em ≥ 48rem, etiqueta "Encaixe" com tokens de aviso, foco da legenda), `page.tsx` (serviços com `nome`, `profissionalFixo` {id, nome}, `fuso`), `pre-preenchimento.ts` (data + 1ª linha). Testes: `estado.test.ts`, `FormularioReservaManual.test.tsx`, `pre-preenchimento.test.ts`.
- `src/app/dev/reserva-nova/`: `demonstracao.ts` (3 profissionais, 3 serviços; mesmas funções puras: `validarFormularioDaEquipe`, `conferirItens`, `detectarMotivos`, `errosDeSobreposicao`), `acoes.ts` (linhas por `aplicarLinha`), `page.tsx`, `vistas.ts` (novo: `?vista=encaixe|erros|criada`, 3 linhas; `?modo=profissional`). Testes: `demonstracao.test.ts`, `acoes.test.ts`, `page.test.tsx`.
- `tests/integration/reservas/equipe/`: `apoio.ts` (`linha`, `umaLinha`, `comTresProfissionais`, `itensGravados`), `equipe.test.ts` e `concorrencia.test.ts` adaptados, `paginas.test.ts` (FormData novo + bloco D-050), `itens.test.ts` (novo).

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project unit src/app/globals.test.ts src/components/conformidade.test.ts src/server/reservas src/app/painel/agenda/nova src/app/dev/reserva-nova src/lib/format.test.ts` | 17 arquivos, 376/376 |
| `npx vitest run --project integration tests/integration/reservas/equipe` | 4 arquivos, 54/54 |
| `npx vitest run --project integration tests/integration/reservas/estrutura.test.ts tests/integration/politica/varredura.test.ts` | 2 arquivos, 302/302 (guarda D-029: `src/app` não importa `criar-reserva`; ação com entrada vazia) |
| laço ×10 `reservas/equipe/{concorrencia,itens}.test.ts` | 10/10 |
| `TZ=UTC` e `TZ=America/Sao_Paulo` (unidade da T-12 + `tests/integration/reservas/equipe`) | 140/140 nos dois |
| cobertura só dos arquivos da T-12 | 99,64% linhas (`nova/page.tsx` 94%: o ramo `AcessoNegado`) |
| `npx eslint --max-warnings=0` nos arquivos da T-12 | ok |
| `npx tsc --noEmit` filtrado pelos arquivos da T-12 | vazio |

Playwright não foi executado (T-15).

### Testes × CA
- CA-23: `itens.test.ts` (3 itens em 3 profissionais, um fora da jornada: sem confirmar só o item 3 listado e `contarLinhas` igual; confirmando, `encaixe` só nele, `conferirDerivados`, 1 confirmação enfileirada; motivos em 2 itens), `paginas.test.ts` (casca: aviso e reenvio confirmado), `concorrencia.test.ts` (10 reservas de 3 itens disputando a Carla: exatamente 1, sem órfãos).
- CA-24: `itens.test.ts` (só itens próprios cria; com item de colega → `AcessoNegado` sem escrita, inclusive com o resto do formulário inválido; profissional de outro salão ou malformado → `NaoEncontrado`; pela ação com sessão real 403/200), `equipe.test.ts` (D-029 CA-4/CA-17 adaptados).
- CA-36 (componente): `FormularioReservaManual.test.tsx` (botão padrão oculto primeiro, sem `name`; envio implícito sem `linha`; "Adicionar"/"Remover" são `submit` com `linha`; "Adicionar" some com 10; "Remover" só com 2+; status e foco na legenda; resumo com links), `estado.test.ts` (`aplicarLinha` preserva tudo), `paginas.test.ts` (adicionar/remover pela casca sem sessão e sem gravar).
- RN-8 na equipe: `itens.test.ts` e `paginas.test.ts` (sobreposição → erro na hora da linha posterior; adjacentes aceitos).
- CA-50: `itens.test.ts` (serviço de outro salão numa linha → `servico_indisponivel`, nada em nenhum salão; mesma grade em dois salões não conflita).
- Critérios visuais 7, 23, 24 (componente), 25: `FormularioReservaManual.test.tsx`, `estado.test.ts` ("mesmo profissional" ausente).

### Desvios e riscos
- Linha sem profissional (gestor deixou "Escolha…") ou sem serviço é **erro de campo**, não 404: o design trata como 404 só id malformado/de outro salão; vazio é preenchimento.
- A sobreposição entre itens (`horario_indisponivel/entre_itens` de `criarReserva`) volta da equipe como `invalido` com o texto no campo hora da linha de maior índice (web-design §5.8). Para o nome e a duração do serviço citado há UMA leitura de `servicos.listar` só nesse caminho de falha. Por isso o tipo de retorno é `ResultadoReservaEquipe` (o `invalido` carrega também `data`), definido em `reserva-equipe.ts` sem tocar `tipos.ts` (T-5). `MENSAGENS_RESERVA_EQUIPE` de `tipos.ts` deixou de ser usado pela tela (os textos novos estão em `estado.ts` e `reserva-equipe.ts`).
- `profissional_indisponivel`/`horario_indisponivel` com índices viram erro na linha (`errosPorLinha`); sem índice (23P01), mensagem geral "Algum dos horários já está ocupado…".
- "Remover" tem `aria-label="Remover serviço n"` com texto visível "Remover" (o nome por texto oculto concatenava sem espaço em `dom-accessibility-api`).
- Adicionar linha também leva o foco à legenda da linha nova (com JS); o web-design só pedia no remover.
- O aviso de encaixe e a confirmação são limpos ao adicionar/remover linha (as linhas mudaram).
- `remarcar.ts` (T-6) importava o `criarDecisorDeEncaixe` antigo de `reserva-equipe.ts`; avisei o dev-t6 para usar o de `decisor-encaixe.ts`.

### Para a T-15 (E2E)
- `/dev/reserva-nova` (vitrine): uma linha por padrão; `?vista=encaixe` e `?vista=erros` com 3 linhas; `?vista=criada` com o roteiro; `?modo=profissional`. Cobrir: adicionar 2 linhas e remover a do meio sem JS preservando data, linhas, nome, telefone e consentimento (critério 23); "Adicionar" some com 10 linhas; Enter num campo de texto registra (critério 24: na vitrine sem dados válidos o resultado é o resumo de erros, nunca "Linha de serviço adicionada."/"removido"); aviso de encaixe com a lista e uma caixa (25); alvos ≥ 44 px em "Remover"/"Adicionar"; axe e sem rolagem horizontal em 375×812 nas vistas `encaixe`, `erros` e `criada`; teclado.
- Com banco (`/painel/agenda/nova`): reserva de 3 itens em 3 profissionais pelo gestor, com um fora da jornada (CA-23), e o profissional só com o seletor de serviço.

## T-11 — Fluxo público (UI) (23/11/2026)

### Arquivos
- `src/app/(publico)/[slug]/estado.ts`: `EstadoReserva.reescolha` passa a `ReescolhaNoEstado` (= `ReescolhaDosItens` com `resultado: 'reescolher'`).
- `src/app/(publico)/[slug]/formulario.ts` (puro): `parametrosDoFormulario`, `lerFormulario` (itens de `h<k>`; `h<k>` ausente/malformado vira item vazio que o serviço recusa), `lerReabrir`, `selecaoDaReescolha`, `destinoDoRedirecionamento` (`voltar` serviços/serviço k, `slug_mudou` com `s`, `data`, `h<k>`), `paraEstado` (erro geral = `erros.itens` ou `erros.chave`), `mensagemDaReescolha` (§5.6, hora no fuso do salão, `formatarLista`) e `comReescolha` (`reescolher`/`sem_queda`/`limitado` → estado). Saíram `lerSelecaoDoFormulario` e o `p`.
- `src/app/(publico)/[slug]/acoes.ts`: `reescolher` → `reescolhaDosItens(..., { reabrir })` na resposta, sem redirecionar (null → 303 aos serviços com `servico_indisponivel`); reenvio com `reabrir` e erro de campo recalcula a reescolha.
- `src/app/(publico)/[slug]/page.tsx`: `equipe` em `carregarPassoComLimite`; visão indisponível com `marcados: []`.
- `_componentes/Passos.tsx`: `PassoServicos` (texto novo, serviços marcados ao "Alterar serviços"), `PassoData` (s + data, texto de apoio, "Alterar serviços", sem "Alterar profissional"), novo `PassoServico` (indicador no `aria-describedby` do h2, roteiro com escolhidos + "Alterar", destaque "escolhendo agora"/"alterando", pendentes "a escolher", filtro, grades, vazio calendário/conflito, avisos §5.7, "Continuar"/"Continuar para seus dados", "Escolher outro dia"/"Alterar serviços"), `CabecalhoDados`, `Total`, `LinkAlterar` (visível "Alterar", nome acessível "Alterar Escova (09:00 com Ana)"), `GradesPorProfissional` (um `name` por serviço, `prefixoDoValor` = `<id>_`, quem não tem horário por último com "Sem horários livres neste dia.", pré-seleção pelo valor completo). Saíram `PassoProfissional`/`PassoHorario`/`ResumoDaSelecao` antigo.
- `_componentes/FiltroDeProfissional.tsx` (novo) + teste: `nav aria-label="Filtrar por profissional"`, pílulas, `aria-current="true"`.
- `_componentes/FormularioDados.tsx`: ocultos = `camposOcultos(visao.consulta)`; confirmação em `RoteiroDoDia` (início–fim, profissional por item, total, "Esta reserva já estava confirmada." na repetida, lembrete ND-4 com intervalo ≥ 30 min); reescolha (h2 com o serviço, Alert aviso focado, roteiro mantidos + destaque sem "Alterar", grades por item, bloco "Novo horário para X" com 2+, "Não há mais horários…" com "Escolher outro dia"/"Seguir sem X", campos `reabrir`); prop `estadoInicial` só para a vitrine. Continua com UM `useActionState`.
- `_componentes/PaginaDoSalao.tsx`: passo `servico` com aviso `horario_indisponivel`/`profissional_indisponivel` renderiza `FormularioDados` com `alternativa` (POST sem JS cai aí e o estado da ação assume, como na D-036); prop opcional `estadoInicial`.
- `_componentes/Salao.module.css`: indicador, link "Alterar" (44 px), pílulas, grades, total, bloco da reescolha; `.dias`/`.apoio` em 36rem só no `@media (min-width: 48rem)`. Só tokens.
- `src/app/dev/reserva/**`: exemplo do web-design (Escova/Hidratação/Manicure; Ana, Bia, Carla com jornadas próprias; grade 15 min; itens da cliente sem sobreposição); vistas `?vista=reescolha` (Hidratação 10:00 com Bia tomada, dados preservados), `?vista=confirmada`, `?vista=conflito`; `demonstrarReserva` com N itens.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run src/app/dev/reserva/ "src/app/(publico)/[slug]/"` | 13 arquivos, 99/99 (+ `FiltroDeProfissional.test.tsx` 1/1) |
| `npx vitest run src/app/globals.test.ts src/components/conformidade.test.ts` | 52/52 |
| `npx vitest run --project integration tests/integration/reserva-publica tests/integration/protecao` (sem `http`) | 12 arquivos, 123/123 (inclui `acao.test.ts` e os 2 de HTML de `pagina-limite.test.ts`, sem alteração nesses testes) |
| `http.test.ts` numa cópia em scratchpad (`next build` lá; removidos NA CÓPIA 5 testes da T-13 em andamento que quebravam o typecheck do build) | 3/3 |
| `npx tsc --noEmit` filtrado pelos meus arquivos | vazio |
| `npx eslint --max-warnings=0 "src/app/(publico)/[slug]" src/app/dev/reserva tests/integration/reserva-publica/acao.test.ts` | ok |
| Verificação visual (script Playwright avulso na cópia, porta 3917, `VITRINE_COMPONENTES=true`), 375×812 (toque) e 1280: serviços, dia, serviço 1/2/3, sem seleção, dados, alterar, filtro, reescolha, confirmada, conflito | `scrollWidth` = largura em todas; axe 0 violações em todas; "Alterar" com 44 px |

### Testes × CA / critérios
- CA-6/CA-9/CA-10 (UI): `PaginaDoSalao.test.tsx` (passos), `FormularioDados.test.tsx` (reescolha um/vários/sem horário/reaberto, confirmação), `formulario.test.ts`; casca em `tests/integration/reserva-publica/acao.test.ts` (T-10, sem mudança).
- Critérios visuais 7–14: `PaginaDoSalao.test.tsx` (sem "com o mesmo profissional"/"Sem preferência"/"Alterar profissional"; `aria-describedby`; um `name`; filtro com `aria-current`; nome acessível do "Alterar"; total sem duração; ordem de Tab do passo de dados). 11 (Fraunces/tabular no horário) vem do `RoteiroDoDia` da T-9. 15 (reescolha preserva dados, URL inalterada) na unidade; sem JS e 16 ficam para a T-15.

### Desvios e riscos
- `FormularioDados`/`PaginaDoSalao` ganharam `estadoInicial?` (só a vitrine passa), para mostrar reescolha/confirmação por `?vista=` sem banco.
- Na reescolha com UM item, o h3 do bloco é o nome de cada profissional (sem "Novo horário para X", que repetiria o h2); com 2+, h3 "Novo horário para X" e h4 por profissional.
- Na parada em escolha via "Alterar", a hora aparece como "—" (o horário atual está pré-selecionado na grade).
- A ação da vitrine não simula conflito no POST (a reescolha da vitrine é só a vista `?vista=reescolha`).

### Para a T-15
- Vitrine `/dev/reserva`: fluxo completo por GET (serviços → dia → serviço 1..3 → dados → "Alterar" → filtro) e vistas `reescolha`, `confirmada`, `conflito`; sem JS, teclado, axe, 375×812.
- Com banco: reescolha sem JS (POST com item tomado → aviso, dados preservados, URL igual, reenvio com `reabrir`), "Seguir sem X", confirmação sem JS (o GET cai no passo do item já reservado e o estado da ação assume), slug histórico 308.

## T-13 — Agenda e detalhe (UI) (23/11/2026)

### Arquivos
- Agenda (`src/app/painel/agenda/_componentes/`): `Eventos.tsx` (`EventoDoBloco`/`ConteudoDoBloco` por ITEM: horário, cliente, serviço, `rotuloDoStatusDoItem`, "Encaixe" e, só com `posicao`, "1 de 3" visível + "serviço 1 de 3 do agendamento" para leitor de tela; `hrefDoBloco` = detalhe + `#item-<id>`), `GradeDoDia.tsx` e `ListaDaSemana.tsx` (`coluna.blocos`; geometria e marca de falha D-043 inalteradas), `Agenda.module.css` (`.servicos`, `.resultado`, `.total`, `.nota`), novos `roteiro.ts` (puro: paradas do `RoteiroDoDia` a partir do `DetalheDaReserva`, hora local com 24:00 no fim, data por extenso, total, `idDoItem`, `ROTULO_DO_ROTEIRO`) e `TotalDaReserva.tsx`; `DetalheDaReserva.tsx` reescrito (dl Cliente/Telefone/Data/Situação/Origem; seção "Serviços" com a frase do ND-2 para o profissional e o roteiro — somente leitura por padrão ou a prop `roteiro` interativa; resultado do PRG `id="resultado"` com `tabIndex=-1`).
- Detalhe (`src/app/painel/agenda/reservas/[id]/`): `estado.ts` reescrito (PRG `?resultado=remarcado|cancelado|concluido|nao_compareceu|todos_cancelados` + `item`/`de`/`n` validados e `#resultado`; textos do web-design §5.10 montados com o item LIDO pela página; abertura por GET `lerAbertura` conferida contra itens visíveis e `acoes`; estados `EstadoRemarcar`/`EstadoDoItem`/`EstadoCancelarTodos` com `itemId`; textos das confirmações), `acoes.ts` (casca: `remarcarAcao`, `cancelarAcao`, `marcarAcao`, `cancelarTodosDaReservaAcao` sobre as 4 ações da T-6), novo `montagem.ts` (puro: props do roteiro interativo; opções de serviço sem os de outros itens, inclusive cancelados (M-5); data como texto com outro item não cancelado (RN-22)), `AcoesDaReserva.tsx` (cliente; 4 `useActionState` em ordem fixa remarcar → cancelar → marcar → cancelar todos; ações dentro de cada parada; formulário de remarcar e confirmação de cancelar sob a parada; "Cancelar todos" sob o total), `AcoesDaReserva.module.css` (independente do CSS da nova reserva), `page.tsx` (lê `agora` uma vez; `servicos`/`profissionais` só com o remarcar aberto; `key` do componente pela abertura).
- Vitrines: `src/app/dev/agenda/demonstracao.ts` (blocos por item; `demo-r9` = 3 serviços em Ana/Bia/Carla com "1 de 3" e falha; `demo-r2` com item cancelado em outra coluna; detalhe pelas mesmas funções puras), `src/app/dev/reserva-acoes/{demonstracao,acoes,page}.ts(x)` (autocontida, sem depender da vitrine da T-12; `?vista=futura|iniciada|profissional|cancelada`, `?remarcar=`, `?cancelar=`, `?cancelar=todos`, `?resultado=`; a vista viaja no id da reserva de exemplo), `src/app/dev/mensagens-reserva/page.tsx` (só comentário).
- Rótulo de mensagem (pedido do líder, sugestão da T-4): `src/server/mensagens/rotulos.ts` — `substituida` agora diz "… substituída/substituído por alteração posterior" (a substituição vem de remarcação, cancelamento de item ou "cancelar todos"); `obsoleta` inalterado.
- Testes: `_componentes/{VistaDaAgenda,DetalheDaReserva}.test.tsx` (reescritos), novo `_componentes/roteiro.test.ts`; `reservas/[id]/{AcoesDaReserva.test.tsx,estado.test.ts}` (reescritos), novo `montagem.test.ts`; `src/app/dev/agenda/page.test.tsx`, `src/app/dev/reserva-acoes/{page.test.tsx,acoes.test.ts,demonstracao.test.ts}`, `src/app/dev/mensagens-reserva/page.test.tsx`; `src/server/mensagens/rotulos.test.ts`; integração `tests/integration/agenda/paginas.test.ts` (status no masculino, href com âncora, data/hora do item), novo `tests/integration/agenda/d050-ui-paginas.test.ts`, `tests/integration/reservas/alteracao/paginas.test.ts` (reescrito por item), `tests/integration/mensagens/situacao-equipe.test.ts` (texto do rótulo). `tests/integration/agenda/fuso.test.ts` e o caso "/painel/agenda" de `tests/integration/politica/paginas.test.ts` passaram sem alteração.

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project unit src/app src/components src/server/mensagens src/server/agenda src/config` | 155 arquivos, 1186/1186 |
| `npx vitest run --project integration tests/integration/agenda tests/integration/reservas/alteracao/paginas.test.ts tests/integration/politica/paginas.test.ts tests/integration/mensagens tests/integration/lint` | 31 arquivos, 659/659 |
| `npx vitest run --project integration tests/integration/reservas/estrutura.test.ts tests/integration/auditoria/estatico.test.ts tests/integration/avaliacoes/paginas.test.ts` | 3 arquivos, 22/22 |
| `TZ=UTC` e `TZ=America/Sao_Paulo` com os testes de unidade da T-13 + `tests/integration/agenda/{fuso,d050-ui-paginas}.test.ts` | 12 arquivos, 103/103 nos dois |
| cobertura restrita aos arquivos da T-13 (`_componentes/**`, `agenda/page.tsx`, `reservas/**`, `dev/{agenda,reserva-acoes,mensagens-reserva}/**`, `mensagens/rotulos.ts`) | 99,6% linhas (98,8% instruções) |
| `npx tsc --noEmit` (repositório inteiro) | 0 erros |
| `npx eslint --max-warnings=0` nos arquivos da T-13 | ok |

### Testes × critérios
| Critério | Teste |
|---|---|
| 17 (3 blocos, status masculino, "n de 3" só gestor; profissional sem outros serviços) | `VistaDaAgenda.test.tsx` "reserva de 3 itens"; `d050-ui-paginas.test.ts` "gestor: 3 blocos" e "profissional: só o próprio bloco" |
| 18 (altura pela duração do item; falha em todos os blocos sem mudar a altura) | `VistaDaAgenda.test.tsx` "geometria" e "marca de falha"; `d050-ui-paginas.test.ts` "falha de mensagem vigente" (SSR, `height:` do estilo) |
| 19 (dl com Data, sem Profissional/Início/Fim; `id="item-<id>"`, hora, serviço, profissional, etiquetas) | `DetalheDaReserva.test.tsx`; `d050-ui-paginas.test.ts` "detalhe"; `alteracao/paginas.test.ts` |
| 20 (cancelado riscável, etiqueta não riscada, fora do total, nota) | `DetalheDaReserva.test.tsx` "item cancelado"; `roteiro.test.ts`; `d050-ui-paginas.test.ts` "item cancelado" |
| 21 ("Cancelar todos" só gestor e 2+, GET + POST, sem `<dialog>`) | `AcoesDaReserva.test.tsx` "Cancelar todos" e "?cancelar=todos"; `alteracao/paginas.test.ts` (gestor, profissional 403, PRG com `n`) |
| 22 (um único formulário de remarcar na parada; data como texto com outro item) | `AcoesDaReserva.test.tsx` "remarcar"; `alteracao/paginas.test.ts` "?remarcar=<item>" |
| CA-30 (403/404 uniformes nas cascas) | `alteracao/paginas.test.ts` "marcar antes do início … CA-30" |
| CA-33 (profissional só os próprios itens, frase ND-2, total dos seus serviços) | `DetalheDaReserva.test.tsx`; `d050-ui-paginas.test.ts`; `alteracao/paginas.test.ts` |

### Desvios e decisões
- Remarcar com sucesso faz PRG com `de=<HH:MM>` (hora anterior, do campo oculto `de`, validado por regex): a página só conhece a hora nova; `de` inválido some e o texto fica "Escova foi remarcado para …". Nome e hora do serviço nunca vêm da URL (vêm da leitura do item); id adulterado → texto genérico ("Serviço cancelado. …").
- PRG leva `#resultado`: o navegador põe o foco no resultado (alvo com `tabIndex=-1`), sem JavaScript.
- "Fechar" e "Manter serviço" voltam à página com `#item-<id>` (foco na parada); "Manter serviços" volta ao topo.
- Botões de situação: texto visível "Concluído"/"Não compareceu" e `aria-label` "Marcar {serviço} como …" (o visível está contido no nome). Links "Remarcar"/"Cancelar" com o serviço e a hora em texto oculto (espaço FORA do `span` oculto: o jsdom/dom-accessibility-api não soma o espaço interno).
- Profissional logado: o formulário de remarcar não envia `profissionalId` (vazio = manter, contrato da T-6). Como o DTO dele só tem os próprios itens, a data aparece como campo quando ele não tem outro item visível; se houver item de outra pessoa, a T-6 recusa com `data_diferente` (não dá para saber sem vazar, RN-37).
- Gestor: as opções de profissional são só os ativos; item de profissional inativo abre com o primeiro ativo selecionado (manter o inativo é recusado pela T-6).
- A vitrine `/dev/reserva-acoes` deixou de importar `@/app/dev/reserva-nova/demonstracao` (posse da T-12) e tem dados próprios; continua importando `lerData`/`lerHora` de `reserva-equipe.ts` (estáveis).
- `/dev/agenda` e `/dev/reserva-acoes` importam `totalDoDetalhe` de `@/server/agenda/consultar` (regra única do total; o import funciona no jsdom).

### Para a T-15 (E2E)
- `e2e/agenda*.spec.ts`: `/dev/agenda` (dia): `demo-r9` gera 3 blocos (Ana 11:00–11:30, Bia 11:30–12:10, Carla inativa 12:30–13:15) com "1 de 3"/"2 de 3"/"3 de 3"; links terminam em `#item-<id>`; status no masculino ("Confirmado"). Estender a geometria da D-043 (`e2e/mensagens-situacao.spec.ts`): `demo-r9` tem falha em todos os blocos; a altura deve ser duração × 0,1 rem com e sem a marca. Os blocos têm `data-item=<itemId>` para localizar.
- `e2e/reserva-acoes*.spec.ts` sobre `/dev/reserva-acoes`: sem JS e com teclado: `?remarcar=item-escova#remarcar` (um formulário, data como texto, "Fechar"), `?cancelar=item-manicure#cancelar`, `?cancelar=todos#cancelar-todos`, `?vista=iniciada` (botões "Concluído"/"Não compareceu" com nome "Marcar Escova como …"), `?vista=profissional` (frase, um item, sem "Cancelar todos"), `?vista=cancelada`; PRG → `?resultado=…#resultado` com o texto do item; alvos ≥ 2,75 rem; axe; `scrollWidth === 375` com `?remarcar=` aberto.
- `e2e/mensagens-situacao.spec.ts:63` espera "Convite de avaliação substituído por remarcação posterior": o texto passou a ser "… por alteração posterior".
- Com banco (seed da T-14): a reserva de 3 itens do salão A no dia e no detalhe; o profissional não vê "Escova"/"Manicure" quando só tem a Hidratação (critério 17).

### Correção DEF-1 (rodada 1 do tester): remarcar item de profissional inativo
- Causa: com o profissional atual inativo, o select do gestor não tinha opção `selected` e o navegador enviava a 1ª ativa; o item mudava de profissional sem aviso.
- UI: `montagem.ts` dá `profissionalInativo` (nome) e `valores.profissionalId = ''` quando o gestor remarca item de profissional inativo; `AcoesDaReserva.tsx` passa a `Select` `textoVazio="Escolha a profissional"` (opção vazia, selecionada) e ajuda "Atual: {nome} (inativo)."; com profissional ativo nada muda (sem opção vazia).
- Servidor (não confia no cliente): `remarcar.ts`, sob as travas, se o profissional pedido é "manter" (vazio ou ausente) e o atual está inativo → `invalido` com `erros.profissional = MENSAGENS_ALTERACAO.escolhaProfissional` ("Escolha a profissional."), antes de qualquer escrita. `ErrosRemarcacao` ganhou `profissional`. Enviar explicitamente o id inativo continua `profissional_indisponivel`. `estado.ts` mapeia `erros.profissional` para o campo; a vitrine `/dev/reserva-acoes` aplica a mesma regra (item da Carla).
- Testes: `AcoesDaReserva.test.tsx` (opção vazia selecionada, ajuda, envio vazio, erro e `aria-invalid` no campo; sem opção vazia com profissional ativo), `montagem.test.ts`, `estado.test.ts`, `dev/reserva-acoes/demonstracao.test.ts`; integração `tests/integration/reservas/alteracao/paginas.test.ts` "DEF-1" (HTML com `<option value="" selected="">Escolha a profissional</option>` e nenhum id selecionado; vazio e ausente → erro de campo; item idêntico ao de antes, `revisao` 0, mensagens inalteradas (só a `confirmacao`); escolhendo uma ativa, PRG normal).

| Comando | Resultado |
|---|---|
| `npx vitest run --project unit src/app src/components src/server/reservas src/server/agenda src/server/mensagens` | 159 arquivos, 1281/1281 |
| `npx vitest run --project integration tests/integration/reservas/alteracao tests/integration/agenda` | 16 arquivos, 151/152: o único vermelho é a sonda do tester `tester-d050.test.ts` "… move o item para a 1ª ativa", que afirma o comportamento DEFEITUOSO (linha 107: nenhuma opção selecionada) e passa a falhar com a correção; não editei o arquivo (posse do tester) |
| `npm run typecheck` | 0 erros |
| `npx eslint --max-warnings=0` nos arquivos alterados | ok |

## T-15 — Specs E2E (23/11/2026)

### Arquivos
- Suporte: `e2e/suporte/publico.ts` reescrito para o fluxo novo (sai `escolherProfissional`/`profissionaisOferecidos`/`escolherHorario`; entram `diaFuturo` (data civil de São Paulo por deslocamento, dia da semana, dias a evitar e `indice`), `linkDoDia`/`escolherDia(iso)`, `noPassoDoServico` (h2 = serviço e `toHaveAccessibleDescription("Serviço k de N")`), `radioDoHorario`/`escolherHorarioDe` (grade "Horários de X"), `instanteDoValor`, `paradasDoRoteiro` (`<ol aria-label="Seu dia">`), `tabAte` com foco visível em cada parada e `marcarComSetas`). `e2e/suporte/fixtures.ts` não foi alterado por mim (é o da T-14).
- Público com banco: `publico-reserva.spec.ts` (CA-6/CA-51 em /studio-aurora: Escova com Marcos 11:00, Hidratação com Beatriz 10:00, Manicure com Helena 15:00, ordem de escolha ≠ ordem de início, confirmação e banco item a item; CA-9: profissionais por serviço, filtro com `aria-current`, horários que cruzariam a Escova somem, "Alterar" com pré-seleção; sem JS: CA-13 com o exemplo em /e2e-reservas-7 e slug histórico 308 com a query intacta), `publico-reserva-teclado.spec.ts` (CA-12 + critérios 6, 14 e 16 em /e2e-reservas-2: só teclado, filtro por Tab+Enter, setas na grade, ordem de Tab do passo de dados), `publico-conflito-captcha.spec.ts` (CA-10 com JS em /e2e-reservas-3 e sem JS em /e2e-reservas-6: aviso nomeia o item, URL igual, dados preservados, nada gravado — nem cliente —, reescolha confirma 3 itens; "Seguir sem Hidratação" com Ana e Cris ocupadas o dia inteiro; CA-17 captcha), `publico-suspenso.spec.ts` (+ CA-14: URL forjada com `s`/`data`/`h0` não abre agendamento nem grava).
- Vitrines: `reserva-publica.spec.ts`/`reserva-publica-sem-js.spec.ts` (/dev/reserva: exemplo completo por teclado e sem JS, filtro, "Alterar", vistas `reescolha`/`confirmada`/`conflito` com axe e 375 px, critério 15, um `name` por serviço, alvos ≥ 44 px), `reserva-nova.spec.ts`/`reserva-nova-sem-js.spec.ts` (/dev/reserva-nova: 3 linhas pelo teclado, Enter num campo registra, aviso com a lista e uma caixa, adicionar 2 e remover a do meio sem JS preservando tudo, "Adicionar" some com 10 linhas, vistas `encaixe`/`erros`/`criada`; com banco CA-23/CA-32 em /e2e-reservas-8 pelo gestor: aviso só do item fora da jornada, nada gravado sem confirmar, `encaixe` só nesse item, 3 blocos na agenda com o mesmo detalhe e detalhe com 3 itens), `reserva-acoes.spec.ts`/`reserva-acoes-sem-js.spec.ts` (/dev/reserva-acoes por item: remarcar com um só formulário e data como texto, encaixe, erro, "Fechar"; cancelar item e "Cancelar todos" por GET + POST sem `<dialog>`; "Concluído"/"Não compareceu" por item; vista profissional e cancelada; alvos ≥ 44 px), `agenda.spec.ts`/`agenda-sem-js.spec.ts` (status do item no masculino, links com `#item-<id>`, demo-r9: 3 blocos nas colunas Ana/Bia/Carla com "n de 3", alturas 48/64/72 px = duração × 0,1 rem, detalhe com 3 paradas), `mensagens-situacao.spec.ts`/`-sem-js` (falha em 5 blocos, inclusive os 3 da demo-r9; geometria R-4 por `data-item`; texto "substituído por alteração posterior"), `a11y-base.spec.ts` (12 rádios).
- Fora da lista de posse do design, mas quebrados pelo fluxo novo (só `e2e/**`): `protecao.spec.ts` e `protecao-sem-js.spec.ts` (tirado o passo "Profissional").

### Comandos (numa cópia em scratchpad, `E2E_PORT=3961`, `E2E_DATABASE_URL=…/agenda_beleza_t15_e2e`, sem `.env`, `LANG=en_US.UTF-8`; uma execução de Playwright por vez)
| Comando | Resultado |
|---|---|
| `npm run test:e2e` (linha de base, antes da T-15) | 345 testes: 310 passaram, 35 falharam (todos pelo modelo antigo) |
| `npm run test:e2e` (build limpo: `.next` e `dist` apagados) | 60 specs, 373 testes, 373 passaram (1,4 min de Playwright; 1 min 51 s no total) |
| `npm run test:e2e` (segunda execução, estabilidade) | 373/373 (1 min 37 s no total) |
| `npx eslint --max-warnings=0 e2e` | ok |
| `npx tsc --noEmit` filtrado por `e2e/` | vazio |

Nenhum `test.skip`/`fixme`/`only` em `e2e/**`.

### Testes × CA / critérios
| CA / critério | Spec |
|---|---|
| CA-6, CA-51 | `publico-reserva.spec.ts` "CA-6/CA-51" |
| CA-9 (e CA-4 na UI) | `publico-reserva.spec.ts` "CA-9"; `reserva-publica-sem-js.spec.ts` |
| CA-10 | `publico-conflito-captcha.spec.ts` (com e sem JS, "Seguir sem") |
| CA-12 | `publico-reserva-teclado.spec.ts`; `reserva-publica.spec.ts` |
| CA-13 | `publico-reserva.spec.ts` "sem JavaScript"; `publico-conflito-captcha.spec.ts` sem JS; `reserva-publica-sem-js.spec.ts` |
| CA-14 | `publico-suspenso.spec.ts` |
| CA-23, CA-32 | `reserva-nova.spec.ts` "CA-23/CA-32 (com banco)" |
| CA-34 (falha em todos os blocos) | `mensagens-situacao*.spec.ts` |
| CA-36 | `reserva-nova*.spec.ts`, `reserva-acoes*.spec.ts` |
| Critérios 3 e 4 (375 px e axe) | todas as telas citadas: passos públicos, reescolha, confirmação, nova reserva com 3 linhas e com aviso, agenda dia/semana, detalhe com 3 itens e com `?remarcar=` |
| Critério 5 (≥ 44 px) | filtro e "Alterar" (`reserva-publica.spec.ts`), "Adicionar"/"Remover" (`reserva-nova.spec.ts`), ações por item e "Cancelar todos" (`reserva-acoes.spec.ts`) |
| Critério 6 (foco visível) | `tabAte` dos specs de teclado confere o contorno em cada parada |
| Critérios 7–10, 12–17, 19–25 | `publico-reserva*.spec.ts`, `reserva-publica*.spec.ts`, `agenda.spec.ts`, `reserva-acoes.spec.ts`, `reserva-nova*.spec.ts` |
| Critério 18 (altura e falha) | `agenda.spec.ts` (alturas) e `mensagens-situacao.spec.ts` (R-4 com e sem a marca) |

### Defeitos de produção
Nenhum encontrado.

### Desvios e pendências
- Com JavaScript, o PRG das ações por item é navegação do cliente: o `#resultado` rola, mas o foco não vai para ele (sem JS, a navegação por fragmento também não move o foco, pela especificação do HTML). O spec confere o texto em `#resultado` (`role="status"`), não o foco. Não tratei como defeito: o design não exige o foco ali.
- Critério 17 do lado da profissional (HTML sem "Escova"/"Manicure") e CA-24/CA-33 por login real de profissional ficaram na integração (`tests/integration/agenda/d050-ui-paginas.test.ts`, `tests/integration/reservas/equipe/itens.test.ts`); no E2E só a vista `?vista=profissional` da vitrine.
- Os specs com banco escolhem dias relativos a hoje (`diaFuturo`); em /studio-aurora usam terça a sexta a partir de 6 dias e evitam os dias 8 e 12 (bloqueios do seed), longe da r9 (dia 2).

## T-16 — Documentação (23/11/2026)

### Arquivos
- `CLAUDE.md`:
  - "Architectural invariants": "No double booking" cita `reserva_item_sem_sobreposicao` em `reserva_item` (a antiga não existe mais); "Multi-service bookings" substituído pelo modelo novo (item com profissional, horário e status próprios; mesma data local; itens da mesma reserva sem sobreposição; serviço uma vez por reserva; só profissionais vinculados àquele serviço; snapshot por item; derivados de `reserva`); "WhatsApp messages" com a confirmação consolidada e a revisão que sobe em remarcar item, cancelar item e cancelar todos.
  - "Project status": notas curtas "(superseded by D-050: …)" em D-004 (nome da exclusion), D-016 (`listarConfirmadasQueCruzam` sobre itens), D-018 (`consultaOcupacoes` sobre `reserva_item`; `consultarDisponibilidade`/`listarProfissionaisElegiveis` removidos), D-020 (`consultarDisponibilidadePorServico`), D-024 (substituição saiu de `registrarMensagem`; cancelamento sobe a revisão), D-025 (travas de N profissionais, `travarParaItens`, revalidação única), D-026 (query `h0..h9`/`f`/`alterar`/`enviado`), D-028 (bloco por item, margem de 1 dia, índice novo), D-029 (`encaixe` por item, decisão em lote), D-030 (operações por item; cancelamento sobe a revisão) e D-043 (rótulo "… por alteração posterior"). Novo parágrafo "D-050 (E3.6, issue #111)" no fim, antes de "`PLAN.md` (in Portuguese)…".
  - Tabela "Comandos e cobertura": 5 linhas novas logo depois de "Fuso da criação de reserva (D-025)": estabilidade dos itens, disponibilidade por serviço, mensagens por item, equipe e fluxo público com N itens, fuso dos itens.
- `PLAN.md`: linha 41 (fluxo público por serviço, mesma data, sem sobreposição; nota de revisão pela D-050), linha 44 (cada serviço com profissional, horário e status próprios; "cancelar todos" do gestor), modelos 1–3 de "Mensagens pelo WhatsApp" (confirmação consolidada; remarcação/cancelamento de um serviço ou de todos) e critério de aceite 2.
- `docs/trinks-alinhamento.md`: DT-9 riscado e revisado pela D-050 (constraint `reserva_item_sem_sobreposicao`); linhas "3. Profissional" e "4. Horário" da tabela §3.2.
- `docs/whatsapp-templates.md`: conferido, sem alteração (a T-4 já documentou o modelo `agenda_confirmacao_itens`, a ordem `salao, data, itens` e o risco R-3).
- `README.md` (edições pontuais; a linha do índice "Guia de testes locais", alteração local do usuário, ficou intacta; `docs/GUIA_TESTES_LOCAIS.md` não foi tocado). Trechos alterados:
  1. "Migrações": novo item sobre `20261127000000_reserva_item_autonomo` (guarda, `ACCESS EXCLUSIVE`, parar app e worker, `migrate resolve --rolled-back`, reversão manual com autorização).
  2. "Seed de demonstração", item "Salão A": acrescida a reserva futura de 3 serviços com 3 profissionais e a passada com um serviço concluído e outro cancelado.
  3. "Agenda da equipe": item "O que mostra" (bloco por serviço, "1 de 3" só do gestor, roteiro no detalhe, limite de 200 blocos) e item "Plano e volume" (índices de `reserva_item`, margem de 1 dia).
  4. "Reserva manual e encaixe": novo item "Vários serviços (D-050)"; item "Sobreposição" com `reserva_item_sem_sobreposicao`.
  5. "Remarcar, cancelar e marcar o resultado": parágrafo de abertura, novo item "Por serviço (D-050)", nota no item "Cancelar" e o laço de estabilidade/fuso trocado para `concorrencia-itens`/`fuso-itens` (os arquivos antigos não existem mais).
  6. "Mensagens de WhatsApp": itens "Tipos e chave" (revisão), "Como a reserva grava a mensagem" (`reservaItemId`, `substituirNaoVigentes`, `PREDICADO_VIGENTE`), "Envio" (parâmetros da confirmação consolidada) e o laço com `substituicao.test.ts`.
  7. "Criação de reserva": abertura, novo item "Entrada (D-050)", itens "Resultado", "O que grava", "Revalidação", "Conflito de horário", "Idempotência", "Ordem de travas", "Log" e "Estabilidade".
  8. "Página pública do salão e reserva": abertura, item "Fluxo" (passo por serviço e a query nova), item "Reserva" (reescolha na resposta da ação) e vistas novas de `/dev/reserva`.
  9. "WhatsApp Business Platform", passo 2: ordem `confirmacao` = `salao`, `data`, `itens` e o aviso de trocar o modelo na Meta antes de publicar (R-3).

### Comandos
| Comando | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/integracoes/documentacao.test.ts tests/integration/seed/seed.test.ts` (os dois que leem o README) | 2 arquivos, 41/41 |
| 1 rodada de cada laço novo do CLAUDE.md (conferir caminhos): itens (`reservas/{concorrencia,idempotencia,travas}` + `alteracao/concorrencia-itens`) | 4 arquivos, 37/37 |
| idem, disponibilidade (`plano`, `consultas`, `por-servico`) | 3 arquivos, 51/51 |
| idem, mensagens (`concorrencia`, `idempotencia`, `substituicao`) | 3 arquivos, 13/13 |
| idem, equipe/público (`equipe/{concorrencia,itens}`, `reserva-publica/concorrencia`, `protecao/concorrencia`) | 4 arquivos, 30/30 |
| linha "Fuso dos itens" em `TZ=UTC` e `TZ=America/Sao_Paulo` | 21 arquivos, 250/250 nos dois |
| fusos do README (`src/server/reservas` + `alteracao/fuso-itens`; `src/server/reservas` + `reservas/{fuso,itens}`) em `TZ=UTC` | 127/127 e 145/145 |
| `grep` por `reserva_sem_sobreposicao`, `consultarDisponibilidade`, `listarProfissionaisElegiveis`, "em sequência", "com um profissional" em README/CLAUDE/PLAN/trinks | só ocorrências históricas anotadas ou que citam a troca |

Os laços ×10 já foram executados pelas tarefas donas (T-3, T-4, T-5, T-6, T-10, T-12; ver as seções acima); aqui só uma rodada para validar os comandos documentados.

### Desvios e riscos
- O parágrafo D-043 dizia que "Cancelamento substituído…" era só de demonstração. Conferi `PREDICADO_VIGENTE`: item cancelado é final, então um `cancelamento` pendente continua vigente e o pipeline **ainda não** produz essa combinação. Mantive "demo-only" (com o rótulo novo) em vez de afirmar que passou a ser produzida.
- A edição do `CLAUDE.md` precisa da confirmação do líder (critério de conclusão da T-16).

## T-17 — Gate final (23/11/2026)

### Correção feita
- `tests/integration/admin/reenvio.test.ts` (D-045, fora da posse das tarefas) > "revisão superada → recusada/obsoleta": falhava na 1ª cobertura (`reenfileirada` em vez de `recusada/obsoleta`) porque ainda usava a regra antiga (`confirmacao` rev 0 obsoleta quando a reserva sobe para rev 1). Pela D-050 RN-30/R-4, a confirmação não compara revisão. Adaptado como a T-4 fez em `tests/integration/mensagens/reenvio.test.ts`: `remarcacao` rev 1 com o item remarcado para rev 2 → `recusada/obsoleta`, continua `falhou`, sem auditoria. As asserções são as mesmas. Nenhum código de produção alterado. `tests/integration/admin/`: 8 arquivos, 80/80.

### Gates
| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | passou (0 avisos) |
| Typecheck | `npm run typecheck` | passou |
| Build | `npm run build` (cópia em scratchpad, `.next`/`dist` apagados antes) | passou |
| Bundle node | `npm run build:node` (cópia) | passou |
| Cobertura (1ª) | `npm run test:coverage` | 7279/7280, 1 falha (acima) |
| Cobertura (2ª) | `npm run test:coverage` | 600 arquivos, 7280/7280; **linhas 99,04%** (statements 98,41%, branches 96,29%, functions 99,32%) |
| E2E | `npm run test:e2e -- --reporter=line` (cópia, sem `.env`, `E2E_PORT=3962`, `E2E_DATABASE_URL=…/agenda_beleza_t17_e2e`, `LANG=en_US.UTF-8`; uma execução de Playwright por vez, combinado com o tester) | 373/373 (1,9 min) |
| Laço itens ×10 | linha "Estabilidade dos itens da reserva (D-050)" do CLAUDE.md | 10/10 |
| Laço disponibilidade ×10 | linha "Disponibilidade por serviço (D-050)" | 10/10 |
| Laço mensagens ×10 | linha "Mensagens por item (D-050)" | 10/10 |
| Laço equipe/público ×10 | linha "Equipe e fluxo público com N itens (D-050)" | 10/10 |
| Fuso dos itens | linha "Fuso dos itens da reserva (D-050)", `TZ=UTC` e `TZ=America/Sao_Paulo` | 21 arquivos, 250/250 nos dois |
| Fuso do design §8 | `TZ=… npx vitest run src/domain/disponibilidade src/server/reservas src/server/mensagens src/server/reserva-publica` | 31 arquivos, 385/385 nos dois |
| Smoke Docker | `COMPOSE_PROJECT_NAME=t17smoke APP_PORT=3963 POSTGRES_PORT=5443 sh docker/smoke.sh` (na cópia) | OK (health 200, `referrer-policy` nas 3 rotas, sharp/WebP); depois `docker compose down -v` só do projeto `t17smoke`; o postgres do usuário (`agenda_beleza-postgres-1`) não foi tocado |

### Riscos
- O smoke reconstruiu a tag local `agenda-beleza:dev` (nome fixo no compose) a partir do working tree atual. Nenhum container do usuário usava essa imagem.

### Rodada final (depois da correção do DEF-1 e com os testes do tester)
A cópia foi ressincronizada e inclui `tests/integration/reservas/alteracao/tester-d050.test.ts` e `e2e/tester-d050.spec.ts`.

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | passou |
| Typecheck | `npm run typecheck` | passou |
| Build | `npm run build` (cópia, `.next`/`dist` apagados) | passou |
| Bundle node | `npm run build:node` (cópia) | passou |
| Cobertura | `npm run test:coverage` | 601 arquivos, 7290/7290; **linhas 99,04%** (statements 98,41%, branches 96,29%, functions 99,32%) |
| E2E | `npm run test:e2e -- --reporter=line` (cópia, sem `.env`, `E2E_PORT=3962`, `LANG=en_US.UTF-8`; fila liberada pelo tester) | 374/374 (1,7 min), inclui `e2e/tester-d050.spec.ts` |
| Laço itens ×10 | linha "Estabilidade dos itens da reserva (D-050)" | 10/10 |
| Fuso dos itens | `TZ=UTC` e `TZ=America/Sao_Paulo` | 21 arquivos, 250/250 nos dois |

Os laços de disponibilidade, mensagens e equipe/público e o smoke Docker não foram repetidos: a correção do DEF-1 só toca o formulário de remarcar e `remarcar.ts` (resultados da primeira rodada acima).
