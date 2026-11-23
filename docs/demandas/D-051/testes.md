# D-051 (E4.1b, issue #113): relatório do tester

## Rodada 1 (23/11/2026)

**Veredito: APROVADO**

### Ambiente

- Branch `feat/d-051-dia-horario-mesma-pagina`, base `main` `fea38c0`. As mudanças estão no working tree, sem commit.
  Testei um snapshot dele (`rsync` para o scratchpad do tester). Ao fim da rodada, conferi com `diff -rq` que o
  repositório continuava idêntico ao snapshot (a única diferença era `tsconfig.tsbuildinfo`).
- Node 24.21.0 e PostgreSQL 17 (`agenda_beleza-postgres-1`, compose). Adaptadores simulados.
- Não havia `next dev` do usuário no repositório: os `next-server` ativos eram de cópias de outros agentes, nas portas
  3108, 3207 e 3917. Um `playwright test-server` ocioso estava aberto no repositório. A porta 3000 estava livre, e
  rodei um Playwright por vez.
- Comparei com a `main`, extraída por `git archive main` com o mesmo `node_modules`.

### Gates

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | verde (0 avisos) |
| Typecheck | `npm run typecheck` | verde |
| Cobertura | `npm run test:coverage` | 4ª execução verde: 604 arquivos, 7350 testes, **linhas 99,03%** (stmts 98,38, branches 96,32, funcs 99,32). As execuções 1, 2 e 3 falharam, cada vez com **1** teste instável preexistente e alheio à demanda (DEF-1, DEF-2) |
| E2E completo | `npm run test:e2e` (build + preparar banco + Playwright, porta 3000) | **387/387 verdes** em 1,5 min, numa única execução da suíte inteira, já com a correção do desenvolvedor nos 2 specs novos |
| Laço de fuso | `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reserva-publica "src/app/(publico)/[slug]/_componentes/faixa.test.ts" src/lib/format.test.ts src/components/ui/FaixaDeDias.test.tsx …` | 233/233 nos dois fusos |
| Estabilidade ×10 | `for i in $(seq 10); do npx vitest run --project integration tests/integration/reserva-publica/faixa.test.ts tests/integration/reserva-publica/passos.test.ts tests/integration/protecao/pagina-limite.test.ts …` | 10/10 rodadas verdes, 32 testes cada |
| Migrações, env, CI | — | não se aplicam: não há migração, `.env.example`, `vitest.config.ts` (exclusões) nem `.github` alterados |
| Documentação | `CLAUDE.md` | parágrafo D-051 e 2 linhas na tabela de comandos; o README não descreve o passo `data` |

### Critérios de aceitação

| CA | Situação | Evidência |
|---|---|---|
| CA-1 | passou | `PaginaDoSalao.test.tsx`, `faixa.test.ts`. E2E vitrine e banco. Captura `real-sem-dia-375`: "Serviço 1 de 2", `h2` "Escova", resumo com total e régua de hoje a hoje+6 |
| CA-2 | passou | `FaixaDeDias.test.tsx` (`<span>` fora do Tab, nome "…, sem horários"). Captura: "Hoje 23" riscado depois das 20h, sem link |
| CA-3 | passou | `passos.test.ts` (janela 60: a 9ª semana tem 5 dias; janelas 1 e 7). E2E vitrine (sem "Semana anterior" na semana 0 e sem "Próxima semana" na última) |
| CA-4 | passou | E2E vitrine e banco. Captura `vitrine-sem-dia`: sem grade, filtro, botão nem roteiro, nenhum `aria-current` |
| CA-5 | passou | integração `faixa.test.ts` (fluxo) e E2E `publico-faixa-dias`. Captura `real-com-dia-375`: Ter 24 marcado e horários por profissional abaixo |
| CA-6 | passou | `fluxo-itens.test.ts`, `publico-reserva.spec.ts` e passos k ≥ 1 sem régua (critério 18) |
| CA-7 | passou | revisão de `hrefDoDia`/`hrefDaSemana` (só `s`+`data` ou `s`+`de`, mais `#reservar`). E2E vitrine "a partir de Alterar do item 0" |
| CA-8 | passou | as 9 linhas da RN-12 em `lerPasso` (unitário) e em `carregarPasso` (integração), e o E2E com HTTP 200 |
| CA-9 | passou | integração e E2E `publico-faixa-dias` |
| CA-10 | passou | `hrefOutroDia` com `de = data` e `#reservar`. E2E critério 18 |
| CA-11 | passou | `sem_selecao` e item 0 caído (integração). Aviso antes da régua (jsdom e E2E). `publico-conflito-captcha` verde |
| CA-12 | passou | 6 instruções na semana vazia, sem salto (integração). Vitrine `?vista=semana-vazia` com axe. Captura `crop-vazia-375`: "Nenhum dia desta semana tem horário" e "Próxima semana" |
| CA-13 | passou | (a) sem JS: `publico-reserva` (banco) e `reserva-publica-sem-js`, mais o critério 17. (b) teclado: `publico-reserva-teclado`, `reserva-publica`, `tester-d050`. (c) 375×812 `isMobile`/`hasTouch`, medido também por mim. (d) axe nos 3 estados |
| CA-14 | passou | `faixa.test.ts`: `'dia'` = 6, semana navegada = 6, serviço 0 = 12 (com e sem `alterar=0`), k ≥ 1 = 6, dados = 6, item 0 caído = 12, item k ≥ 1 caído = 6, na matriz 1/3/10 serviços × 1/8 profissionais × com e sem itens; uma cota por carregamento nos 4 formatos; limitado = 1 comando. `pagina-limite.test.ts`: o HTML limitado não tem régua. Revisão de `pagina.ts`: as chamadas são sequenciais e `carregarFaixa` usa ≤ 7 datas |
| CA-15 | passou | laço de fuso (dois `TZ`). Integração com `America/Manaus` e `America/Noronha`, ±5 min da meia-noite |
| CA-16 | passou | os `href` só têm chaves `s`/`data`/`de` (unitário). Varredura das URLs no E2E banco |
| CA-17 | passou | as 3 vistas de `/dev/reserva` (`dados.test.ts`, `page.test.tsx`, E2E). Fora da vitrine é 404 (teste existente, verde) |
| CA-18 | passou | E2E 387/387 e integração completa verde. Revisei o diff dos specs adaptados: só a navegação até o dia mudou, e nenhuma asserção foi removida sem substituta (o teste DA-2 de 14 dias virou o de 7 dias com as mesmas regras) |

