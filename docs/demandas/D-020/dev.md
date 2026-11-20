# D-020 — Desenvolvimento: perfil público e horário de funcionamento do salão (issue #75, E2.6)

Entradas: `spec.md`, `design.md`, `dba.md` (T-0 do DBA: migração `20261120000000_perfil_funcionamento`, `schema.prisma`, `drift.test.ts`, `db/perfil-funcionamento.test.ts`, que não foram editados aqui).

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 núcleo da semana | `src/server/semana/{tipos,validacao,validacao.test,montagem,montagem.test}.ts` (novos); `src/server/jornadas/{tipos,validacao,semana}.ts` (fachadas); `src/server/jornadas/fachada.test.ts` (novo) |
| T-2 telefone, formatadores e rotas | `src/lib/telefone.ts` e `telefone.test.ts` (novos); `src/lib/format.ts` e `format.test.ts` (`formatarTelefone`, `formatarCep`, `formatarInteiro`); `src/config/navegacao.ts` e `navegacao.test.ts` (`configuracoesPerfil`, `configuracoesFuncionamento`, `devPerfil`, `devFuncionamento`) |
| T-3 perfil puro | `src/server/salao/perfil-tipos.ts`, `perfil-validacao.ts`, `perfil-validacao.test.ts` (novos) |
| T-4 funcionamento puro | `src/server/salao/funcionamento-tipos.ts`, `funcionamento-validacao.ts`, `funcionamento-validacao.test.ts` (novos) |
| T-5 repositórios | `src/server/repos/funcionamento.ts` (novo: `RepoFuncionamento`, `COLUNAS_FUNCIONAMENTO`, `funcionamentoDaLinha`); `repos/salao.ts` (`obterPerfil`, `atualizarPerfil`); `repos/publico.ts` (`lerPerfilPublico`, `lerFuncionamentoPublico`); `repos/index.ts`; `repos/tipos.ts` (`PerfilDTO`, `FuncionamentoLinhaDTO`, `FuncionamentoDTO`); `repos/index.test.ts`; `repos/servico.ts` e `repos/jornada.ts` (só o comentário da ordem de travas); `tests/integration/salao/repos-perfil-funcionamento.test.ts` (novo) |
| T-6 serviços, leitura e ações | `src/server/salao/{perfil,funcionamento,funcionamento-leitura,perfil.acao,funcionamento.acao}.ts` (novos); `tests/integration/salao/{apoio-perfil.ts,perfil.test.ts,funcionamento.test.ts,leituras.test.ts}` (novos) |
| T-7 editor de semana compartilhado | `src/app/painel/_componentes/semana/{formulario.ts,formulario.test.ts,CamposDaSemana.tsx,CamposDaSemana.test.tsx,ResumoDeErros.tsx,Semana.module.css}` (novos); `src/app/painel/profissionais/[id]/jornada/{FormularioJornada.tsx,estado.ts,Jornada.module.css}` |
| T-8 formulário do perfil | `src/app/painel/configuracoes/perfil/{estado.ts,FormularioPerfil.tsx,FormularioPerfil.test.tsx,Perfil.module.css}` (novos) |
| T-9 formulário do funcionamento | `src/app/painel/configuracoes/funcionamento/{estado.ts,FormularioFuncionamento.tsx,FormularioFuncionamento.test.tsx,Funcionamento.module.css}` (novos) |
| T-10 páginas e cascas | `src/app/painel/configuracoes/perfil/{page.tsx,acoes.ts}`, `src/app/painel/configuracoes/funcionamento/{page.tsx,acoes.ts,AvisoDoFuncionamento.tsx}` (novos); `src/app/painel/configuracoes/page.tsx` e `Configuracoes.module.css` (links); `tests/integration/salao/paginas-perfil-funcionamento.test.ts` (novo) |
| T-11 concorrência | `tests/integration/salao/concorrencia-perfil-funcionamento.test.ts` (novo) |
| T-12 demonstrações e E2E | `src/app/dev/perfil/{page.tsx,page.test.tsx,acoes.ts,acoes.test.ts,demonstracao.ts}`, `src/app/dev/funcionamento/{page.tsx,page.test.tsx,acoes.ts,acoes.test.ts,demonstracao.ts}` (novos); `e2e/{perfil,perfil-sem-js,funcionamento,funcionamento-sem-js}.spec.ts` (novos) |
| T-13 documentação | `README.md` (seção "Perfil público e funcionamento"); `CLAUDE.md` (parágrafo de status e duas linhas na tabela de comandos, a pedido do líder); este `dev.md` |

