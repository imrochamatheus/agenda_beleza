# D-040 (E6.1) Design: assinatura, início e teste após autorização

## 1. Resumo
Dois serviços em `src/server/assinatura/` sem `next/*`: `iniciarAssinatura` (T1 cria/reutiliza `pendente` → porta FORA de transação → T2 grava `provedor_assinatura_id` por compare-and-swap) e `consultarRetorno` (lê vigente sem trava → `consultarAssinatura` fora de transação → uma transação que confere o vínculo e chama `aplicarEventoAssinatura`). Uma ação (`defineAcao`) + casca `'use server'`; páginas mínimas `/painel/assinatura` e `/painel/assinatura/retorno`; vitrine `/dev/assinatura` para E2E sem banco.
Descartadas: (a) segurar transação durante a chamada à porta (viola RN-4); (b) `agora = autorizadaEm` no evento (distorce `ocorrida_em`); (c) coluna `referencia_externa`/URL de checkout (migração sem ganho: a referência é o `salaoId`); (d) restringir `sem_assinatura` (decisão do líder: D-038 e seed intactos); (e) PRG no retorno (o simulado precisa funcionar sem JS, D-3).
Web-designer dispensado: tela mínima com `src/components/ui/`; a tela completa é a E6.5.

## 2. Componentes
- `src/domain/assinatura/{tipos,maquina-estados}.ts` (+tests): `EventoDominio` `teste_iniciado` ganha `iniciadoEm?: Date`; `decidir` usa `testeFimEm = (ehData(ev.iniciadoEm) ? ev.iniciadoEm : agora) + DIAS_TESTE`. `ocorrida_em` da transição segue `agora`. Sem `iniciadoEm`, D-037 inalterada (D-1).
- `src/server/assinatura/tipos.ts`: `EventoAssinatura` `teste_iniciado` com `iniciadoEm?`; `servico.ts` `paraEventoDominio` repassa.
- `src/server/assinatura/iniciar-tipos.ts` (client-safe, mensagens pt-BR), `iniciar.ts`, `retorno.ts`, `assinatura.acao.ts` (`iniciarAssinatura = defineAcao({ papeis:['gestor'], capacidade:'assinatura' })`, handler fino).
- `src/server/repos/assinatura.ts` (novos métodos, ver §3).
- `src/app/painel/assinatura/{page.tsx,acoes.ts,FormularioAssinar.tsx}`, `src/app/painel/assinatura/retorno/page.tsx`; link do aviso `pendente` em `src/app/painel/_aviso/*` apontando a `ROTAS.assinatura`; `ROTAS.devAssinatura` em `src/config/navegacao.ts`; `/dev/assinatura` (404 sem `VITRINE_COMPONENTES=true`/`next dev`).

## 3. Interfaces
```ts
type ResultadoIniciar =
  | { resultado: 'iniciada'; urlCheckout: string }
  | { resultado: 'teste_iniciado' }                 // provedor já autorizado (RN-5)
  | { resultado: 'recusado'; motivo: 'ja_existe' }  // RN-3, sem chamar a porta
  | { resultado: 'provedor_indisponivel' }
  | { resultado: 'tente_novamente' };               // perdeu o CAS (corrida iniciar x iniciar)
iniciarAssinatura(ctx: ContextoEscopado, agora: Date, deps?: { mp?: PortaMercadoPago; appUrl?: string; log? }): Promise<ResultadoIniciar>
type ResultadoRetorno = 'teste_iniciado' | 'ja_em_teste' | 'aguardando' | 'cancelada_no_provedor'
  | 'sem_assinatura' | 'indisponivel' | 'vinculo_invalido' | 'neutro';
consultarRetorno(ctx, agora, deps?): Promise<ResultadoRetorno>   // nunca lança por erro do provedor
```
Novos métodos de `RepoAssinatura` (SQL bruto, `salao_id` só do contexto, `atualizado_em` = relógio injetado):
- `criarPendenteSeNaoHouver(ctx, agora)`: `INSERT … (salao_id, estado) VALUES (…,'pendente') ON CONFLICT (salao_id) WHERE estado <> 'encerrada' DO NOTHING`, nunca capturando 23505; sem linha em `assinatura_transicao` (RN-12: estado inicial não é transição; a tabela exige `de`; evita migração).
- `lerVigente(ctx)` → `{ id, estado, provedorAssinaturaId, emailGestor }` (e-mail de `usuario` do `ctx.usuarioId`, mesmo salão).
- `trocarProvedor(ctx, { id, de: string|null, para: string, agora })`: `UPDATE … SET provedor_assinatura_id = $para WHERE id AND salao_id AND estado='pendente' AND provedor_assinatura_id IS NOT DISTINCT FROM $de` → boolean (CAS).
- `confirmarProvedor(ctx, { id, provedorId })`: `SELECT … FOR NO KEY UPDATE` + confere o vínculo → boolean.