### Critérios visuais (web-design §9), em 375, 768 e 1280 px

Capturas e medições minhas, com o build do snapshot, em `/dev/reserva` (passo 0 sem dia, com dia e semana vazia) e
em `/e2e-reservas-5` (página real, sem dia e com dia). Ficaram no scratchpad do tester, `shots/`.

| # | Resultado |
|---|---|
| 1 | `scrollWidth == clientWidth` do documento em todas as 15 telas |
| 2 | 375 px: invólucro com `scrollWidth` 341 = `clientWidth` 341, sem rolagem interna |
| 3 | 375 px: dias de 48–49 × 77 px. 768 e 1280 px: régua de 576 px (≤ 36rem) |
| 4 | E2E 320 px verde (rolagem interna, Tab até o 7º dia, axe na semana vazia) |
| 5, 8 | Na captura: "Ter / 24 / nov", número em serifa e dia sem horário riscado sobre `--cor-superficie-alt` |
| 7 | Em escala de cinza (`vitrine-com-dia-cinza-*`), o dia selecionado aparece como bloco escuro com texto claro, distinguível dos vizinhos |
| 6, 9–14, 16–19 | E2E `reserva-publica-faixa.spec.ts` verde. Critério 14 medido também por mim: depois do link de um dia, o `h2` fica entre 32 e 71 px do topo em todas as larguras |
| 15 | Testes de conformidade de CSS verdes na suíte |

### Defeitos

Nenhum defeito da D-051. Os dois abaixo são instabilidades **preexistentes**, em testes e código que esta demanda
não alterou. Eles fazem o gate de cobertura falhar de forma intermitente e ficam registrados para uma demanda
própria.

```
DEF-1 — Corrida em AcoesDaReserva.test.tsx "DEF-1: item de profissional inativo…"   Severidade: média   Estado: aberto (fora da D-051)
CA relacionado: — (gate de cobertura; teste da D-050)
Ambiente: snapshot da branch, node 24.21.0, postgres 17, `npm run test:coverage` (unit e integração juntos, máquina carregada)
Passos para reproduzir: 1. npm run test:coverage (falhou na 1ª e na 2ª execução; passou na 3ª e na 4ª)
Resultado esperado: verde
Resultado observado: AssertionError: expected null to be 'true' em AcoesDaReserva.test.tsx:185 (aria-invalid)
Classe de falha: teste assíncrono com corrida. `findByRole('combobox')` resolve na hora com o select que já existia,
antes de o `useActionState` reapresentar o estado com erro. A correção é esperar o próprio `aria-invalid` (`waitFor`).
Isolado, o teste passa (15/15 na main, 15/15 na branch, suíte unit inteira verde nas duas). Nem o teste nem o
componente aparecem no diff da D-051.
```

```
DEF-2 — Falso positivo em protecao/reserva-publica.test.ts "CA-9: nenhuma linha … em claro"   Severidade: baixa   Estado: aberto (fora da D-051)
CA relacionado: — (D-027)
Ambiente: idem; 3ª execução do test:coverage
Passos para reproduzir: depende do acaso: a chave HMAC hex aleatória contém a substring "5511"
Resultado esperado: verde
Resultado observado: expected 'pub:reserva:tel:98f52d…cf3a5511fc38…' not to contain '5511'
Classe de falha: asserção probabilística. Um hash hex de 64 caracteres contém "5511" com probabilidade ~0,1% por
chave. A correção é comparar com o E.164 inteiro (ou com os dígitos completos do telefone), não com um prefixo de
4 dígitos.
```

**Instabilidade da auditoria citada pelo desenvolvedor** (`tests/integration/auditoria/auditoria.test.ts` CA-8): é
preexistente pela natureza do código. `linhasDeAuditoria` ordena por `ocorrido_em, id`, com `id` UUID aleatório, então
um empate de `ocorrido_em` entre as duas inserções troca a ordem. Nem o teste, nem o suporte, nem o repositório estão no
diff da D-051. Na main, não reproduziu em 20 execuções isoladas, e não apareceu em nenhuma das minhas 4 execuções
completas da branch. Recomendo a mesma demanda curta (desempate determinístico).

Observação sobre a `main`: um `test:coverage` completo no snapshot da `main` falhou em `seed/producao.test.ts` e
`reserva-publica/http.test.ts`, por falta de `dist/` e `.next` na extração por `git archive`. É artefato do meu
snapshot e não foi considerado. Nessa execução, o DEF-1 passou.

### Pendências

- DEF-1 (média) e DEF-2 (baixa), fora da D-051: sugiro uma demanda curta de higiene de testes, que pode incluir o
  desempate da auditoria.
- R-5 (WCAG 2.5.3, nome acessível × texto curto) foi aceito no desenho e não muda o veredito.
