# D-026 (E4.1) — Design: página pública do salão e fluxo de reserva

## 1. Resumo e alternativas descartadas
Rota dinâmica `src/app/(publico)/[slug]/page.tsx` (Server Component, `force-dynamic` implícito por `searchParams`). O passo do fluxo é derivado só da query string (`s`, `p`, `data`, `h`) por uma função pura; cada passo é um GET com links/formulários `method=get`; o único POST é uma Server Action (`acoes.ts`, casca `'use server'`) que chama o serviço `reservarPelaPagina`, que chama `criarReserva` (D-025) com `contextoDeSistema(salaoId, 'reserva_publica')` e `modo: 'normal'`. Nenhuma tabela nova; nenhuma ferramenta nova.

Descartadas:
- Estado do fluxo em cookie/sessão/client state: quebra o sem-JS e o "voltar"; a query string é a fonte única.
- Route handler para o POST final: perderia o padrão `acoes.ts` e a mensagem por campo preservando valores; Server Action já funciona sem JS (D-011).
- PRG para a confirmação com id da reserva na URL: expõe reserva por id a quem não tem conta. A confirmação é o estado da resposta da ação (recarregar reenvia a mesma `chaveRequisicao` -> `repetida`, mesma tela).
- Calcular horários na UI/página: proibido (RN-7); só `consultarDisponibilidade`.
- `Referrer-Policy: strict-origin` na rota: o padrão dos navegadores (`strict-origin-when-cross-origin`) não quebra o `Origin` dos POSTs sem JS e a query só tem ids públicos/UUID da chave NÃO (a chave vai em campo oculto). Dispensado; não declarar `no-referrer`.

## 2. Componentes afetados (caminhos)
Novos:
- `src/server/reserva-publica/agendamento.ts` — `agendamentoDisponivel` (pura, gancho E6.4).
- `src/server/reserva-publica/passos.ts` — `lerPasso(params, { hoje, janelaDias })` pura: parse/validação defensiva de `s` (1–10 UUIDs sem repetição, ordem preservada), `p` (UUID ou `qualquer`), `data` (`YYYY-MM-DD` real), `h` (ISO UTC, segundos zero); parâmetro inválido -> volta ao passo anterior (nunca 500). Retorna `{ passo: 'servicos'|'profissional'|'data'|'horario'|'dados', ...}` e `montarHref`.
- `src/server/reserva-publica/tipos.ts` — contratos client-safe, `MENSAGENS_RESERVA_PUBLICA`, códigos fechados de `aviso`.
- `src/server/reserva-publica/pagina.ts` — `carregarPagina(slug)` (resolução + perfil + funcionamento + fotos + serviços + equipe + estado) e `carregarPasso(ctx, passo, agora)` (profissionais elegíveis, dias/horários via `consultarDisponibilidade`). Sem `next/*`.
- `src/server/reserva-publica/servico.ts` — `reservarPelaPagina(entrada, deps?, agora)`; sem `next/*`.
- `src/app/(publico)/[slug]/page.tsx`, `acoes.ts` (casca `'use server'`), `estado.ts`, `_componentes/` (`Perfil`, `Servicos`, `Equipe`, `PassoServicos`, `PassoProfissional`, `PassoData`, `PassoHorario`, `FormularioDados` (client, um `useActionState`), `Confirmacao`, `Indisponivel`) + `*.module.css` (sem cores: só tokens).
- `src/app/dev/reserva/page.tsx`, `acoes.ts`, `dados.ts` — vitrine em memória (§8).
- Testes: `src/server/reserva-publica/*.test.ts`, `src/app/(publico)/[slug]/**/*.test.tsx`, `tests/integration/reserva-publica/*.test.ts`, `e2e/reserva-publica*.spec.ts`.

Alterados:
- `src/server/repos/publico.ts` — nova `lerEstadoDeAgendamento(ctx: PublicoContext)`: UMA leitura com `select` mínimo de `salao.suspenso_manual_em` + a assinatura mais recente (`ORDER BY criado_em DESC, id DESC LIMIT 1`: `estado`, `acesso_ate`). Única leitura de assinatura em rota pública (risco do spec §8). Também atualizar o comentário de `resolverSalaoPorSlug` (308, não 301).
- `src/config/navegacao.ts` — `ROTAS.devReserva = '/dev/reserva'`.
- README (seção da página pública e E2E), `CLAUDE.md` pelo líder.

