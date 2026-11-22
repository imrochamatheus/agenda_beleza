# D-038 (E6.4) Somente leitura e página indisponível — design

## 1. Resumo e alternativas descartadas
Uma única política real, `src/server/assinatura/politica-operacao.ts`, lê `estadoEfetivoDoSalao(ctx, agora)` (D-037) e responde `estado.capacidades[capacidadeOperacional]` (a tabela `TABELA_CAPACIDADES` é a única fonte). Ela substitui `permitirTudo` em `defineAcao`, em `criarReserva` (inclui contexto público/sistema) e em `alteracao-comum.ts`. `agendamentoDisponivel` passa a derivar o critério assinatura/manual de `capacidades.agendar`. A faixa é um componente servidor dentro do `PanelLayout`.

Web-designer DISPENSADO: impacto visual mínimo (faixa com `Alert` existente de `src/components/ui` e o estado "agendamento indisponível" que a página pública já tem desde a D-026).

Descartados:
- `src/app/painel/layout.tsx` para a faixa: o layout não é re-renderizado em navegação suave entre páginas irmãs e o estado ficaria velho (RN-12). Vale o componente dentro do `PanelLayout`, renderizado por página.
- Editar as 31 páginas: o `PanelLayout` já é comum a todas.
- `FOR SHARE` em `assinatura`/`salao` na leitura da política: ver §3.2.
- Campo extra em `ResultadoAcao` para o motivo: quebraria o contrato exato do CA-2 (`{ok:false, erro:'acesso_negado', status:403}`).

## 2. Componentes afetados
- `src/server/tenant/politica.ts` (assinatura nova, mantém o tipo `DecisaoPolitica`; remove `permitirTudo` como padrão).
- `src/server/tenant/define-acao.ts` (passa `agora`; sem mudança de ordem).
- `src/server/assinatura/politica-operacao.ts` (NOVO), `src/server/assinatura/aviso.ts` (NOVO, função pura de texto), `src/server/assinatura/index`: sem barrel novo.
- `src/server/reservas/criar-reserva.ts`, `tipos.ts` (`PoliticaDeReserva`), `alteracao-comum.ts`, `tipos-alteracao.ts`.
- `src/server/reserva-publica/agendamento.ts`, `estado.ts` (derivação única).
- `src/components/layout/PanelLayout.tsx` (+ `AvisoDoPlano.tsx` async servidor, `FaixaDoPlano.tsx` apresentacional, módulo CSS).
- Vitrine sem banco: `src/app/dev/aviso-plano/page.tsx` (404 sem `VITRINE_COMPONENTES=true`), `ROTAS.devAvisoPlano`.
- README e CLAUDE.md (documentar a tabela e D-038).
- Nenhuma página do painel, ação `*.acao.ts` ou shell `acoes.ts` muda; `envio-http.ts` herda a política via a ação `configurar`.

## 3. Interfaces
### 3.1 Política
```ts
export type ContextoDePolitica = TenantContext | SistemaContext; // ContextoEscopado
export type PoliticaOperacao = (ctx: ContextoDePolitica, capacidade: Capacidade, agora: Date) => DecisaoPolitica | Promise<DecisaoPolitica>;
// politica-operacao.ts
export const politicaPorEstado: PoliticaOperacao;
export function decidirPolitica(estado: EstadoEfetivo, capacidade: Capacidade): DecisaoPolitica; // pura
```
- `Capacidade` (context.ts) e `CapacidadeOperacional` têm os mesmos 6 valores; `decidirPolitica` usa `Object.hasOwn(estado.capacidades, c)` e `=== true`. Capacidade desconhecida, ausente ou valor não booleano: negado (RN-3).
- Falha fechada: qualquer exceção de `estadoEfetivoDoSalao` (inclui `NaoEncontrado`) é capturada em `politicaPorEstado` e devolve `{permitido:false, motivo:'estado_ilegivel'}`; log `politica.estado_ilegivel` só com `salaoId`. Nunca 500.
- `politicaDeOperacao = politicaPorEstado`; o padrão em `politica.ts` fica importando de `assinatura/` (sem ciclo: `assinatura/politica-operacao.ts` importa só tipos de `tenant/politica`; o export fica em `tenant/politica.ts` via re-export de valor com import tardio ou, se houver ciclo, `define-acao.ts` importa direto de `assinatura/`). `permitirTudo` permanece exportado só para os testes de `define-acao`.
- `defineAcao`: `await politica(ctx, metadados.capacidade, agora)`; o `agora` é o mesmo de `resolverTenant` (já existe em `executar`).
- `criarReserva`: `politicaPadraoDeReserva = (ctx, cap, agora)` chama `politicaPorEstado` para os dois tipos de contexto; `agora` vem de `deps.agora` ou do relógio da função (verificar `DependenciasCriarReserva`; senão adicionar `agora?`). Negado: tenant lança `AcessoNegado`, sistema devolve `salao_indisponivel` (como hoje). A decisão continua ANTES da transação (linha 119).
- `alteracao-comum.aplicarPolitica` repassa `agora`.

