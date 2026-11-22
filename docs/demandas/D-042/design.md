# D-042 (E6.5) Assinatura no painel — design

Entradas: `spec.md` (RN-1..12, CA-1..15), `web-design.md` (proposta visual). Código lido: `src/app/painel/assinatura/**`, `src/server/assinatura/**`, `repos/assinatura.ts`, porta/simulado/real do MP, `domain/assinatura/**`, `/dev/assinatura`.

## 1. Resumo e alternativas
Tela "extrato de conta" em `/painel/assinatura`, com leitura única (`lerTelaAssinatura`), duas ações novas (`cancelarAssinatura`, `regularizarAssinatura`) e a reutilização de `iniciarAssinatura` para "Assinar / Continuar / Assinar novamente". Cancelar chama o provedor FORA de transação e só então aplica `aplicarEventoAssinatura({tipo:'cancelamento'})`. Regularizar pede `urlAtualizarMeioPagamento` ao provedor (nova operação da porta) e redireciona.

Descartadas:
- Reutilizar `forcarErro('consultarAssinatura')` para a nova operação: ambíguo e quebra CA-13. Conflito com a spec §9 ("sem migração"): `sim_mp_operacao` é ENUM do PostgreSQL (`20261119000000_simuladores_integracao`), então a nova operação exige `ALTER TYPE … ADD VALUE` (migração mínima; DBA entra).
- Gravar o estado local antes do provedor: viola RN-2.
- `cancelamento` aplicado com `prazo` antes: não necessário (o estado efetivo já trata `cancelada` vencida); só `iniciarAssinatura` aplica `prazo` (RN-8).
- Alterar `aviso.ts`/`FaixaDoPlano`: mantidos (RN-12; frases da faixa já coerentes com a §5 do web-design; mexer quebraria testes da D-038 sem ganho). Decisão do item 10.5 do web-design: NÃO alinhar.

## 2. Componentes afetados
Servidor:
- `src/server/integrations/mercadopago/{port,simulado,real}.ts` (+ testes): `urlAtualizarMeioPagamento`.
- `src/server/repos/assinatura.ts`: `lerDetalhe`, `listarPagamentos`; `confirmarProvedor` aceita `provedorId: string | null`.
- `src/server/assinatura/iniciar.ts` (RN-8), novos `cancelar-tipos.ts`, `cancelar.ts`, `regularizar.ts`, `tela-tipos.ts`, `tela.ts`; `assinatura.acao.ts` ganha duas ações.
- Sem mudança: `aviso.ts`, `FaixaDoPlano`, `retorno/page.tsx`, `retorno.ts`, `servico.ts`, `maquina-estados.ts`.
Interface:
- `src/app/painel/assinatura/`: `page.tsx`, `acoes.ts` (casca), `estado.ts`, `textos.ts` (novo, texto por estado sem literais de data/valor), `TelaDaAssinatura.tsx` (client, ver §3.5), `SituacaoDaAssinatura.tsx`, `DadosDaAssinatura.tsx`, `AcoesDaAssinatura.tsx`, `ConfirmarCancelamento.tsx`, `HistoricoDePagamentos.tsx`, `LinkBotao.tsx`, `Assinatura.module.css`; `Resumo.tsx` removido; `FormularioAssinar.tsx` substituído pelas ações em `TelaDaAssinatura` (apagar com seu teste).
- `src/app/dev/assinatura/{page.tsx,acoes.ts,page.test.tsx}`: 9 estados.
- Testes: `e2e/assinatura.spec.ts`, `e2e/assinatura-sem-js.spec.ts` (estender).

## 3. Interfaces
### 3.1 Porta
`PortaMercadoPago.urlAtualizarMeioPagamento(id: string): Promise<string>`; `OPERACOES_MP` ganha `'urlAtualizarMeioPagamento'`. Simulado: `exigirId` → `falharSeForcado` → `buscarAssinatura` (inexistente → `RecursoNaoEncontradoNoProvedor`; `cancelada` → `OperacaoInvalidaNoProvedor`) → `` `${baseCheckout}?assinatura=${id}` `` (a página `/dev/mp-checkout` já mostra o estado). Real: `rejeitar` (`NaoImplementado('E6.6')`; é `ErroMercadoPago`? Não: tratar `NaoImplementado` também como indisponível, RN-3).