## 3. Interfaces
```ts
// agendamento.ts (pura, sem imports de runtime)
type EstadoAgendamento = {
  suspensoManualEm: Date | null;
  assinatura: { estado: 'pendente'|'em_teste'|'ativa'|'em_carencia'|'suspensa'|'cancelada'|'encerrada'; acessoAte: Date | null } | null;
  servicosOfertaveis: number;
  agora: Date;
};
type DecisaoAgendamento = { disponivel: true } | { disponivel: false; motivo: 'suspenso_manual'|'assinatura'|'sem_servico' };
function agendamentoDisponivel(e: EstadoAgendamento): DecisaoAgendamento;
```
Regra (D-1, ordem de motivos fixa): `suspensoManualEm != null` -> `suspenso_manual`; assinatura `null` -> disponível (legado/seed); `pendente`/`suspensa`/`encerrada` -> `assinatura`; `cancelada` -> `assinatura` salvo `acessoAte > agora`; `em_teste`/`ativa`/`em_carencia` -> ok; `servicosOfertaveis === 0` -> `sem_servico`. A E6.4 troca só esta função (e a `politica` abaixo).

```ts
// servico.ts
type EntradaReservaPublica = { slug: string; servicoIds: string[]; profissionalId: string; inicio: string /*ISO*/;
  nome: unknown; telefone: unknown; aceites: unknown; chaveRequisicao: string };
type ResultadoReservaPublica =
  | { resultado: 'confirmada'; resumo: ResumoConfirmacao; repetida: boolean }
  | { resultado: 'voltar'; passo: 'servicos'|'profissional'|'horario'; aviso: CodigoAviso }  // horario_indisponivel, servico/profissional_indisponivel
  | { resultado: 'invalido'; erros: ErrosReserva }                                          // + consentimento_ausente (erros de consentimento)
  | { resultado: 'indisponivel' }                                                           // salao_indisponivel
  | { resultado: 'slug_mudou'; slugAtual: string }                                          // ação resolve de novo
  | { resultado: 'recusado'; mensagem: string }                                             // antesDaReserva (E4.2), chave_reutilizada
function reservarPelaPagina(e: EntradaReservaPublica, agora: Date, deps?: DependenciasCriarReserva): Promise<ResultadoReservaPublica>;
```
Fluxo do serviço: `resolverSalaoPorSlug` (NaoEncontrado -> `invalido` genérico sem vazar) -> `lerEstadoDeAgendamento` + `agendamentoDisponivel` (se indisponível, retorna `indisponivel` ANTES de qualquer escrita, CA-4) -> `criarReserva(contextoDeSistema(salaoId,'reserva_publica'), {…, modo:'normal', agora}, { politica: politicaDaPagina(estado), ...deps })`. `politica` é injetada para que a mesma função pura valha dentro da transação do `criarReserva` (E6.4); o pré-teste fora da transação existe só para o caminho barato e para não gravar nada. `deps.antesDaReserva` é o ponto de extensão da E4.2 (RN-13). Mapeamento: `criada|repetida` -> `confirmada` (`ResumoConfirmacao`: serviços em ordem com preço/duração do snapshot da reserva, profissional (nome), início formatado só na camada de UI via `format.ts` no fuso do salão, total, duração, sem ids de outras clientes); `horario_indisponivel` -> `voltar/horario`; `servico_indisponivel` -> `voltar/servicos`; `profissional_indisponivel` -> `voltar/profissional`; `invalido` e `consentimento_ausente` -> `invalido`; `chave_reutilizada` -> `recusado`; `salao_indisponivel` -> `indisponivel`.

Server Action (`acoes.ts`): `reservar(estadoAnterior, formData)`: só converte `FormData` e chama `reservarPelaPagina`. `voltar` e `slug_mudou` -> `redirect()` (303) para o GET do passo com `?aviso=<código fechado>` (sem texto livre na URL); `confirmada`/`invalido`/`indisponivel`/`recusado` -> estado da resposta com valores digitados (nome, telefone, aceites) preservados, inclusive sem JS. `agora` = `new Date()` só na casca.

GET: `page.tsx` recebe `params.slug` e `searchParams`. Pré-checagem sem banco: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 50, não está em `SEGMENTOS_RESERVADOS` -> senão `notFound()`. `resolverSalaoPorSlug` (envolvida em `React.cache` para `generateMetadata` + página); `NaoEncontrado` -> `notFound()`; `historico` -> `permanentRedirect(`/${slugAtual}${queryOriginal}`)` (308, preserva a query; D-4). Sem `loading.tsx`/`Suspense` acima do redirect, para o status ser 308 real e não meta-refresh (verificar no teste, §7 R-1).

