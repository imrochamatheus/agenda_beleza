# D-043 (E7.3): dev

## Tarefas concluídas (T-1 a T-6)
- T-1: `src/server/mensagens/rotulos.ts` (+ teste tipo x estado, gênero do design §0).
- T-2: `src/components/agenda/SituacaoMensagens.{tsx,module.css,test.tsx}`, `src/server/mensagens/situacao-tipos.ts`, `css.test.ts` (sem cor literal, um só @media).
- T-3: `repos/mensagem.ts` (`listarDaReservaDaEquipe`, um SQL `reserva LEFT JOIN mensagem`), `mensagens/consultar-por-reserva.ts`, `tests/integration/mensagens/situacao-equipe.test.ts`.
- T-4: `repos/agenda.ts` (`EXISTS` de falha vigente em `COLUNAS`), `agenda/{tipos,consultar}.ts`, `tests/integration/agenda/falha-mensagem.test.ts` (flag, 6 instruções com 1 e 50 reservas, CA-9, CA-10, paridade com `conferirVigencia` em 32 combinações), plano de 60 mil em `repo.test.ts`.
- T-5: `Eventos.tsx` (`MarcaDeFalha`), `ListaDaSemana`, `DetalheDaReserva` (prop `mensagens`), `Agenda.module.css` (`.somenteLeitor`, `.marcaFalha`, `.comFalha`), `reservas/[id]/page.tsx`, vitrine `/dev/agenda`, testes de página (`paginas.test.ts`: CA-1, 3, 5, 7, 11, 12).
- T-6: `/dev/mensagens-reserva` (+ `ROTAS.devMensagensReserva`), `sem-next.test.ts` (CA-15), `e2e/mensagens-situacao{,-sem-js}.spec.ts`, README, emenda de gênero na RN-8 do `spec.md`.

## EXPLAIN (60 mil reservas, `tests/integration/agenda/repo.test.ts`)
`Index Scan using reserva_salao_id_*_inicio_idx on reserva` mantido; o `EXISTS` usa `Index Scan using mensagem_reserva_id_tipo_revisao_key on mensagem` (loops = nº de linhas devolvidas, 0,5 a 1,2 ms no total), sem Seq Scan em `reserva` nem em `mensagem`; 6 instruções. Sem regressão: DBA não acionado.

## Gates
- typecheck, lint: limpos.
- `npm run test:coverage`: 528 arquivos, 6203 testes passando; linhas 98,9% (limiar 90%). Unitários da área em TZ=UTC e America/Sao_Paulo: passando.
- Build e E2E completo rodados em cópia idêntica do repositório em `/tmp` (porta 3000 ocupada por um `next-server` antigo, pid 1699112, não encerrado), na porta 3107 (só `playwright.config.ts` e `127.0.0.1:3000` dos specs trocados): `npm run test:e2e` = 270 passed. Specs novos sem `.env`/`DATABASE_URL`: 28 passed (com `agenda.spec.ts`).
- Capturas 375/768/1280 (fora do repo, em scratchpad): detalhe, grade do dia, semana e vitrine tipo x estado conferidos contra o web-design (triângulo no canto sem mudar o bloco, cancelado sem riscar a marca, só a falha com fundo de erro, sem rolagem horizontal).

## Desvios e notas
- Guarda D-024 (`estrutura.test.ts`, CA-26) proibia qualquer import de `@/server/mensagens` em `src/app`; liberei só `rotulos`, `situacao-tipos`, `tipos` e `consultar-por-reserva`.
- `consultar.test.ts` (D-028) ignora a chave `temFalhaDeMensagem` na verificação "sem mensagens no DTO".
- Rótulo de falha da remarcação inclui a revisão ("Falha ao enviar remarcação 1 por WhatsApp").
- `/dev/reserva-acoes` passa `mensagens={[]}` ao detalhe.
- Build rodado só na cópia (evita regravar `.next` sob o servidor da porta 3000).
- Linha D-043 do CLAUDE.md: a cargo do líder.
