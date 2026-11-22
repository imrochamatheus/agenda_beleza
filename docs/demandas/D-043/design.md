# D-043 (E7.3) Situação de envio das mensagens: design

Fontes: `spec.md` (RN-1..14, CA-1..15), `web-design.md`, código lido: `repos/mensagem.ts` (`listarDaReserva`), `repos/agenda.ts`, `agenda/consultar.ts`, `mensagens/elegibilidade.ts` (`conferirVigencia`), página `reservas/[id]`, `tests/integration/agenda/estatico.test.ts`.

## 0. Emenda ao spec (decisão do líder: vale o web-design)
Concordância de gênero nos rótulos. Feminino (Confirmação, Remarcação): "enviada", "não enviada", "substituída", "aguardando envio", "sendo enviada". Masculino (Cancelamento, Convite de avaliação): "enviado", "não enviado", "substituído", "sendo enviado". O desenvolvedor atualiza RN-8 e CA-4 do `spec.md` (T-6) com esta tabela. Frases de falha ("Falha ao enviar {tipo} por WhatsApp"), "aguardando envio" e os motivos não mudam. Remarcação leva a revisão: "Remarcação 1". `substituida` com `erroCodigo` `obsoleta`: "{Tipo} não enviado/a: a reserva mudou antes do envio".

## 1. Solução e alternativas
- Detalhe: nova função `consultarMensagensDaReserva(ctx, id)` em `src/server/mensagens/consultar-por-reserva.ts`: `exigirPermissao('agenda.ver')` + `filtroDeProfissional`, e UM comando SQL (`reserva r LEFT JOIN mensagem m`) que valida salão + profissional e lista; zero linhas de `reserva` → `NaoEncontrado` (404 uniforme). Reserva sem mensagem devolve 1 linha com `m` nulo → lista vazia.
- Grade: `EXISTS` de falha VIGENTE dentro de `COLUNAS` de `repos/agenda.ts` (mesmo comando; `consultarAgenda` segue com 6 instruções; `detalhe` herda o campo).
- Rótulos e motivos mapeados no servidor (`rotulos.ts`, client-safe); o DTO que sai da função nunca carrega `erroCodigo` bruto.
- Descartadas: (a) reutilizar `mensagensDaReserva` com checagem prévia de `reserva.profissional_id` na página (duas leituras e a regra de escopo ficaria fora do serviço; mantida intacta, é contrato da D-024); (b) alterar `listarDaReserva` (usada por E8.3/testes; sem escopo de profissional); (c) coluna denormalizada `tem_falha` (migração, escrita no pipeline, fora de escopo); (d) "qualquer `falhou`" na grade (alarme falso em reserva cancelada; o predicado vigente custa um `EXISTS` indexado).

## 2. Componentes afetados
- Novo `src/server/mensagens/rotulos.ts` (client-safe, sem imports de servidor): `rotuloDaMensagem({tipo,revisao,estado,erroCodigo}): { rotulo: string; motivo: string | null }` com `switch` exaustivo por estado e tipo; `MOTIVOS` lista fechada (`resultado_incerto`, `link_indisponivel`, `sem_consentimento`; `obsoleta` vira variante do rótulo de `substituida`; `cancelada_anonimizacao` usa `TEXTO_CLIENTE_REMOVIDA` capitalizado + "; a mensagem foi cancelada."). Código desconhecido → `motivo: null`.
- Novo `src/server/mensagens/consultar-por-reserva.ts` (sem `next/*`).
- `src/server/repos/mensagem.ts`: método novo `listarDaReservaDaEquipe(ctx, reservaId, profissionalId|null)`; `listarDaReserva` inalterado. Tipo no `repos/tipos.ts`.
- `src/server/repos/agenda.ts`: `COLUNAS` + `tem_falha_mensagem`, `LinhaBruta`/`LinhaAgenda.temFalhaDeMensagem`.
- `src/server/agenda/{tipos.ts,consultar.ts,montagem.ts}`: `ReservaDaAgenda.temFalhaDeMensagem: boolean` (`paraReserva` copia; `montagem` só repassa); `DetalheDaReserva.temFalhaDeMensagem` herdado; corrigir o comentário "Sem mensagens".
- Novo `src/components/agenda/SituacaoMensagens.tsx` (+ `.module.css`, `.test.tsx` jsdom): server-safe, recebe `mensagens: MensagemSituacao[]` e `fuso`; formata data com `formatarDataHora(d, fuso)`.
- `src/app/painel/agenda/_componentes/Eventos.tsx` (`MarcaDeFalha` exportada, SVG triângulo 1,125 rem), `GradeDoDia.tsx`, `ListaDaSemana.tsx` (texto visível "Falha ao enviar mensagem"), `DetalheDaReserva.tsx` (prop `mensagens` e `fuso`, renderiza a seção após "Serviços"), `Agenda.module.css` (`.somenteLeitor` novo, `.marcaFalha`, `.evento` com falha: `padding-right: 1.5rem`, sem tocar `height`/posição; marca `text-decoration: none`, `z-index` < foco 3; sem literal de cor, sem token, sem novo `@media`).
- `src/app/painel/agenda/reservas/[id]/page.tsx`: `consultarMensagensDaReserva` no `Promise.all` existente; `NaoEncontrado` → `notFound()` igual ao detalhe.
- Vitrines: `src/app/dev/agenda/demonstracao.ts` (uma reserva `confirmado` e uma `cancelado`/`concluido` com `temFalhaDeMensagem: true`), nova `src/app/dev/mensagens-reserva/page.tsx` (tipo × estado, 404 sem `VITRINE_COMPONENTES=true`/`next dev`; `ROTAS.devMensagensReserva` em `src/config/navegacao.ts`).