Fluxo `iniciar`: T1 (`emTransacao`): `saloes.travar` (NO KEY UPDATE) → `criarPendenteSeNaoHouver` → `lerVigente`; vigente ≠ `pendente` → `ja_existe`. Comita. Se `pendente` com provedor: `consultarAssinatura` (fora): `autorizada` → `consultarRetorno`-like (`teste_iniciado`); `pendente`/`cancelada`/não encontrada → segue. `criarAssinatura({salaoId, emailPagador, urlRetorno})` com `urlRetorno = new URL(ROTAS.assinaturaRetorno, APP_URL)` (normaliza barra/caminho). T2: `trocarProvedor` CAS; se `false` perdeu a corrida: cancelar o recém-criado (melhor esforço) e `tente_novamente`. Após CAS ok, cancelar o antigo (melhor esforço, log sem dado pessoal). Erro da porta (qualquer `ErroMercadoPago`) → `provedor_indisponivel`, linha mantida.
Fluxo `retorno`: ignora `searchParams`. `lerVigente` (sem trava); sem vigente ou sem provedor → `sem_assinatura`. `consultarAssinatura` (fora de transação); erro/`RecursoNaoEncontrado` → `indisponivel`. `p.salaoId !== ctx.salaoId` → `vinculo_invalido` sem evento. `pendente` → `aguardando`; `cancelada` → `cancelada_no_provedor`. `autorizada` → `emTransacao`: `confirmarProvedor` (false → `neutro`, provedor foi trocado) → `aplicarEventoAssinatura(ctx, { tipo:'teste_iniciado', iniciadoEm: p.autorizadaEm ?? agora }, agora, { r, assinaturaId })`. `aplicado`→`teste_iniciado`; `sem_efeito`→`ja_em_teste`; `ignorado/ocupada/sem_assinatura`→`neutro`. Valor ≠ `PRECO_MENSAL_CENTAVOS` → log `assinatura.valor_divergente` (só `assinaturaId`) e segue.
Ordem de trava: `salao` → `assinatura` (cabeçalho de `repos/servico.ts`); `aplicarEventoAssinatura` nunca toma `salao`; retorno x retorno e retorno x webhook (E6.2) serializam na trava da linha, `teste_iniciado` é idempotente (`sem_efeito`).
Páginas: `/painel/assinatura` via `exigirAcessoAoPainel(ROTAS.assinatura, ['gestor'], …)`; mostra estado (`estadoEfetivoDoSalao`) e, só sem vigente ou `pendente`, formulário POST "Assinar" (shell `acoes.ts` converte o resultado; `iniciada` → `redirect(urlCheckout)`; sem JS funciona pelo POST nativo). `/painel/assinatura/retorno`: mesma guarda (401 → `/entrar?proximo=`), executa `consultarRetorno` na renderização (GET com efeito idempotente e derivado só do provedor) e mostra a mensagem, sem PRG (D-3). Datas via `src/lib/format.ts` no fuso do salão. Mensagens nunca incluem texto cru do provedor.