### 3.2 Onde se lê o estado, sem deadlock
Uma leitura por camada: `lerEstadoBruto` já é UM comando (`salao LEFT JOIN LATERAL assinatura`), roda FORA de qualquer transação e SEM trava (snapshot do READ COMMITTED do comando). Motivo: a ordem canônica começa em `salao FOR NO KEY UPDATE`/`FOR SHARE`; a política executa antes de qualquer trava, então não segura nada e não participa de ciclo. `FOR SHARE` em `salao` bloquearia o `FOR NO KEY UPDATE` das regras/perfil e `FOR SHARE` em `assinatura` colidiria com o job de prazos e o webhook da D-037 (que travam `assinatura` depois do salão); ganho nenhum, pois a TOCTOU é aceita (spec §6). Sem índice novo: consulta por salão + `ORDER BY criado_em DESC, id DESC LIMIT 1` já existe.

Desvio declarado da RN-12: a ação de criar reserva e remarcar lê duas vezes (defineAcao + `criarReserva`/`aplicarPolitica`, para continuar seguro quando chamados diretamente pelos testes e por E4.2). Ambas usam o mesmo `agora`; aceito (1 comando barato). Ação típica de `configurar`/`cancelar` lê uma vez.

### 3.3 Recusa
Mantém `AcessoNegado` (403, `acesso_negado`, corpo constante); `motivo` interno `somente_leitura:<capacidade>:<estado>` só para log. Os shells existentes já mostram o texto de 403 (pt-BR); a razão fica na faixa do painel (RN-6), sem revelar estado interno a profissional. Nenhum campo novo no resultado.

### 3.4 `agendamentoDisponivel`
`EstadoAgendamento` ganha `agendar: boolean` (vindo de `estado.capacidades.agendar`) e perde o switch de estados; `estado.ts` chama `estadoEfetivoDoSalao(ctx, agora)` (aceita contexto público) e `listarServicosPublicos`. Motivo: `suspenso_manual` se `estado.motivo==='manual'`, senão `assinatura` se `!agendar`, senão `sem_servico` se 0 serviços. `lerEstadoDeAgendamento` em `repos/publico.ts` deixa de ser usado (remover se não houver outro consumidor; senão manter). Ordem de motivos inalterada.

### 3.5 Faixa
- Pura: `avisoDoPlano(estado: EstadoEfetivo, papel: PapelDeSalao, fuso: string): { tipo: 'info'|'aviso'|'erro'; texto: string } | null` em `assinatura/aviso.ts`. Textos exatamente os da RN-11; `{data}` = `formatarData(carenciaAte|acessoAte, fuso)` de `src/lib/format.ts`. Sem faixa em `em_teste`/`ativa`/`sem_assinatura`. Profissional: no suspensa/encerrada/manual troca "Entre em contato com o suporte" por "Fale com o gestor do salão"; pendente/carência/cancelada sem a frase de ação ("regularize...") para profissional (texto próprio: "O salão está com a assinatura pendente de regularização...").
- `AvisoDoPlano` (async servidor): `exigirContexto` falha (sem cookie, sem sessão) → `null` (vitrines `/dev/*` seguem sem banco: sem cookie não há consulta); com contexto, `estadoEfetivoDoSalao` + fuso do salão (leitura existente do repositório de salão) → `FaixaDoPlano` com `Alert` (`role="status"`, ícone/prefixo textual "Aviso:" além da cor). Falha de leitura → sem faixa (não derruba a página; o servidor continua recusando).
- `PanelLayout` renderiza `<AvisoDoPlano papel />` antes de `children` em `Estrutura`, com prop opcional `aviso?: ReactNode` que substitui (usada pela vitrine). Sem link "Assinatura" (E6.5).
- Controles de escrita: NÃO ocultar nem desabilitar nesta demanda (RN-6 livre ao arquiteto; decisão: só servidor + faixa, para não tocar 31 páginas e ficar fora da posse de outras demandas).