### 3.2 Repositório (`RepoAssinatura`)
```ts
lerDetalhe(ctx: ContextoEscopado): Promise<DetalheAssinatura>   // um comando, mesma ordem de lerEstadoBruto
type DetalheAssinatura = { fuso: string; suspensoManualEm: Date | null;
  assinatura: { id; estado: string; testeFimEm; periodoPagoAte; carenciaAte; acessoAte: Date | null; provedorAssinaturaId: string | null } | null }
listarPagamentos(ctx, limite: number): Promise<{ criadoEm: Date; valorCentavos: number; status: 'aprovado'|'recusado' }[]>
// todos os pagamentos do salão (JOIN assinatura por salao_id), ORDER BY criado_em DESC, id DESC LIMIT n; sem ids
confirmarProvedor(ctx, { id, provedorId: string | null })       // IS NOT DISTINCT FROM; FOR NO KEY UPDATE
```
`provedorAssinaturaId` NUNCA sai do servidor para a tela (fica no DTO de serviço interno do cancelar/regularizar, que o lê por `lerDetalhe`).

### 3.3 Serviços (sem `next/*`, sem `'use server'`)
`cancelar-tipos.ts` (client-safe):
```ts
type ResultadoCancelar =
 | { resultado: 'cancelada'; para: 'cancelada'|'encerrada'; acessoAte: Date|null; fuso: string }
 | { resultado: 'ja_cancelada'; acessoAte: Date|null; fuso: string }
 | { resultado: 'mudou' }                    // estadoVisto ≠ real, ou vínculo/estado mudou sob a trava
 | { resultado: 'provedor_indisponivel' }    // erro do provedor: nada alterado
 | { resultado: 'tente_novamente' }          // provedor cancelou, banco falhou (log assinatura.cancelar_pos_provedor_falhou)
 | { resultado: 'recusado'; motivo: 'estado' | 'manual' }
mensagemDeCancelar(r): { texto; variante }  // pura; data via formatarData(acessoAte, fuso)
```
`cancelarAssinatura(ctx, { estadoVisto?: EstadoAssinatura }, agora, deps?: { mp?, log? })` em `cancelar.ts`:
1. `lerDetalhe` (fora de transação). Sem assinatura → `recusado/estado`. `suspensoManualEm` → `recusado/manual`. Estado real `cancelada` → `ja_cancelada`; `encerrada` → `recusado/estado`. Estado ∉ {pendente, em_teste, ativa, em_carencia, suspensa} → `recusado`. `estadoVisto` (enum fechado, vindo de campo oculto da etapa 2; NÃO escolhe assinatura: o alvo é sempre a do `ctx`) presente e ≠ estado real → `mudou` sem chamar o provedor.
2. Se `provedorAssinaturaId !== null`: `mp.cancelarAssinatura(id)` FORA de transação. `ErroMercadoPago`/`NaoImplementado` (inclui `nao_encontrado`) → `provedor_indisponivel`, nada gravado.
3. `emTransacao`: `confirmarProvedor(ctx,{id, provedorId lido})` (trava `assinatura` `FOR NO KEY UPDATE`; `false` ⇒ `iniciarAssinatura` trocou o vínculo ⇒ `mudou`, e se havia provedor novo orfão a próxima consulta/webhook converge) → `aplicarEventoAssinatura(ctx,{tipo:'cancelamento'},agora,{r,assinaturaId})`. `aplicado` → `cancelada`; `sem_efeito` (webhook/outra aba já aplicou) → relê (`travar`) e devolve `ja_cancelada` (ou `recusado` se `encerrada`). Erro de banco: capturado FORA da transação, log só com `assinaturaId`, `tente_novamente`.
Sem `provedorAssinaturaId` (pendente sem checkout): pula o passo 2; o passo 3 com `provedorId: null` garante que nenhum vínculo surgiu entre a leitura e a trava.

