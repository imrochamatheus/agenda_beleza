# D-045 (E8.3) testes

## Rodada 1 (tester) - Veredito: APROVADO (1 defeito baixo, visual)

Ambiente: branch feat/d-045-admin-eventos-fila (nao commitada), Node 24, PostgreSQL 17 (compose), Chromium 375x812. Build e E2E numa COPIA temporaria na porta 3200 (a 3000 e do next dev do usuario, intocado; docker/smoke.sh nao rodado).

## Gates (reexecutados)
- lint 0 avisos; typecheck ok; build ok.
- `npm run test:coverage`: 562 arquivos, 6587 testes passando; linhas 98,91% (limiar 90).
- Unit em TZ=UTC e TZ=America/Sao_Paulo (src/server/admin, format, src/app/admin, mensagens, ui): 512/512 em ambos.
- Integracao admin + mensagens + auth/admin: 373/373. `concorrencia-reenvio` x10: 4/4 todas as vezes (sem impasse, 1 chamada ao adaptador, 1 auditoria).
- E2E (porta 3200): admin-mensagens, admin-mensagens-sem-js, admin-saloes, a11y-base: 93/93 (axe, teclado, sem JS, sem rolagem horizontal, selo em 1 linha em 768/1280 incl. lista de saloes).

## CA-1..CA-16
Todos passaram (evidencia: tests/integration/admin/{assinatura,reenvio,concorrencia-reenvio,mensagens-lista,auditoria,plano,paginas}.test.ts e e2e/admin-mensagens*.spec.ts). Destaques verificados por mim:
- 401 sem sessao; 403 para gestor, profissional e admin sem TOTP, nas 3 paginas e na acao (nao toca a mensagem, nao audita). 401 redireciona a /admin/entrar sem `?proximo=` (igual a D-044; aceitavel).
- Leitura nao audita (CA-7). Reenvio so de `falhou`; `enviada`/obsoleta recusadas sem auditar; cliente anonimizada audita (`cancelada_anonimizacao`).
- Teste proprio `tests/integration/admin/tester-d045.test.ts` (adicionado): gatilho de banco que rejeita INSERT em `auditoria` de `mensagem.reenviar` => mensagem continua `falhou`, zero enqueue, zero linha; admin sem TOTP nas paginas nao ve dados; XSS em antes/depois e e-mail do ator renderiza como texto escapado.
- Vazamento: HTML/DTO sem E.164, parametros, link do convite, provedor_mensagem_id, erro_detalhe, nome da cliente (paginas.test e mensagens-lista.test); mascara `+55 (71) 9****-1234`.
- CA-15 (100 mil mensagens / 200 mil auditorias): fila/auditoria bem abaixo de 300 ms, CTE MATERIALIZED (sem count(*) OVER sobre JOIN). Periodo por dia civil America/Sao_Paulo com virada 02:30 UTC testado em ambos os fusos.

## Revisao visual
Capturas minhas 375/768/1280 (fora do repo, scratchpad/shots): mensagens, auditoria, assinatura, lista de saloes.
- Selos icone+texto sem quebra de linha (incl. coluna Assinatura em /admin/saloes); hierarquia h1/caption/h2 ok; nenhuma cor literal fora do :root (grep em src/app/admin e DataList.module.css); foco e AA cobertos pelo axe (zero violacoes); sem rolagem horizontal; sem JS ok; diff Antes/Depois legivel e JSON recolhido.
- DEF-1 (baixa, aberto): em 768 px a coluna "Gestor" da lista de saloes (D-044) fica estreita e o e-mail quebra por caractere ("gestor0 / 1@exe / mplo.c / om.br"). Em 375 e 1280 ok. Sugestao: dar mais largura a coluna ou `overflow-wrap: anywhere` so como ultimo recurso com `min-width`. Nao bloqueia.

## Pendencias / observacoes
- DEF-1 acima (baixa). Sem defeito critico/alto/medio. Sem classe de falha recorrente.
- `admin-entrar.spec.ts:93` fixa :3000 (artefato conhecido, nao e defeito).
