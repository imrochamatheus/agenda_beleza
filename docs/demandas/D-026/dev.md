# D-026 (E4.1) — Desenvolvimento

## 1. Tarefas concluídas
- **T-1** `src/server/reserva-publica/`: `agendamento.ts` (função pura `agendamentoDisponivel`), `passos.ts` (`lerPasso`, leitores defensivos de `s`/`p`/`data`/`h`/`aviso`, `montarHref`, `slugPlausivel`), `tipos.ts` (client-safe), `estado.ts` (`decidirAgendamento`), `pagina.ts` (`carregarSalao`, `lerRegrasDaPagina`, `carregarPasso`), `servico.ts` (`reservarPelaPagina`); `src/server/repos/publico.ts` (`lerEstadoDeAgendamento`, um comando, e `lerRotulosDaReserva`; comentário do 308); `ROTAS.devReserva`.
- **T-2** `src/app/(publico)/[slug]/`: `page.tsx` (308 via `permanentRedirect`, 404, `generateMetadata`), `acoes.ts` (casca), `formulario.ts` (conversão pura), `estado.ts`, `_componentes/` (`PaginaDoSalao`, `Perfil`, `Passos`, `FormularioDados`, `Salao.module.css`).
- **T-3** `tests/integration/reserva-publica/{servico,pagina,concorrencia,acao,http}.test.ts`, `tests/support/reserva-publica.ts`.
- **T-4** `src/app/dev/reserva/` (`page`, `acoes`, `dados`, `demonstracao`), `e2e/reserva-publica.spec.ts`, `e2e/reserva-publica-sem-js.spec.ts`.
- **T-5** README (seção "Página pública do salão e reserva" e comando E2E).

## 2. Comandos e resultados
- `npm run lint`: passou. `npm run typecheck`: passou. `npm run build`: passou (`/[slug]` `ƒ`; `/termos` e `/privacidade` `○`).
- `npm run test:coverage` (unidade + integração, 360 arquivos): 4381 testes passaram; linhas 99,46% (gate 90%).
- `npm run test:e2e`: 118 passaram (inclui os 6 novos: teclado 375×812, axe 4.14.0 em cada passo, sem rolagem horizontal, sem JavaScript, vistas indisponível e vazia, parâmetros malformados).
- Estabilidade: `concorrencia.test.ts` 10 execuções seguidas, todas verdes. Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/reserva-publica`, `src/app/dev/reserva`, `src/app/(publico)` e `tests/integration/reserva-publica`: verdes.

## 3. Testes por CA
- CA-1/CA-2: `PaginaDoSalao.test.tsx`, `pagina.test.ts` (página real renderizada), E2E vista vazia.
- CA-3: `pagina.test.ts` (digest 308/404, reservados no repositório), `passos.test.ts` (reservados e malformados), `http.test.ts` (`next start` + `fetch(redirect:'manual')`: status 308 real e `Location` com a query; 404; estáticas 200).
- CA-4: `agendamento.test.ts` (tabela), `servico.test.ts` (POST direto: suspenso, pendente, suspensa, encerrada, cancelada sem acesso, sem serviço; nada gravado), `pagina.test.ts` (sem formulário), `acao.test.ts`.
- CA-5/CA-6: `pagina.test.ts` (elegíveis; igualdade com `consultarDisponibilidade`; "sem preferência"; lista de dias), nos dois fusos.
- CA-7/CA-8: `servico.test.ts`, `acao.test.ts`, `concorrencia.test.ts` (mesma chave em paralelo). CA-9: `concorrencia.test.ts` (2 e 10 envios).
- CA-10: `servico.test.ts`, `formulario.test.ts`, `FormularioDados.test.tsx`, E2E sem JS (valores preservados). CA-11: `servico.test.ts`. CA-13: `servico.test.ts`, `pagina.test.ts`. Cliente anonimizada: `servico.test.ts`. CA-12: E2E. CA-14: build e `http.test.ts`.

## 4. Desvios e riscos
- `eslint.config.mjs` (fora da posse): bloco desliga `@next/next/no-html-link-for-pages` só em arquivos de teste. Motivo: `/[slug]` casa `"/termos/"` (barra final), e a regra passou a reprovar `<a href="/termos">` de exemplo em 3 testes de componentes antigos. Produção continua sob a regra.
- `lerRotulosDaReserva` (repo) não está no desenho: a confirmação precisa do nome do serviço/profissional mesmo se desativado depois (a reserva guarda só o snapshot de preço e duração).
- `reservarPelaPagina` junta os erros de nome, telefone e aceite numa resposta só (o `criarReserva` para no primeiro grupo); `criarReserva` não foi alterado.
- Ordem dos serviços = ordem da lista (checkboxes sem JS não permitem reordenar); a URL preserva a ordem recebida.
- Server Action `redirect()` verificado pelo digest (`NEXT_REDIRECT`); o status HTTP 303 da resposta é do Next e não foi medido por requisição. O 308 do GET foi medido por HTTP real.
- `http.test.ts` constrói o app (`next build`) se não existir `.next`; com `.next` antigo, roda sobre ele (rode `npm run build` antes se a rota mudar).
- `Referrer-Policy` não declarado na rota (design §1). Sem schema, DBA/DevOps dispensados. Sem TODO pendente.