## 3. Interfaces
```ts
// consultar-por-reserva.ts
export type MensagemSituacao = {
  id: string; estado: EstadoMensagem; rotulo: string; motivo: string | null;
  tentativas: number; ultimaTentativaEm: Date | null;
};
export function consultarMensagensDaReserva(ctx: TenantContext, id: unknown): Promise<MensagemSituacao[]>;
// repo
listarDaReservaDaEquipe(ctx, reservaId: string, profissionalId: string | null): Promise<MensagemDaReservaDTO[]>; // lança NaoEncontrado
```
SQL de `listarDaReservaDaEquipe`: `FROM reserva r LEFT JOIN mensagem m ON m.salao_id = r.salao_id AND m.reserva_id = r.id WHERE r.salao_id = $1 AND r.id = $2 [AND r.profissional_id = $3] ORDER BY m.criado_em, m.id` (id não UUID → `NaoEncontrado` antes do SQL; mesmas subconsultas de tentativas de `listarDaReserva`; sem `FOR`; projeção sem `destinatario_e164`, `parametros`, `provedor_mensagem_id`, `erro_detalhe`).
Predicado da grade (literais `'falhou'`, `'confirmado'`, … ficam no SQL, nunca parâmetros): `EXISTS (SELECT 1 FROM mensagem m WHERE m.salao_id = r.salao_id AND m.reserva_id = r.id AND m.estado = 'falhou' AND ((m.tipo IN ('confirmacao','remarcacao') AND m.revisao = r.revisao AND r.status = 'confirmado') OR (m.tipo = 'cancelamento' AND m.revisao = r.revisao AND r.status = 'cancelado') OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido'))) AS tem_falha_mensagem`.
Risco de deriva do predicado duplicado de `conferirVigencia`: teste de paridade (T-4) percorre tipo × status × revisão igual/diferente e compara o SQL com `conferirVigencia`.

## 4. Dados
Sem migração. `mensagem_salao_id_reserva_id_idx (salao_id, reserva_id)` serve o `EXISTS` (semi-join aninhado, no máximo 201 linhas por `LIMIT`). Condição de dispensa do DBA: o desenvolvedor roda `EXPLAIN (ANALYZE)` de `consultaAgenda` em 60 mil reservas com mensagens (extensão do teste de plano existente `tests/integration/agenda/repo.test.ts`) e confirma Index Scan em `reserva` mais o índice de `mensagem`. Se o plano regredir (Seq Scan) ou pedir índice, parar e acionar o DBA. **DBA: não acionado agora, com essa condição.**

## 5. Infraestrutura
Sem env, container, CI nem observabilidade. **DevOps: dispensado** (nenhuma variável, job nem imagem muda; E2E novos entram nos comandos Playwright já existentes).

## 6. Invariantes
- Escopo por salão no servidor: ambos os SQL filtram `salao_id`; profissional filtra `profissional_id` (`filtroDeProfissional`). Atende.
- Exclusion constraint: não se aplica (somente leitura).
- UTC e fuso: `ultimaTentativaEm` em UTC, formatada só por `formatarDataHora(d, fuso do salão)`; o guarda estático R-5 já cobre `src/app/painel/agenda`. Atende.
- Adaptadores: não se aplica. Soft delete/anonimização: cliente anonimizada continua listada, sem nome/telefone (RN-14). Salão suspenso: leitura sempre liberada, sem checagem de assinatura (guarda "sem suspens" mantido). Idempotência: não se aplica (não escreve). Auditoria super admin: não se aplica.
- Guarda estático da agenda: `repos/agenda.ts` continua sem INSERT/UPDATE/DELETE; novo repo/função fica em `server/mensagens` e `repos/mensagem.ts` (fora do guarda, mas testado sem `FOR`/escrita no teste do T-3).

## 7. Riscos
- R-1 plano da grade com o `EXISTS`: mitigado por EXPLAIN em 60 mil (§4) e CA-16 (6 instruções).
- R-2 deriva do predicado de vigência: teste de paridade.
- R-3 vazamento por `erroCodigo`: o DTO de saída do serviço o descarta; teste de sentinelas no JSON e no HTML.
- R-4 marca altera layout: teste E2E compara `getBoundingClientRect` com e sem falha a 375 px.
- R-5 "Última tentativa" defasada durante `enviando`: aceito (`force-dynamic`).

