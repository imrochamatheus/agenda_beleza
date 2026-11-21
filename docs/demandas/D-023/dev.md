# D-023 — Desenvolvimento: Termos, Privacidade e consentimento versionado por finalidade (E4.3)

Responsável: desenvolvedor (T-2 a T-7). T-1 (migração, schema, drift) é do DBA (`dba.md`). Sem DevOps. Sem commit.

## 1. Tarefas concluídas

| Tarefa | Arquivos |
|---|---|
| T-2 config, documentos e páginas | `src/config/{termos,termos-documentos}.ts`, `src/config/termos.test.ts`, `src/app/(publico)/{termos,privacidade}/page.tsx`, `src/app/(publico)/_documento/{Documento.tsx,Documento.module.css,paginas.test.tsx}`, `src/lib/format.ts` (+ `formatarDataCivil`) e `format.test.ts`, `src/lib/slug.test.ts` (CA-20 nominal) |
| T-3 domínio, repositório, serviço, leitura, fábrica | `src/server/consentimento/{tipos,validacao,formulario,servico,leitura}.ts` (+ `validacao`, `formulario`, `servico` testes), `src/server/repos/consentimento.ts`, `repos/tipos.ts` (`ConsentimentoDTO`), `repos/index.ts` e `index.test.ts` (`Repos.consentimentos` nas duas listas de escopo), `repos/servico.ts` (só a linha `→ cliente → consentimento` no cabeçalho de travas), `tests/support/factories.ts` (`criarConsentimento`) |
| T-4 componente, vitrine, rotas | `src/components/consentimento/{CaixasConsentimento.tsx,CaixasConsentimento.test.tsx}`, `src/app/dev/consentimento/{page,acoes,estado,FormularioConsentimento}` + testes, `src/config/navegacao.ts` (`devConsentimento`) e `navegacao.test.ts` |
| T-5 integração | `tests/integration/consentimento/{apoio,registro,isolamento,anonimizada,transacao,versao,vigente,banco,concorrencia}` |
| T-6 E2E | `e2e/{termos-privacidade,consentimento,consentimento-sem-js}.spec.ts` |
| T-7 documentação | `README.md` (seção "Termos, Privacidade e consentimento"), `CLAUDE.md` (parágrafo D-023 e três linhas de comandos), este arquivo |

## 2. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | passou (0 avisos) |
| `npm run typecheck` | passou |
| `npm run build` | passou; `/termos` e `/privacidade` marcadas `○` (estáticas), `/dev/consentimento` `ƒ` (CA-21) |
| `npm run test:coverage` | 308 arquivos, **3886 testes passando**; linhas **99,78%** (limiar 90%) |
| `npm run test:e2e` | **112 passed** (inclui os 11 novos) |
| `npx playwright test e2e/termos-privacidade.spec.ts e2e/consentimento.spec.ts e2e/consentimento-sem-js.spec.ts` | 11 passed (teclado, axe 4.14.0 sem violações, sem rolagem horizontal, sem JS) |
| Laço ×10 de `tests/integration/consentimento/concorrencia.test.ts` | 10 de 10 execuções com 5 testes passando |
| `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/consentimento`, `src/config/termos.test.ts` | 49 testes passando em cada; `format.test.ts`/slug/termos também iguais nos dois fusos |
| `npx vitest run --project integration tests/integration/consentimento` | 6 arquivos (sem a concorrência), 40 testes + banco (12) passando |

## 3. Testes e CAs cobertos

| CA | Teste |
|---|---|
| CA-1 | `server/consentimento/validacao.test.ts` (tabela), `servico.test.ts` (sem banco), `integration/consentimento/registro.test.ts` (contagem inalterada) |
| CA-2 | `registro.test.ts` (1 linha, versão, `criado_em` UTC, salão e cliente) |
| CA-3 | `_documento/paginas.test.tsx`, `e2e/termos-privacidade.spec.ts` (200 pelo rodapé) |
| CA-4 | `config/termos.test.ts` (grep do literal), `paginas.test.tsx` (`vi.doMock` da versão) |
| CA-5 | `formulario.test.ts`, `CaixasConsentimento.test.tsx`, `dev/consentimento/acoes.test.ts`, `registro.test.ts`, `e2e/consentimento.spec.ts` |
| CA-6 | `paginas.test.tsx`, `e2e/termos-privacidade.spec.ts` (âncora por clique e teclado) |
| CA-7, CA-8, CA-9 | `registro.test.ts`, `validacao.test.ts`, `servico.test.ts` |
| CA-10 | `isolamento.test.ts` (duas fábricas, mesmo telefone) |
| CA-11 | `anonimizada.test.ts` |
| CA-12 | `transacao.test.ts` (rollback, `23P01` real, confirmação) |
| CA-13 | `versao.test.ts` (`deps.versaoVigente`) |
| CA-14 | `vigente.test.ts` (incl. empate de `criado_em`) |
| CA-15 | `concorrencia.test.ts` (10 paralelos; com `upsert` e edição de telefone; 3 casos determinísticos por `pg_stat_activity`) |
| CA-16 | `banco.test.ts` (`22P02`, `23502`, `23514`, backfill reaplicando o SQL da migração numa transação desfeita) + drift do DBA |
| CA-17 | `config/termos.test.ts` (hash por versão) |
| CA-18, CA-19 | `e2e/consentimento.spec.ts`, `e2e/consentimento-sem-js.spec.ts`, `e2e/termos-privacidade.spec.ts` |
| CA-20 | `lib/slug.test.ts`, `config/navegacao.test.ts` |
| CA-21 | `servico.test.ts` (sem `'use server'`/`next/`), `dev/consentimento/acoes.test.ts` (sem repositório), `conformidade.test.ts`, lint, build |

## 4. Desvios do desenho e riscos

- **`CAMPOS_CONSENTIMENTO` mora em `src/config/termos.ts`** (reexportado por `server/consentimento/tipos.ts`). Motivo: `src/components/conformidade.test.ts` proíbe `@/server` em tempo de execução nos componentes. Nenhum contrato muda; fica fora do hash (não é texto).
- Classe de texto oculto: usada a global `visualmente-oculto` (já existente) em vez de `so-leitor`.
- `registrarConsentimento` sem `r` abre a transação antes do repositório validar o UUID; o `NaoEncontrado` de id malformado só é provado na integração (`isolamento.test.ts`), não na unidade.
- Texto jurídico segue provisório (R-6): revisão jurídica antes de produção; trocar o texto exige nova `VERSAO_TERMOS` e entrada nova em `HASHES_POR_VERSAO`.
- Cobertura do diretório `.../consentimento` no relatório (95,83% de linhas) está acima do limiar; sem exclusões novas.
- Sem TODO pendente.