## 2. Comandos e resultados (2026-11-20, PostgreSQL 17 do compose)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | OK (cliente com `salaoFuncionamento` e as colunas do perfil) |
| `npm run lint` | OK, 0 avisos |
| `npm run typecheck` | OK |
| `npm run build` | OK; lista `/painel/configuracoes/perfil`, `/painel/configuracoes/funcionamento`, `/dev/perfil` e `/dev/funcionamento` (dinâmicas) |
| `npm run test:coverage` (= `npm test` + cobertura) | **231 arquivos, 3.134 testes, todos verdes.** Cobertura total: linhas **99,89%**, statements 99,43%, branches 98,2%, funções 99,59% (limiar 90%) |
| `npm run test:e2e` (build + todos os E2E) | **77 passed** (inclui os 4 specs novos e os da jornada) |
| `npx playwright test e2e/perfil.spec.ts e2e/perfil-sem-js.spec.ts e2e/funcionamento.spec.ts e2e/funcionamento-sem-js.spec.ts e2e/jornada.spec.ts e2e/jornada-sem-js.spec.ts` | 14 passed |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia-perfil-funcionamento.test.ts \|\| break; done` | **10/10 verdes** (8 testes por rodada; nenhum `deadlock detected`, 23P01 ou exceção) |
| `npx vitest run --project integration tests/integration/salao tests/integration/tenant tests/integration/db` | verde (inclui `salao/repos.test.ts`, `salao/paginas.test.ts` da D-017 e `tenant/registro.test.ts`, sem mudança) |
| `git diff --stat -- 'src/server/jornadas/*.test.ts' tests/integration/jornadas src/app/dev/jornada 'src/app/painel/profissionais/[id]/jornada/*.test.tsx' e2e/jornada.spec.ts e2e/jornada-sem-js.spec.ts` | **vazio** (CA-19, R-1, R-2) |
| `sh docker/smoke.sh` | 1ª tentativa: falha externa ao baixar o frontend do Dockerfile (`auth.docker.io` respondeu 522). 2ª tentativa: **OK** (`/api/health` 200 e `referrer-policy: strict-origin` nas duas páginas) |
| Passo manual com o compose (depois do smoke) | sem sessão, `/painel/configuracoes/perfil` e `/funcionamento` → 307 para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2F{perfil,funcionamento}`; `/dev/perfil` e `/dev/funcionamento` → 404 (vitrine desligada); a base do compose tem `salao.funcionamento_definido` e `salao_funcionamento`. Depois: `docker compose stop app worker` (estado anterior: só o postgres no ar) |

Regressão visual do `FormularioJornada` (A-7): além dos testes da jornada inalterados, rodei um teste temporário (apagado depois) que renderizou a versão de `HEAD` e a nova, sem e com erros, e comparou o `innerHTML` sem os atributos `class` (só o hash do CSS Module muda): idênticos. Plano B **não** foi necessário.

## 3. Testes criados e CAs