`chaveRequisicao`: `crypto.randomUUID()` gerado no render do passo `dados` e enviada em campo oculto; resposta de erro de campo devolve a MESMA chave no estado (o duplo clique/reenvio reaproveita).

## 4. Dados
Sem migração, sem índice, sem constraint. Leituras novas: apenas `lerEstadoDeAgendamento` (tabelas `salao` e `assinatura`, índice `assinatura(salao_id)` existente). A reserva usa as travas e a exclusion constraint da D-025 sem alteração. Cliente anonimizada com o mesmo telefone: a anonimização limpa o telefone, então o `UNIQUE (salao_id, telefone_e164)` não conflita e `upsertCliente` cria nova cliente; o desenvolvedor confirma com teste de integração (T-3). **DBA dispensado**: sem schema, sem SQL novo além de um `SELECT` por chave existente; o plano de `consultaOcupacoes` não muda.

## 5. Infraestrutura
Sem variáveis de ambiente, containers ou CI novos; os E2E novos entram no job `e2e` existente (vitrine sem banco, como D-015..D-023). **DevOps dispensado.** Observabilidade: log só de `reserva_publica.resultado` com `resultado` e `salaoId`, nunca nome/telefone/chave.

## 6. Verificação das invariantes
- Escopo por salão no servidor: aplica. Todo acesso parte do `PublicoContext`/`SistemaContext` do slug; ids de outro salão são inexistentes (`criarReserva` e `consultarDisponibilidade` já o garantem); teste CA-13 com dois salões.
- Exclusion constraint: aplica, por herança de `criarReserva`; `modo: 'normal'` fixo (a ação nunca aceita `modo`/encaixe do formulário). CA-9 com 2 envios em paralelo.
- UTC + fuso do salão: aplica. `h` é instante UTC ISO; dias e horas exibidos só via `format.ts` com o fuso do salão; `data` (dia civil do salão) vai a `consultarDisponibilidade`, que usa `fuso.ts`. Testes em `TZ=UTC` e `America/Sao_Paulo` (CA-6). Nenhum `Date` local novo; "hoje" = `partesLocais(agora, fuso)`.
- Adaptadores: não aplica nova integração; mensagem pela outbox (E7.1), Turnstile fica como `antesDaReserva` (E4.2). Nada importa SDK de provedor.
- Soft delete/anonimização: aplica à leitura: só ativos; cliente anonimizada tratada acima.
- Salão suspenso somente leitura: aplica; `agendamentoDisponivel` + recusa da ação + `politica` dentro de `criarReserva`. Perfil/fotos continuam visíveis (RN-3).
- Idempotência: aplica; `chaveRequisicao` + `repetida` mesma tela; mensagem `confirmacao` já idempotente pela chave `reserva:tipo:revisao`.
- Auditoria do super admin: não se aplica (sem ação de admin).

## 7. Riscos e decisões
- R-1 `permanentRedirect` em página pode virar 200 com meta-refresh se o streaming já iniciou. Mitigação: redirecionar antes de qualquer `await` de UI e sem `loading.tsx`; teste de integração HTTP (build + `fetch(redirect:'manual')`, status 308 e `Location`). Plano B: `src/proxy.ts` não serve (sem banco); aceitar redirect no page com `generateMetadata` cacheado e o teste como gate.
- R-2 Colisão da rota `[slug]` com rotas estáticas/futuras: estáticas têm precedência no Next; teste estático garante que todo `SEGMENTOS_RESERVADOS` tem pasta própria ou cai em `notFound()` sem consultar o banco (pré-checagem do `[slug]` antes do DB).
- R-3 Perfil (várias leituras) + estado + disponibilidade sem transação: leitura pode ser levemente inconsistente; a ação sempre revalida no servidor (criarReserva). Aceito.
- R-4 Custo: `consultarDisponibilidade` do mês inteiro (6 consultas constantes, CA-27 < 2 s). A tela de data pagina em 14 dias (`?de=`), chamando uma vez; a de horário chama só o dia.
- R-5 "sem preferência" (D-2): `p=qualquer` consulta sem `profissionalId`, une horários por instante e cada link de horário leva o `p` do primeiro elegível em ordem estável (nome, id); a ação recebe sempre um `profissionalId` concreto.
- R-6 Salões sem linha de `assinatura` são disponíveis (D-1); se o cadastro (E1.1) um dia criar `pendente` antes do teste, E6.4 define. Sinalizado ao líder.
- R-7 XSS: tudo renderizado por React (escapa); descrição com HTML aparece como texto; fotos por `/api/fotos/[id]` com `alt` do banco, `width/height` fixos; 404 de foto não quebra o layout (`alt` + contêiner com proporção).
- Decisão: seção de avaliações não é renderizada (D-3).

