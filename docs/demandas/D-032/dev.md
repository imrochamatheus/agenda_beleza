# D-032 (E4.5) Avaliações verificadas — dev

## 1. Tarefas concluídas (T-3 a T-8; T-9 não foi necessária)
- T-3: `src/server/avaliacoes/{tipos,token,config,validacao,nome,convite}.ts`, `src/server/repos/avaliacao.ts` (+ registro em `repos/index.ts`, cabeçalho de travas em `repos/servico.ts`), `src/worker/handlers/whatsapp-reserva.ts` (`gerarLink: deps.gerarLink ?? gerarLinkAvaliacao`), `src/config/avaliacao.ts`.
- T-4: `servico.ts` (`verificarLink`, `enviarAvaliacao`), `leitura.ts`, `src/server/repos/avaliacao-publica.ts` (`ondeAvaliacaoVisivel`, `lerPublicas`, `buscarConviteValido`), `formatarNota` e `formatarMesAno` em `src/lib/format.ts`.
- T-5: `aoAnonimizarPadrao` em `src/server/clientes/anonimizar.ts` chama `r.avaliacoes.anonimizarDaCliente` (sem importar o módulo de avaliações).
- T-6: rota `src/app/(publico)/[slug]/avaliar/[token]/` (`page`, `acoes`, `estado`, `formulario`, `FormularioAvaliacao` + css), cabeçalhos em `next.config.ts`, `ROTAS.avaliar`/`ROTAS.devAvaliacao` (`avaliar` fora de `SEGMENTOS_RESERVADOS`, como `salaoPublico`), `TextoDeConsentimento` exportado de `CaixasConsentimento`.
- T-7: `_componentes/SecaoAvaliacoes.tsx`, prop opcional `avaliacoes` em `PaginaDoSalao`, leitura em `[slug]/page.tsx`, `/dev/avaliacao`.
- T-8: E2E `e2e/avaliacao.spec.ts`, `e2e/avaliacao-sem-js.spec.ts`; testes de integração e unidade (abaixo); README (seção "Avaliações verificadas").
- Contratos atualizados só acrescentando: `tests/integration/db/drift.test.ts` (tabelas +2, 6 CHECKs, FKs 39 → 44, migração), `tests/integration/harness/template.test.ts`, `tests/integration/auth/recuperacao-senha-paginas.test.ts` (CA-18 lista a nova regra de cabeçalho), `src/config/navegacao.test.ts` (ignora `avaliar` como `salaoPublico`), `tests/integration/mensagens/convite.test.ts` (título do caso "sem gerador": agora é o gerador padrão sem slug).

## 2. Testes e CAs
- Unidade: `token`, `validacao`, `nome`, `config` (CA-6, CA-14, RN-8, D-2), `format` (CA-15, fuso), `formulario`, `FormularioAvaliacao`, `SecaoAvaliacoes`, `PaginaDoSalao` (CA-3/14/15 na UI), `/dev/avaliacao` (CA-16).
- `tests/integration/avaliacoes/`: `esquema` (CA-17, já existia), `convite` (CA-1, CA-2 com worker pg-boss real e adaptador simulado; token fora de mensagem, tentativas, jobs e logs), `envio` (CA-3, CA-4 com fronteira do prazo em ms, CA-5 token de outro salão, CA-6, CA-9 suspenso, CA-12 429 sem consultar o token, CA-13, CA-14), `visibilidade` (CA-7, CA-8 com falha injetada no gancho, CA-11, CA-15 arredondamento 4,25 → 4,3), `concorrencia` (CA-10: 10 e 12 envios do mesmo link ×10 = exatamente 1 avaliação; envio × anonimização × `nao_compareceu` ×10; três casos determinísticos com `pg_stat_activity`), `paginas` (casca, cabeçalhos do `next.config.ts`, estático CA-5, página pública).
- E2E: 375×812, locale `en-US`, teclado (foco visível, setas, Espaço, Enter), axe 4.14.0 sem violações, sem JavaScript, e cabeçalhos reais da rota com token (strict-origin, no-store, noindex; presentes também sem `.env`/`DATABASE_URL`, onde a página responde 500).

## 3. Comandos e resultados
Resultados finais: ver o relatório do líder (seção "Gates" abaixo, preenchida ao fim da rodada).

## 4. Desvios e riscos
- Nenhum desvio do desenho. Observações: (a) o limite por IP (`avaliacao`, 5 por 15 min) também conta a abertura da página (RN-12); sem `TRUSTED_PROXY_HOPS` todos dividem o balde `desconhecido`; (b) limite excedido na página responde HTTP 200 com a mensagem genérica (uma página não define status; o 429 do desenho vale como resultado do serviço); (c) rotação de `AVALIACAO_SEGREDO` mata links ainda não usados (documentado); (d) avaliações empatadas no mesmo `criado_em` desempatam por `id`.
- T-9 (texto de consentimento) não foi necessária: o texto `publicacao_avaliacao` existente cobre o aceite; `VERSAO_TERMOS` e o hash não mudaram.
- Pendências para o líder: atualizar o `CLAUDE.md`.