| CA | Testes |
|---|---|
| CA-1 | `repos-perfil-funcionamento.test.ts` (escopo, S1 × S2), `perfil.test.ts` e `funcionamento.test.ts` ("CA-1": gravação, leitura pública, profissional/super admin/sem credencial, `salaoId` forjado, salão inexistente → 404), `paginas-perfil-funcionamento.test.ts` (Acesso negado sem dados) |
| CA-2 | `telefone.test.ts`, `perfil-validacao.test.ts` (todos os casos), `perfil.test.ts` (amostra por campo e vários erros juntos) |
| CA-3 | `semana/validacao.test.ts`, `funcionamento-validacao.test.ts`, `funcionamento.test.ts` ("CA-3") |
| CA-4 | `funcionamento.test.ts` (sequencial: ids, `xmin`, `atualizado_em`), `concorrencia-perfil-funcionamento.test.ts` (×10 em paralelo) |
| CA-5 | `CamposDaSemana.test.tsx`, `FormularioPerfil.test.tsx`, `FormularioFuncionamento.test.tsx`, `e2e/{perfil,perfil-sem-js,funcionamento,funcionamento-sem-js}.spec.ts` |
| CA-6 | `funcionamento.test.ts` (fábrica e `criarSalaoComGestor` da D-011), `repos-perfil-funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts` ("Não informar" marcado) |
| CA-7 | `funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts` ("Fechado" ×7 e aviso) |
| CA-8 | `funcionamento-validacao.test.ts`, `funcionamento.test.ts` |
| CA-9 | `funcionamento.test.ts` |
| CA-10 | `funcionamento.test.ts` (reserva, itens, jornada, bloqueio e `mensagem` idênticos) |
| CA-11 | `funcionamento.test.ts` (troca de fuso pela ação da D-017), `paginas-perfil-funcionamento.test.ts` (exibe `09:00`) |
| CA-12 | `concorrencia-perfil-funcionamento.test.ts` (a, b, c e perfil × perfil, ×10) |
| CA-13 | `perfil.test.ts`/`funcionamento.test.ts` (`metadadosDaAcao`), `tenant/registro.test.ts` (sem mudança), `paginas-perfil-funcionamento.test.ts` (redirecionamento codificado, gestor com perfil de profissional) |
| CA-14 | `perfil-validacao.test.ts`, `repos-perfil-funcionamento.test.ts`, `perfil.test.ts` |
| CA-15 | `perfil-validacao.test.ts`, `FormularioPerfil.test.tsx`, `repos-perfil-funcionamento.test.ts`, `perfil.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-16 | `repos-perfil-funcionamento.test.ts`, `leituras.test.ts` (conjunto exato de chaves, suspenso) |
| CA-17 | `repos-perfil-funcionamento.test.ts`, `leituras.test.ts` (tenant, sistema, público; S1 × S2; Admin/forjado → Error) |
| CA-18 | `telefone.test.ts`, `format.test.ts`, `format.fonte-unica.test.ts` (sem mudança) |
| CA-19 | testes da jornada sem mudança (diff vazio), `fachada.test.ts` (cópia literal de `MENSAGENS_JORNADA` e `LIMITES_JORNADA`) |
| CA-20 | `navegacao.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| R-3, R-5, R-9 | `concorrencia-perfil-funcionamento.test.ts` (leitura pública nunca vê estado misto; bloqueio criado sem esperar a trava; gravação e `UPDATE` do perfil esperam a trava), `perfil.test.ts` (log sem telefone, CEP nem descrição) |

## 4. Desvios do desenho e riscos

Desvios (pequenos, sem mudar interfaces de §3 usadas por outras demandas):
1. `EstadoFuncionamento` ganhou o campo opcional `funcionamento` (preenchido no sucesso). Com JS, os resumos dos dias usam a semana recém-gravada sem esperar a revalidação; na demonstração, que não revalida, é a única forma de atualizar os resumos.
2. `MENSAGENS_FUNCIONAMENTO.diaNaoInformado` ("Não informado") é o resumo de cada dia enquanto o funcionamento não foi informado. Com o funcionamento informado, o dia vazio mostra "Fechado", como pede a RN-19. Mostrar "Fechado" com "Não informar" contradiria a RN-13.
3. `formatarInteiro` em `src/lib/format.ts`, para o contador "N de 1.000 caracteres" (a formatação de número fica só nesse arquivo).
4. O aviso da página do funcionamento está em `funcionamento/AvisoDoFuncionamento.tsx`, porque um `page.tsx` do Next não pode exportar componentes extras. A página real e a demonstração reutilizam o componente.
5. `perfil-tipos.ts` também exporta `CAMPOS_TEXTO_PERFIL`, `CAMPOS_PERFIL` e `VALORES_PERFIL_VAZIOS`, e `semana/validacao.ts` exporta `FORMULARIO_INVALIDO`, que a fachada da jornada reutiliza. As demonstrações têm um `demonstracao.ts` com os dados de exemplo, como a D-017.
6. A `key` do `<form>` é derivada de `JSON.stringify` dos valores (perfil) ou do modo e dos valores (funcionamento), conforme a A-9.

Riscos conhecidos:
- `lerFuncionamento` aceita um objeto com `tipo` válido e `salaoId` UUID mesmo sem as fábricas de contexto. Isso vale para todas as guardas existentes (`exigirEscopo`/`exigirPublico`), cuja marca nominal é só de tipo. O teste cobre AdminContext, tipo desconhecido e `salaoId` malformado.
- O smoke do Docker depende do Docker Hub, que deu 522 na primeira tentativa (falha externa, não do código).
- O funcionamento ainda não limita a disponibilidade: isso é da E3.1, que deve usar `lerFuncionamento` ou `COLUNAS_FUNCIONAMENTO` (obrigação registrada no `CLAUDE.md` e no README).

Nenhum TODO pendente no código.