## 8. Estratégia de testes
- Unitário (Vitest/jsdom; também em `TZ=UTC` e `America/Sao_Paulo`): `agendamentoDisponivel` (CA-4, tabela de estados), `lerPasso` (parâmetros malformados, CA-11/slug), pré-checagem do slug e teste estático de reservados (CA-3, RN-2), componentes (CA-1, CA-2 sem `undefined`/`null`, descrições com HTML), mapeamento de resultados do serviço com `criarReserva` real em integração; cobertura ≥ 90% mantida por testes de cada módulo novo.
- Integração com PostgreSQL real (`tests/integration/reserva-publica/`): CA-3 (308/404/reservados via resposta do `page` e `resolverSalaoPorSlug`), CA-4 (POST direto -> `indisponivel`, zero reservas, para suspenso manual, sem serviço, `pendente`, `suspensa`), CA-5, CA-6 (igualdade com `consultarDisponibilidade`), CA-7 (reserva, itens, cliente, consentimento com versão, outbox), CA-8, CA-9 (paralelo, sem 500), CA-10, CA-11, CA-13 (dois salões), anonimizada.
- Playwright em `/dev/reserva` (CA-12, sem banco; dados em memória com as mesmas funções puras `lerPasso`/validação; ação só valida e devolve confirmação simulada): 375×812, teclado, axe 4.14.0 zero em cada passo, sem rolagem horizontal, sem JS (`e2e/reserva-publica-sem-js.spec.ts`). CA-14: `npm run build` (`/termos` e `/privacidade` `○`, `/[slug]` `ƒ`) e testes existentes.
- Mapa CA -> tipo: CA-1/2 unit+E2E; CA-3 integração+unit; CA-4 unit+integração; CA-5..9, 11, 13 integração; CA-10 unit+integração+E2E sem JS; CA-12 E2E; CA-14 build.

## 9. Tarefas
- T-1 (desenvolvedor; sem dependências). Arquivos: `src/server/reserva-publica/{agendamento,passos,tipos,pagina,servico}.ts` + `*.test.ts`, `src/server/repos/publico.ts`, `src/config/navegacao.ts`. Entregável: lógica pura, serviço e leitura de estado. Conclusão: unit verdes nos dois fusos; lint de imports (sem `next/*` em `src/server/reserva-publica`).
- T-2 (desenvolvedor; depende de T-1; paralela a T-3). Arquivos: `src/app/(publico)/[slug]/**` (page, acoes, estado, `_componentes`, CSS, testes `.tsx`). Entregável: página, passos, formulário, confirmação, 308/404. Conclusão: CA-1, 2, 3, 10 (sem JS) em teste de componente; `next build` com `/[slug]` dinâmica e `/termos` estática.
- T-3 (desenvolvedor; depende de T-1; paralela a T-2; arquivos disjuntos). Arquivos: `tests/integration/reserva-publica/**`, `tests/support/reserva-publica.ts`. Entregável: testes de integração de CA-3..CA-11 e CA-13, incluindo cliente anonimizada. Conclusão: verdes 10x seguidas em `concorrencia` (CA-9); teste HTTP do 308 (depende do build de T-2 só para o caso 308: executar após T-2).
- T-4 (desenvolvedor; depende de T-2). Arquivos: `src/app/dev/reserva/**`, `e2e/reserva-publica.spec.ts`, `e2e/reserva-publica-sem-js.spec.ts`. Entregável: vitrine 404 fora de `VITRINE_COMPONENTES=true`/`next dev` e E2E. Conclusão: CA-12 com axe zero.
- T-5 (desenvolvedor; depende de T-3 e T-4). Arquivos: `README.md`. Entregável: documentação (rota, estado indisponível, comandos E2E); líder atualiza `CLAUDE.md`. Conclusão: `npm run lint`, `typecheck`, `build`, `test:coverage` ≥ 90%.
- DBA e DevOps: dispensados (§4 e §5).