Ordem de travas: nenhuma transação toma o `salao` aqui; só `assinatura` (→ `assinatura_transicao`), igual a webhook/retorno/job. Sem ciclo. Cancelar×cancelar: ambos chamam o provedor (idempotente), serializam na trava; o segundo vê `sem_efeito` → `ja_cancelada`, uma só transição. Cancelar×webhook×retorno: todos passam por `aplicarEventoAssinatura` sob a mesma trava; estados finais `cancelada`/`encerrada` coerentes (retorno que autoriza antes do cancelamento ⇒ `em_teste` → `cancelada`; depois ⇒ `teste_iniciado` ignorado).

`regularizar.ts`: `regularizarAssinatura(ctx, agora, deps?)` → `ResultadoRegularizar = { resultado: 'iniciada'; url: string } | { resultado:'teste_iniciado' } | { resultado:'provedor_indisponivel' } | { resultado:'recusado'; motivo:'estado'|'manual'|'sem_vinculo' } | …` (tipos em `cancelar-tipos.ts`? NÃO: em `regularizar-tipos.ts`, client-safe). `pendente` → delega a `iniciarAssinatura` (mapeia `iniciada.urlCheckout` → `url`). `ativa`/`em_carencia`/`suspensa` com vínculo → `mp.urlAtualizarMeioPagamento(id)` fora de transação, sem escrever nada (RN-7); erro → `provedor_indisponivel`. `em_teste`/`cancelada`/`encerrada`/`manual`/sem vínculo → `recusado`. A URL do provedor volta ao painel pelo retorno (D-040, só consulta).

`iniciar.ts` (RN-8): na transação T1, após `saloes.travar` e antes de `criarPendenteSeNaoHouver`: `const alvo = await r.assinaturas.travar(ctx,{})`; se `alvo?.estado === 'cancelada'` → `aplicarEventoAssinatura(ctx,{tipo:'prazo'},agora,{r,assinaturaId:alvo.id})` (se `acessoAte` já venceu, vira `encerrada`; senão `sem_efeito` e `ja_existe` segue). Ordem salão → assinatura mantida. Nenhuma chamada ao provedor na transação.

### 3.4 Leitura da tela (`tela.ts` / `tela-tipos.ts`)
`lerTelaAssinatura(ctx, agora): Promise<TelaAssinatura>` = `lerDetalhe` + `decidirEstadoEfetivo` (mesma função de `estadoEfetivoDoSalao`, sobre o mesmo instantâneo, sem segunda leitura) + `listarPagamentos(ctx,12)`.
```ts
type TelaAssinatura = { estado: SituacaoOperacional; estadoReal: EstadoAssinatura|null; fuso: string;
  datas: { testeFimEm?; periodoPagoAte?; carenciaAte?; acessoAte?: Date };      // só as do estado
  acoes: { primaria: 'assinar'|'continuar'|'regularizar'|'atualizar'|'assinar_novamente'|null; podeCancelar: boolean };
  pagamentos: { data: Date; valorCentavos: number; situacao: 'aprovado'|'recusado' }[] }
```
`acoes` por função pura `acoesDoEstado(efetivo, real)` (matriz RN-6/RN-7/§5; `manual`, `cancelada` ⇒ nada; `em_teste` ⇒ só cancelar). `manual` mostra histórico.

### 3.5 Ações e casca
`assinatura.acao.ts`: `cancelarAssinatura = defineAcao<{estadoVisto?:string}, ResultadoCancelar>({papeis:['gestor'],capacidade:'assinatura'}, …)`, `regularizarAssinatura = defineAcao<void, ResultadoRegularizar>(…)`. A entrada é validada (`estadoVisto` em lista fechada, qualquer outro valor ⇒ ignorado/`recusado`). `acoes.ts` (casca `'use server'`): `assinarAcao` (existente; também para "Assinar novamente"/"Continuar"), `regularizarAcao` (`redirect(url)` fora de try), `cancelarAcao` (converte para `EstadoAcaoAssinatura = { mensagem; variante: 'sucesso'|'info'|'erro' } | inicial`; `revalidatePath`). Erros 401/403 como hoje.