## 8. Testes (cobertura global ≥ 90%)
- Unidade: `rotulos.test.ts` (tipo × estado × gênero, CA-4, tabela do §0; códigos desconhecidos; `TEXTO_CLIENTE_REMOVIDA`); `SituacaoMensagens.test.tsx` (CA-2, CA-4, CA-6, CA-13, CA-14 texto acessível, sentinelas CA-5); testes de `Eventos`/`GradeDoDia`/`ListaDaSemana`/`DetalheDaReserva`/`VistaDaAgenda` (marca com texto, CA-8/9 no componente); `TZ=UTC` e `America/Sao_Paulo` em `src/server/mensagens src/lib/format.test.ts` (CA-1, virada de dia 23:50).
- Integração (PostgreSQL real): `tests/integration/mensagens/situacao-equipe.test.ts` (CA-1, 2, 3 incl. gestor de outro salão e malformado idênticos, 5 com valores sentinela nas colunas, 6, 11 salão suspenso, 12, 13, ausência de `FOR`); `tests/integration/agenda/falha-mensagem.test.ts` (CA-8 com contador 1 e 50 reservas = 6 instruções, CA-9, CA-10, paridade com `conferirVigencia`, plano com 60 mil); CA-7 em `tests/integration/agenda/paginas.test.ts` (botões iguais com `falhou` e reserva segue `confirmado`).
- E2E Playwright sem banco: `e2e/mensagens-situacao.spec.ts` e `e2e/mensagens-situacao-sem-js.spec.ts` sobre `/dev/agenda` e `/dev/mensagens-reserva`: axe 4.14.0 zero violações, 375×812, teclado (sem nova parada de tabulação), sem JS, sem rolagem horizontal, geometria do `.evento` igual com/sem falha (CA-14). Capturas 375/768/1280 pelo desenvolvedor, conferidas pelo tester.
- `estatico.test.ts` da agenda: sem alteração; acrescentar em arquivo novo grep de que `src/server/mensagens/` não importa `next/*` (CA-15).

## 9. Tarefas
Todas do **desenvolvedor**. Posse sem sobreposição.
- **T-1** (paralela, sem dependência): `src/server/mensagens/rotulos.ts` + `rotulos.test.ts`. Pronto: tabela do §0 coberta tipo × estado.
- **T-2** (paralela): `src/components/agenda/SituacaoMensagens.tsx`, `.module.css`, `.test.tsx`. Depende de T-1 só pelo tipo `MensagemSituacao` (declare-o em `src/server/mensagens/situacao-tipos.ts`, posse de T-2, client-safe; T-3 o importa). Pronto: estados, vazio, sentinelas.
- **T-3** (depende de T-1 e do tipo de T-2): `src/server/repos/mensagem.ts`, `src/server/repos/tipos.ts`, `src/server/mensagens/consultar-por-reserva.ts`, `tests/integration/mensagens/situacao-equipe.test.ts`. Pronto: CA-1, 2, 3, 5, 6, 11, 12, 13.
- **T-4** (paralela a T-3; arquivos disjuntos): `src/server/repos/agenda.ts`, `src/server/agenda/{tipos,consultar,montagem}.ts` (+ testes de montagem), `tests/integration/agenda/{falha-mensagem.test.ts,repo.test.ts}`. Pronto: CA-8, 9, 10, EXPLAIN em 60 mil registrado em `dev.md`; se regredir, acionar DBA.
- **T-5** (depende de T-2, T-3, T-4): `src/app/painel/agenda/_componentes/{Eventos,GradeDoDia,ListaDaSemana,DetalheDaReserva,VistaDaAgenda}.tsx` e testes, `Agenda.module.css`, `reservas/[id]/page.tsx`, `src/app/dev/agenda/{demonstracao.ts,page.test.tsx}`, `tests/integration/agenda/paginas.test.ts`. Pronto: CA-7, 12, 14 na tela.
- **T-6** (depende de T-5): `src/app/dev/mensagens-reserva/page.tsx` (+ teste), `src/config/navegacao.ts`, `e2e/mensagens-situacao*.spec.ts`, capturas, emenda RN-8/CA-4 em `spec.md`, linha na doc CLAUDE.md (D-043) e README se descrever a agenda, lint/typecheck/build/cobertura. Pronto: axe, teclado, 375×812, sem JS, gates verdes.
Paralelo: T-1, T-2 e T-4 juntos; depois T-3; depois T-5; por fim T-6.

## 10. Mapa CA → tarefa → teste
CA-1/2/3/5/6/11/12/13 → T-3 (integração) + T-1/T-2 (unidade); CA-4 → T-1/T-2 (unidade); CA-7 → T-5 (integração); CA-8/9/10 → T-4 (integração); CA-14 → T-2/T-5 (unidade) + T-6 (E2E axe); CA-15 → T-3/T-6 (estático) + cobertura no gate de T-6.