## 4. Dados
Sem migração: UNIQUE parcial de vigente e `provedor_assinatura_id` UNIQUE já existem; `ON CONFLICT` usa o índice parcial. **DBA dispensado**: nenhum DDL; as consultas novas usam índices existentes (`salao_id`) e o UNIQUE parcial. Reabrir o DBA se o desenvolvedor precisar de DDL. CA-4: teste de `information_schema.columns` com padrões revisados (`%cart%` com falso positivo conhecido tratado) e varredura de 13–19 dígitos em `webhook_evento.corpo`/logs; nenhuma coluna nova.

## 5. Infraestrutura
Sem variável nova (`APP_URL`, `MP_ADAPTER` existem). **DevOps dispensado**. README: seção Assinatura (fluxo simulado: `autorizar` do `/dev/mp-checkout`) e comando de estabilidade (T-5).

## 6. Invariantes
- Escopo por salão: `defineAcao` + `salaoId` da sessão em todo SQL; CA-5/CA-11 testam salão B intocado e `vinculo_invalido`.
- Exclusion anti-sobreposição, UTC/fuso, soft delete/anonimização, WhatsApp: não se aplicam (UTC: `testeFimEm = autorizadaEm + 30 d` exato; só exibição usa o fuso do salão).
- Adaptadores: só `integracoes().mercadoPago`; nenhum import de SDK. Dados de cartão: nenhuma coluna/campo (RN-10).
- Somente leitura do suspenso: capacidade `assinatura` vem da tabela D-038; não contornada.
- Idempotência: retorno repetido = `sem_efeito`; CAS no provedor; webhooks são E6.2. Auditoria do super admin: não se aplica.

## 7. Riscos
R-1 pendente órfã sem provedor: reutilizada (CA-6). R-2 assinatura antiga autorizada após a troca: cancelada no provedor; E6.2 resolve por `provedor_assinatura_id` e ignora desconhecidos. R-3 corrida iniciar x iniciar cria duas no provedor: CAS + cancelamento da perdedora + `tente_novamente`. R-4 GET com efeito no retorno: idempotente e sem entrada do navegador. R-5 cancelamento da antiga falha: só log. R-6 `ctx.usuarioId`/operação da matriz: confirmar nomes reais antes de codar.

## 8. Testes
Unidade: `decidir` com/sem `iniciadoEm`, mapeamento de retorno e URL de retorno (CA-3 parte, CA-6/7 com stubs). Integração (PostgreSQL real, MP simulado com `autorizar`/`forcarErro`): CA-1, 2, 3, 5, 6, 7, 8, 9 (10 paralelos), 10, 11, CA-4. Playwright sem banco em `/dev/assinatura`: CA-12 (teclado, sem JS, axe, "Assinar" condicional) e redirecionamento sem sessão. Cobertura ≥ 90% mantida por testes junto de cada módulo.

## 9. Tarefas
- T-1 (desenvolvedor, sem deps): D-1. Posse: `src/domain/assinatura/tipos.ts`, `maquina-estados.ts`(+test), `src/server/assinatura/tipos.ts`, `servico.ts` (só `paraEventoDominio`), `iniciar-tipos.ts`. Pronto: testes da máquina verdes, D-037 intacta.
- T-2 (desenvolvedor, ∥ T-1): repositório. Posse: `src/server/repos/assinatura.ts`, `tests/integration/assinatura/repo-iniciar.test.ts`. Pronto: 4 métodos testados, CAS e sem 23505.
- T-3 (desenvolvedor, após T-1, T-2): `iniciar.ts`, `retorno.ts`, `assinatura.acao.ts` + unitários e `tests/integration/assinatura/{iniciar,retorno,concorrencia,seguranca}.test.ts` (CA-1–3, 5–11, CA-4).
- T-4 (desenvolvedor, após T-3): páginas, shell, `FormularioAssinar`, vitrine `/dev/assinatura`, `src/app/painel/_aviso/*`, `src/config/navegacao.ts`, `e2e/assinatura*.spec.ts` (CA-12). 
- T-5 (desenvolvedor, após T-4): README e CLAUDE.md (seção Assinatura, comando de estabilidade `for i in $(seq 10)…concorrencia.test.ts`), gate completo (lint, typecheck, build, cobertura, E2E).
T-1 ∥ T-2 (arquivos disjuntos); demais em série.
