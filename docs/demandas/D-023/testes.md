# D-023 — Testes: Termos, Privacidade e consentimento versionado por finalidade (E4.3)

## Rodada 1 — Tester independente

Ambiente: branch `feat/d-023-termos-consentimento` (árvore sem commit), Node 24, PostgreSQL do `docker compose` (só o postgres no ar), `npm run db:generate` executado, adaptadores simulados, Chromium 375×812. Todos os comandos foram reexecutados por mim.

### Gates

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | passou, 0 avisos |
| Typecheck | `npm run typecheck` | passou |
| Build | `npm run build` | passou; `/termos` e `/privacidade` marcadas `○` (estáticas), `/dev/consentimento` `ƒ` (CA-21) |
| Vitest + cobertura | `npm run test:coverage` | 308 arquivos, 3887 testes passando; linhas **99,78%** (limiar 90%); `src/server/consentimento` 95,83%; sem exclusão nova |
| E2E | `npm run test:e2e` | 112 passed (inclui consentimento, consentimento-sem-js e termos-privacidade) |
| Estabilidade (CA-15) | laço ×10 de `tests/integration/consentimento/concorrencia.test.ts` | 10 de 10, 5 testes passando em cada |
| Fuso | `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/consentimento` e `src/config/termos.test.ts` | 49 testes passando em cada |
| Migração | SQL das migrações anteriores numa base limpa, uma linha legada inserida, depois a migração D-023; `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | migração aplica; linha legada ficou `finalidade='mensagens_reserva'`; padrão da coluna removido; "No difference detected" |

Revisão da cobertura: exclusões inalteradas; os testes novos fazem asserções de comportamento (linhas, códigos SQL, contagens, fotografias `to_jsonb`), não apenas executam linhas.

### Exploratório (testes temporários, apagados ao fim)

Integração contra PostgreSQL real, 7 testes, todos passaram:
- Equipe (gestor e profissional): convite marcado é ignorado e só grava `mensagens_reserva` com origem `equipe`, versão `VERSAO_TERMOS` e `criado_em` = `agora`; `temConsentimentoDeMensagens` verdadeiro após origem equipe.
- Público: convite desmarcado não grava; as duas marcadas ('on') gravam duas linhas; só o convite devolve `{ ok: false }` sem linha.
- Origem × contexto (gestor com `publico`, sistema com `equipe`), finalidade fora do enum, equipe com `convite_avaliacao`, `agora` inválido: `RangeError` e nenhuma linha. Campo `versaoTermos` forjado pelo chamador é ignorado (a linha leva a versão do config).
- Outro salão (registro por gestor e por sistema, consulta) e UUID malformado: `NaoEncontrado`, contagem do salão inalterada.
- Cliente anonimizada: registro recusado, `consentimentoVigente` null, `temConsentimentoDeMensagens` false, linha antiga preservada.
- Rollback da transação (com `r` do chamador) não deixa linha.
- Volume de 20.000 linhas + ANALYZE: a consulta de vigente usa `Index Only Scan using consentimento_vigente_idx`, sem Seq Scan nem Sort.

Banco: os CHECKs (`22P02`, `23502`, `23514` de origem × finalidade e de versão) estão cobertos pelo `banco.test.ts` do desenvolvedor, que passou na suíte completa.

Guarda de texto (CA-17): alterei um texto de consentimento em `src/config/termos.ts` e outro em `termos-documentos.ts`; nos dois casos `src/config/termos.test.ts` falhou com "Os textos mudaram sem nova versão. Mude VERSAO_TERMOS e registre o hash … em HASHES_POR_VERSAO." Arquivos restaurados, 7 testes passando de novo.

Páginas (servidor de produção, HTML real): `/termos`, `/privacidade` e `/dev/consentimento` respondem 200; cada documento tem `h1`, "Versão 2026-11-21-provisorio" e o aviso de provisório; rodapé com links para `/termos` e `/privacidade`; `/privacidade` tem `id="avaliacoes"` e cita nota, comentário, primeiro nome + inicial, "não compareceu", anonimização, moderação, denúncia ("Qualquer visitante pode denunciar uma avaliação") e que o gestor não edita nem apaga avaliações. Na vitrine, os links das caixas têm `target="_blank" rel="noopener"` e o aviso "abre em nova aba".

Teclado, axe 4.14.0, sem rolagem horizontal e sem JavaScript: cobertos pelos três specs E2E, que passaram.

### Status por CA

| CA | Status | Evidência |
|---|---|---|
| CA-1 | passou | `validacao.test.ts`, `registro.test.ts` (contagem inalterada); exploratório |
| CA-2 | passou | `registro.test.ts`; exploratório (versão, UTC, salão e cliente) |
| CA-3 | passou | `paginas.test.tsx`; E2E; HTML real |
| CA-4 | passou | `termos.test.ts`, `paginas.test.tsx` |
| CA-5 | passou | unidade, `registro.test.ts`, E2E; exploratório |
| CA-6 | passou | `paginas.test.tsx`; E2E (âncora por clique e teclado); HTML real |
| CA-7, CA-8, CA-9 | passou | `registro.test.ts`; exploratório |
| CA-10 | passou | `isolamento.test.ts`; exploratório |
| CA-11 | passou | `anonimizada.test.ts`; exploratório |
| CA-12 | passou | `transacao.test.ts`; exploratório |
| CA-13, CA-14 | passou | `versao.test.ts`, `vigente.test.ts` |
| CA-15 | passou | laço ×10 |
| CA-16 | passou | `banco.test.ts`, drift, migração com linha legada |
| CA-17 | passou | teste de guarda falha com mensagem clara ao mudar texto |
| CA-18, CA-19 | passou | 11 E2E novos |
| CA-20 | passou | `slug.test.ts`, `navegacao.test.ts` |
| CA-21 | passou | build (`○`), lint, `servico.test.ts`, `conformidade.test.ts` |

### Defeitos

Nenhum.

Observações (não são defeitos): o texto jurídico é provisório por decisão, com revisão jurídica pendente antes de produção; o `NaoEncontrado` de id malformado só é provado na integração (já declarado em `dev.md`); a ordem de validação em `registrarConsentimentoDaReserva` devolve `{ ok: false }` para aceite inválido antes de checar a coerência origem × contexto, o que é aceitável pelo contrato (nada é gravado em nenhum caso).

### Complemento (teste de plano acrescentado após a entrega)

`tests/integration/consentimento/vigente.test.ts` ganhou um teste de plano (200 clientes x 25 aceites, ANALYZE, EXPLAIN da consulta de vigente com asserção de uso de `consentimento_vigente_idx` e ausência de Seq Scan e Sort). Reexecutei: 4 testes passando; ele já entra no `test:coverage` medido acima (3887 testes). Confirma de forma independente o meu EXPLAIN exploratório. Observação: `dev.md` está desatualizado nesse ponto (não lista esse teste); não é defeito de produto e não altera o veredito.

### Limpeza

Testes temporários e a base `zz_d023_mig` removidos; servidor `next start` encerrado (porta 3000 livre); só o postgres no ar; arquivos de configuração restaurados após a prova da guarda.

## Veredito: APROVADO

Todos os CAs passaram, todos os gates passaram, cobertura 99,78% (≥ 90%), sem defeito aberto.