Conflito com a proposta visual: o `Alert` de resultado fica ACIMA do bloco de estado, mas o estado das ações vive nos formulários, abaixo. Solução: `TelaDaAssinatura` (client) contém os TRÊS `useActionState` em ordem fixa (assinar, regularizar, cancelar), renderiza o `Alert` (primeiro com mensagem; `rotulosVariante={{erro:'Erro de pagamento'}}`) e recebe `situacao`, `confirmacao` e `historico` como `ReactNode` (slots de componentes servidores). Funciona sem JS (estado na resposta do POST) e a releitura vem da própria renderização do servidor (RN-11). A etapa 1 é `LinkBotao` (`<a href="?cancelar=1">`, reutiliza classes de `Button.module.css`; `Button` não tem `href`). `?cancelar=1` em estado sem `podeCancelar` é ignorado. Etapa 2 envia `estadoVisto` em `<input type="hidden">`; sem JS, o POST volta à mesma URL e, se o erro for `provedor_indisponivel`, a etapa 2 continua visível. Textos por estado em `textos.ts`; datas só via `formatarData(d, fuso)`, valor via `formatarMoeda(PRECO_MENSAL_CENTAVOS)`, prazo via `DIAS_TESTE`.

## 4. Dados
Sem tabela, coluna ou índice novos. Única migração: `ALTER TYPE "sim_mp_operacao" ADD VALUE 'urlAtualizarMeioPagamento'` (sozinha no arquivo, como D-024) + enum em `prisma/schema.prisma` + lista esperada em `tests/integration/db/drift.test.ts:90`. **DBA: SIM** (parecer em `dba.md`: a migração, o drift, e confirmar que `listarPagamentos` (JOIN por `assinatura_id`, ordenação por `criado_em`, LIMIT 12) dispensa índice novo, dado `assinatura_pagamento_assinatura_id_idx`).

## 5. Infraestrutura
Sem variável, container ou CI novos (E2E usa `VITRINE_COMPONENTES=true` já ligada). **DevOps: NÃO** (justificativa: nenhum impacto). README: seção da assinatura (estados, ações) e nota de que a URL real do meio de pagamento é da E6.6 (T-8).

## 6. Invariantes
- Escopo por salão: tudo por `ctx.salaoId`; a tela não recebe id de assinatura; `estadoVisto` não seleciona alvo; provedor só é chamado com o vínculo da linha do salão. Teste de isolamento A (`em_teste`) × B (`ativa`) (CA-8).
- Exclusion constraint: não se aplica (sem `reserva`).
- UTC/fuso: datas em UTC no banco; exibição por `formatarData(d, fuso do salão)` (fuso vem de `lerDetalhe`); teste em `TZ=UTC` e `America/Sao_Paulo`.
- Adaptadores: nova operação na porta; nada de MP fora de `integracoes()`; real = `NaoImplementado('E6.6')`.
- Soft delete/anonimização: não se aplica (assinatura nunca é apagada; a encerrada fica no histórico).
- Salão suspenso somente leitura: capacidade `assinatura` permitida em qualquer estado (D-038); `manual` recusado no serviço.
- Idempotência: cancelar sem novo registro; mesma transição única sob a trava; webhooks inalterados.
- Auditoria do super admin: não se aplica (ação do gestor; a transição fica em `assinatura_transicao`, causa `cancelamento_gestor`).

## 7. Riscos e decisões
- R-1 Provedor cancela e o banco falha: `tente_novamente`, log `assinatura.cancelar_pos_provedor_falhou`; webhook/retorno convergem; cancelar é idempotente.
- R-2 `iniciarAssinatura` troca o vínculo entre a leitura do cancelar e a trava: tratado por `confirmarProvedor` com `null`/valor lido ⇒ `mudou`.
- R-3 Migração do ENUM em teste: `ADD VALUE` não roda dentro de transação com uso; arquivo isolado.
- R-4 Real não validado (E6.6); `urlAtualizarMeioPagamento` cobre só contrato e simulado.
- R-5 Mudança do contrato de `confirmarProvedor` afeta testes do D-040 (ajustar).
- R-6 Primeira exposição de `estadoVisto` é só dica de UX; recusa-se valor fora da lista.