### 3.6 Página pública
Sem mudança de rota: `pagina.ts` já usa `decidirAgendamento`, omite o formulário e devolve 200. O trabalho é derivar do §3.4 e travar CA-R1 com teste (perfil, fotos, avaliações visíveis; sem formulário; contagem de `reserva` inalterada na action).

## 4. Dados
Sem migração, sem índice. DBA DISPENSADO: leitura existente, um comando, sem trava nova. Consulta por `salao_id` + `criado_em DESC` já atendida pelo índice da D-037.

## 5. Infraestrutura
Sem variável de ambiente, container ou CI novo. A vitrine `/dev/aviso-plano` entra no `webServer` já com `VITRINE_COMPONENTES=true`. DevOps DISPENSADO.

## 6. Invariantes
- Escopo por salão: política lê só o salão do contexto; teste com dois salões (A suspenso, B livre). Aplica-se.
- Exclusion constraint: intocada; a recusa vem antes das travas e do INSERT. Encaixe recusado por `agendar`.
- UTC/fuso: datas da faixa pelo fuso do salão via `format.ts`; `agora` sempre injetado; sem relógio implícito no domínio.
- Adaptadores: nenhum novo.
- Soft delete/anonimização: `lgpd` permitido em todos os estados; não alterado.
- Somente leitura do suspenso: é o objetivo. `cancelar` permitido e notifica: `cancelarReserva` continua gravando o outbox `cancelamento` e enfileirando após o commit; só `aplicarPolitica(ctx,'cancelar')` muda.
- Idempotência: sem mudança; recusa antes de gravar (chave de requisição não é consumida).
- Auditoria do super admin: `defineAcaoAdmin` fora da política (RN-9), teste de regressão.
- Webhooks: nada muda; mudança de estado por webhook vale na próxima chamada (sem cache entre requisições).
- Rota de fotos: `POST /api/painel/fotos` já executa a ação de fotos (`configurar`); com recusa o handler responde 303 `?envio=<código>` sem gravar objeto (o objeto só é gravado depois da política passar, ver `envio-http.ts`; o dev confirma e, se o código de recusa não existir na lista fechada, adiciona `acesso_negado`). Teste estático RN-5: nenhum `route.ts` de `/api/painel/**` importa repositório/armazenamento sem `defineAcao`.

## 7. Riscos e decisões
- R-1 custo: 1 comando por ação (2 em criar/remarcar). Aceito.
- R-2 faixa esquecida em página nova: está no `PanelLayout`; teste unitário garante que ele renderiza o componente e um teste estático que toda `page.tsx` de `src/app/painel` usa `PanelLayout`.
- R-3 predicados divergentes: eliminado por §3.4; teste de equivalência (tabela × `agendamentoDisponivel`) em todas as situações.
- R-4 testes antigos com `permitirTudo`/fábricas: fábricas usam `em_teste` ou sem linha (permitido); adaptar `politica.test.ts` e `define-acao.test.ts` à nova assinatura.
- R-5 TOCTOU: aceito e documentado (reserva em curso pode concluir).
- R-6 ciclo de import `tenant/politica` ↔ `assinatura/politica-operacao`: evitar mantendo `politica.ts` só com tipos; `define-acao.ts` e `alteracao-comum.ts` importam `politicaDeOperacao` de `assinatura/politica-operacao.ts` (nova posição do export). Atualizar `no-restricted-imports`/lint se houver regra sobre `src/server/tenant`.
- R-7 profissional não-gestor não vê o motivo detalhado (RN-6): textos separados em `avisoDoPlano`.