## 8. Estratégia de testes
- Unitários: `acoesDoEstado`, `mensagemDeCancelar`, `textos.ts`, componentes (jsdom) por estado, CSS sem cor fora do `:root` (teste de conformidade existente), porta/simulado/real (`port.test.ts`, `real.test.ts`, `registry.test.ts`). CA-1, CA-11 (UI), CA-14 (dois fusos), CA-15 (estático).
- Integração (PostgreSQL real, `tests/integration/assinatura/`): `cancelar.test.ts` (CA-2, CA-3, CA-9, CA-11 por POST direto, §7 casos limite), `cancelar-concorrencia.test.ts` (CA-6; CA-7 ×10 com `pg_stat_activity` provando que não há chamada ao provedor dentro de transação), `cancelar-seguranca.test.ts` (CA-4 profissional 403 sem chamar provedor, CA-8), `regularizar.test.ts` (CA-9, CA-13), `tela.test.ts` (CA-1, CA-12, CA-14), `iniciar-nova.test.ts` (CA-10: `encerrada` e `cancelada` vencida), `repo-detalhe.test.ts`; `mp-simulado.test.ts` estendido.
- Playwright (sem banco, `/dev/assinatura`): `assinatura.spec.ts` (9 estados, teclado, axe 4.14.0 a 375×812, sem rolagem horizontal, etapa 1 sem POST) e `assinatura-sem-js.spec.ts` (CA-5). Capturas 375/768/1280 e verificação dos 13 critérios do web-design: pelo desenvolvedor, conferidas pelo tester.
- Cobertura ≥ 90%: todo arquivo novo em `src/` tem teste unitário ou de integração.

## 9. Tarefas
| T | Resp. | Dep. | Paralelo | Arquivos sob posse | Entregável / conclusão |
|---|---|---|---|---|---|
| T-1 | dba | — | com T-2, T-3 | `prisma/migrations/<ts>_sim_mp_operacao_url_atualizar/**`, `prisma/schema.prisma`, `tests/integration/db/drift.test.ts`, `docs/demandas/D-042/dba.md` | migração `ADD VALUE`, drift verde, parecer sobre índice |
| T-2 | desenvolvedor | T-1 (só para rodar integração) | com T-3 | `src/server/integrations/mercadopago/{port,simulado,real}.ts` e testes (`port.test.ts`, `real.test.ts`), `src/server/integrations/registry.test.ts`, `tests/integration/integracoes/{mp-simulado,documentacao}.test.ts` | §3.1; contrato, `forcarErro`, `nao_encontrado`, cancelada; testes verdes |
| T-3 | desenvolvedor | — | com T-1, T-2 | `src/server/repos/assinatura.ts`, `src/server/assinatura/{iniciar.ts,cancelar-tipos.ts,regularizar-tipos.ts,tela-tipos.ts}`, `tests/integration/assinatura/{repo-detalhe,iniciar-nova}.test.ts`, ajustes de `repo-iniciar.test.ts` | §3.2, RN-8 (CA-10), contratos client-safe publicados |
| T-4 | desenvolvedor | T-2, T-3 | não | `src/server/assinatura/{cancelar,regularizar,tela}.ts`, `src/server/assinatura/assinatura.acao.ts`, testes unitários dos três e `tests/integration/assinatura/{cancelar,cancelar-concorrencia,cancelar-seguranca,regularizar,tela}.test.ts` | CA-2..4, 6..9, 11..14; concorrência ×10 verde |
| T-5 | desenvolvedor | T-4 | não | `src/app/painel/assinatura/**` (exceto `retorno/`), testes de componente | tela completa, casca, 3 `useActionState` em ordem fixa, sem cor literal, um `@media (min-width: 48rem)`; CA-1, CA-5, CA-11 (UI) |
| T-6 | desenvolvedor | T-5 | não | `src/app/dev/assinatura/**`, `e2e/assinatura.spec.ts`, `e2e/assinatura-sem-js.spec.ts`, `src/config/navegacao.ts` só se faltar rota | vitrine de 9 estados (`?situacao=`, `?cancelar=1`, `?resultado=`, histórico 0/12), E2E com axe/teclado/sem JS, capturas |
| T-7 | tester | T-6 | não | `docs/demandas/D-042/testes.md` | veredito; confere 13 critérios visuais e cobertura |
| T-8 | desenvolvedor | T-6 | com T-7 | `README.md`, `CLAUDE.md` (resumo D-042) | docs |

Nenhum par paralelo (T-1/T-2/T-3) compartilha arquivos.