## 8. Testes
Unit: `decidirPolitica` tabela 9 situações × 6 capacidades idêntica a `TABELA_CAPACIDADES`, capacidade inválida e falha de leitura → negado (CA-7); `avisoDoPlano` por estado × papel, e em `TZ=UTC`/`America/Sao_Paulo` com virada de dia (CA-5, CA-11); `agendamentoDisponivel` equivalência (R-3); `FaixaDoPlano` jsdom (`role="status"`); `define-acao.test.ts` repassa `agora`.
Integração (PostgreSQL real): por capacidade e estado (CA-2, CA-6, CA-R2): uma verificação por ação do registro em salão suspenso (assinatura e manual) e pendente, sem alteração no banco; varredura `import.meta.glob('/src/**/*.acao.ts')` (CA-8) que executa cada ação de salão e confirma "negada sse capacidade ∈ {configurar, agendar}" (cada ação precisa de input mínimo: tabela de entradas por ação no teste; ação sem entrada cadastrada reprova a varredura); `criarReserva` público e de equipe (CA-1, encaixe); cancelamento em suspenso com `mensagem cancelamento`, chave `reserva:cancelamento:revisao` e enfileiramento após commit, marcar status passado, anonimizar cliente (CA-3); fotos: `POST /api/painel/fotos` suspenso → 303 com código, sem objeto e sem linha; avaliação por link, denúncia, login, troca/recuperação de senha seguem funcionando (CA-9); isolamento A × B; páginas do painel respondem com dados e faixa (CA-4); cenário em_teste/ativa/sem assinatura sem mudança (CA-10; suítes D-013..D-030 verdes).
Playwright sem banco: `/dev/aviso-plano?estado=…&papel=…` mostra cada texto e some nos demais, axe 4.14.0, 375x812 (CA-11).
Cobertura ≥ 90% mantida: o código novo é pequeno e todo coberto pelos testes acima.

## 9. Tarefas
| T | Resp. | Dep. | Arquivos sob posse | Entregável / conclusão |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | `src/server/assinatura/politica-operacao.ts`(+test), `src/server/tenant/politica.ts`, `politica.test.ts`, `define-acao.ts`, `define-acao.test.ts`, `src/server/reservas/{criar-reserva,tipos,alteracao-comum,tipos-alteracao}.ts` e seus testes unitários, `src/server/reserva-publica/{agendamento,estado}.ts` (+tests), `repos/publico.ts` (só se remover `lerEstadoDeAgendamento`) | Política real e `agora` na assinatura; derivação única; unit CA-7 e equivalência verdes; typecheck/lint |
| T-2 | desenvolvedor | — (paralela a T-1) | `src/server/assinatura/aviso.ts`(+test), `src/components/layout/{PanelLayout,AvisoDoPlano,FaixaDoPlano}.tsx`, CSS e testes jsdom, `src/app/dev/aviso-plano/**`, `src/config/navegacao.ts` | Faixa e vitrine; unit/jsdom CA-5/CA-11 verdes |
| T-3 | desenvolvedor | T-1 | `tests/integration/politica/**`, `tests/support/politica.ts` | Integração: CA-1..4, 6, 8, 9, 10, R1, R2, isolamento, cancelamento com outbox, fotos handler, teste estático RN-5 |
| T-4 | desenvolvedor | T-2 | `e2e/aviso-plano.spec.ts` | E2E sem banco da faixa + axe |
| T-5 | desenvolvedor | T-1..T-4 | `README.md`, `CLAUDE.md`, `src/server/fotos/envio-http.ts` (só se faltar o código de recusa) | Documentação da tabela; D-038 registrada; gates (lint, typecheck, build, testes, cobertura, e2e) |

T-1 e T-2 em paralelo (sem arquivo em comum); T-3 após T-1; T-4 após T-2.

Cobertura de CAs: CA-1 T-1/T-3; CA-2, CA-6, CA-R2 T-3; CA-3 T-3; CA-4 T-2/T-3; CA-5 T-2 (unit) e T-4; CA-7 T-1; CA-8 T-3; CA-9 T-3; CA-10 T-3 (regressão); CA-11 T-2/T-4; CA-R1 T-1/T-3.
