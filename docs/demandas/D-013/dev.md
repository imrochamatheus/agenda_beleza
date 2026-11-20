# D-013 — Desenvolvimento (T-1 a T-7)

Branch `feat/d-013-profissionais` (base `main` 3a3bd1b). Nada commitado. Sem migração, variável de ambiente nem dependência nova.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 núcleo, rotas e contratos | `src/server/tenant/define-acao.ts` (`ExecucaoAcao`; `agora` calculado uma vez e entregue congelado ao handler), `tests/integration/tenant/define-acao.test.ts` (+2 casos), `src/server/auth/pagina.ts` (`operacao?`), `tests/integration/auth/pagina-operacao.test.ts` (novo), `src/config/navegacao.ts` (`novoProfissional`, `profissional(id)`), `src/config/navegacao.test.ts`, `src/lib/texto.ts` + `texto.test.ts` (novos; `normalizarNome` extraído), `src/server/auth/cadastro.ts` (usa `normalizarNome`), `src/server/profissionais/tipos.ts` (novo) |
| T-2 repositórios | `src/server/repos/profissional.ts` (criar, listarParaPainel, buscarParaPainel, listarAtivos, travarParaAlteracao `FOR UPDATE OF p`, atualizarDados, aplicarDesativacao, reativar, garantirPerfilDoGestor com `ON CONFLICT DO NOTHING`; cabeçalho com a ordem de travas), `src/server/repos/reserva.ts` (`listarBloqueantesDeDesativacao`), `src/server/repos/sessao.ts` (executor opcional em `revogarSessoesDoUsuario`), `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/profissionais/repos.test.ts` |
| T-3 validação, serviço e ações | `src/server/profissionais/{validacao.ts, validacao.test.ts, servico.ts, profissionais.acao.ts}`, `tests/integration/profissionais/{criar-editar, desativar, eu-tambem-atendo, isolamento-permissoes}.test.ts` |
| T-4 concorrência | `tests/integration/profissionais/concorrencia.test.ts` |
| T-5 componentes cliente | `src/app/painel/profissionais/{estado.ts, FormularioProfissional.tsx/.module.css/.test.tsx, ListaProfissionais.tsx/.test.tsx, ControleAtivacao.tsx/.test.tsx, EuTambemAtendo.tsx/.test.tsx, Profissionais.module.css}` |
| T-6 páginas e casca | `src/app/painel/profissionais/{page.tsx, acoes.ts}`, `novo/page.tsx`, `[id]/page.tsx`, `tests/integration/profissionais/paginas.test.ts` |
| T-7 documentação | `README.md` (seção "Profissionais"), este arquivo |

Arquivo de apoio novo, fora da lista do desenho: `tests/integration/profissionais/apoio.ts` (helpers SQL locais: contextos, reserva com itens, convites, fotografia do salão). Não é `*.test.ts`; não mexe em `tests/support/**`.

## 2. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1 gerado); typecheck e lint repetidos em seguida, verdes |
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou; rotas `ƒ /painel/profissionais`, `ƒ /painel/profissionais/[id]`, `ƒ /painel/profissionais/novo` |
| `npm test` ×3 seguidas | 3× verde: 159 arquivos, 2065 testes |
| `npm run test:coverage` | verde; **linhas 99,86 %** (2140/2143); statements 99,31 %. Único trecho novo não coberto: `servico.ts:164` (guarda `ctx.papel !== 'gestor'` em `euTambemAtendo`, inalcançável porque `exigirPermissao('profissional.gerir')` já recusa outros papéis; mantida por pedido do desenho, defesa em profundidade) |
| `npm run test:e2e` | 48 passaram (sem E2E novo, D-11) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/profissionais/concorrencia.test.ts \|\| break; done` | 10/10 verdes (4 testes cada); `deadlock` ausente nos 10 logs |
| `npx vitest run --project integration tests/integration/tenant/registro.test.ts` | verde com as 5 ações reais |

### Passo manual de teclado (CA-16), viewport 375×812

Executado com Chromium (Playwright, script descartável fora do repositório) contra `npm run start` + PostgreSQL de desenvolvimento, **só com teclado** depois do login (Tab/Shift+Tab, Enter, Espaço, Esc):
- lista vazia (estado vazio) → Tab até "Eu também atendo" → Enter: perfil criado, lista mostra "Você";
- Tab até "Cadastrar profissional" → Enter → Enter com nome vazio mostra o erro no campo → digita nome e `ANA.Teclado@Exemplo.com` → Espaço em "Cadastrar profissional": volta à lista (banco grava `ana.teclado@exemplo.com`);
- Tab até o link do nome → Enter → edita o nome → Enter em "Salvar alterações";
- com reserva futura confirmada: Enter em "Desativar" abre o diálogo com foco em Cancelar; Tab cicla dentro do diálogo; Esc fecha e devolve o foco a "Desativar"; Espaço reabre, Tab + Enter confirma → recusa em `role="alert"`: "Não é possível desativar: há reservas futuras confirmadas… 22/11/2026 07:31 — Corte — Clara Teste" (hora local de São Paulo); banco continua `ativo = true`;
- reserva cancelada: Enter → Tab → Enter desativa (a página se atualiza pela revalidação e mostra "Reativar"); Espaço em "Reativar" reativa;
- nenhuma das três páginas tem rolagem horizontal em 375 px.
Leitor de tela não foi usado (fica para o tester, T-8). O passo deixou 3 salões de teste na base de desenvolvimento (`Salão Teclado …`), sem efeito nos testes.

Ao final: só o `postgres` do compose no ar; porta 3000 livre (o `next start` que subi foi encerrado).

## 3. Testes criados/alterados × CA

| CA | Testes |
|---|---|
| CA-1 | `repos.test.ts` (criar), `criar-editar.test.ts` ("Ana" sem e-mail; lista de A sim, B não), `paginas.test.ts` (casca criar → redirect, campos extras ignorados) |
| CA-2 | `repos.test.ts` (garantirPerfilDoGestor cria/já atende/reativa), `eu-tambem-atendo.test.ts` (nova sessão resolve `profissionalId`; `agenda.ver` próprio não lança; 2ª chamada "já atende"), `EuTambemAtendo.test.tsx` |
| CA-3 | `desativar.test.ts` (duas confirmadas + uma cancelada; 02:30Z → 23:30 do dia anterior; "cliente removida"; nada muda; log sem nomes), `repos.test.ts` (consulta), `ControleAtivacao.test.tsx` (lista em `role="alert"`), `paginas.test.ts` (casca recusado) |
| CA-4 | `desativar.test.ts` (reserva passada, itens, jornadas, vínculos e bloqueio mantêm o `profissional_id`; contagem de profissionais igual; some de `listarProfissionaisPublicos` e `listarAtivos`; inativo em `listarParaPainel`) |
| CA-5 | `desativar.test.ts` (duas sessões de login real revogadas; 401; login recusado com a mensagem da D-010; gestor e B válidos) |
| CA-6 | `eu-tambem-atendo.test.ts`, `desativar.test.ts` (sessões do gestor intactas), `paginas.test.ts` (gestor continua vendo a lista; "Eu também atendo" reativa o mesmo perfil) |
| CA-7 | `repos.test.ts` e `desativar.test.ts` (pendente/aceito/invalidado; só o pendente muda; reativar não restaura) |
| CA-8 | `desativar.test.ts` (reativar: volta à página pública; revogadas continuam; novo login resolve contexto) |
| CA-9 | `isolamento-permissoes.test.ts` (id de B, inexistente, `'abc'`, não texto → 404; fotografia de B igual, incl. `atualizado_em`), `repos.test.ts`, `paginas.test.ts` (`notFound`) |
| CA-10 | `isolamento-permissoes.test.ts`, `repos.test.ts`, `eu-tambem-atendo.test.ts`, `paginas.test.ts` |
| CA-11 | `pagina-operacao.test.ts`, `isolamento-permissoes.test.ts` (403 em todas as ações, inclusive no próprio perfil; 401 sem sessão; super admin 403; metadados), `tenant/registro.test.ts`, `paginas.test.ts` ("Acesso negado" nas 3 páginas, inclusive com id de B; redirect com `proximo`) |
| CA-12 | `texto.test.ts`, `validacao.test.ts`, `criar-editar.test.ts`, `FormularioProfissional.test.tsx`, `paginas.test.ts` |
| CA-13 | `criar-editar.test.ts` (troca recusada, perfil e usuário intactos; mesmo e-mail com outra caixa ou ausente é aceito), `FormularioProfissional.test.tsx` (somente leitura) |
| CA-14 | `concorrencia.test.ts` (10 × `Promise.all`: 1 criado, 9 já atende, 1 perfil) |
| CA-15 | `define-acao.test.ts` (exec.agora = deps.agora = relógio de `resolverTenant`), `repos.test.ts`, `desativar.test.ts` (fronteiras) |
| CA-16 | `*.test.tsx` (rótulos, `aria-describedby`, `role="alert"`, estado vazio, foco inicial/ciclo/Esc do diálogo) + passo manual acima |
| CA-17 | `concorrencia.test.ts` (trava segura por `pg`, espera por `pg_stat_activity`; desativar→reativar ⇒ ativo; reativar→desativar ⇒ inativo com sessões revogadas; duas desativações) |

## 4. Desvios do desenho e riscos

- **R-9 (CA-15):** o desenho propunha (b) `[agora−30min, agora+1min)` e (a) `[agora−61min, agora−1min)`, que se sobrepõem e a exclusion constraint recusa. Usei (b) `[agora−1min, agora+1min)` (continua "em andamento", adjacente a (a)).
- **`ControleAtivacao` sem `router.refresh()`:** a atualização depois de desativar vem do `revalidatePath` da ação de servidor (o Next devolve o RSC novo da rota atual). Evita `useRouter` (e o mock dele no jsdom). Comprovado no passo manual (a página passa a mostrar "Reativar").
- **`euTambemAtendoAcao()` sem parâmetros:** a assinatura `(anterior, fd)` do desenho gerava aviso de lint (parâmetros não usados); uma função sem parâmetros é aceita pelo `useActionState`.
- **Edição com vínculo (D-17):** a comparação do e-mail normaliza também o valor gravado (caixa e espaços); campo `email` ausente no input = manter. O formulário envia o e-mail do perfil como somente leitura.
- **`MENSAGENS_PROFISSIONAL.perfilAtivado`** acrescentada em `tipos.ts` (mensagem de sucesso do "eu também atendo").
- **Teste de `exec.agora`** ficou só na integração: no unitário o banco está fechado e o handler nunca é alcançado.
- **`tests/integration/profissionais/apoio.ts`** criado (helpers locais; ver §1).
- **Fotografia "nada mudou":** compara `revogada_em` das sessões, não `expira_em`, que muda pela renovação no uso (D-010 RN-10).
- Riscos: nenhum novo além dos do desenho. A garantia completa contra reserva criada depois da desativação depende de E3.2/E3.4/E3.5 (`FOR SHARE` + `ativo`, §7.3 do desenho).

## 5. Texto sugerido para o `CLAUDE.md` (líder)

**Project status** (acrescentar ao fim do parágrafo): "D-013 (E2.2) added staff management of professionals: `src/server/profissionais/` (`tipos.ts`, client-safe contracts and pt-BR messages; `validacao.ts`; `servico.ts`; `profissionais.acao.ts`, the first `*.acao.ts`: five `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`) and `/painel/profissionais` (list, `/novo`, `/[id]`) with the `acoes.ts` shell. Pattern for new actions: `src/server/<modulo>/<modulo>.acao.ts` without `'use server'`, every export from `defineAcao`, thin handler calling the service; a `'use server'` shell in `src/app/**/acoes.ts` only converts `FormData`/results and never touches repositories. Business outcomes are discriminated results inside `{ ok: true, dados }` (`resultado: 'invalido' | 'recusado' | …`); `ErroDeDominio`/`ResultadoAcao` stay 401/403/404. `defineAcao` passes `{ agora }` (the same instant used by `resolverTenant`) as the handler's third argument; `exigirAcessoAoPainel(caminho, papeis?, operacao?)` also applies the permission matrix. Deactivation (never delete) locks the professional row with `FOR UPDATE` (never `NO KEY UPDATE`), refuses while there is a `confirmado` booking with `fim > agora`, and in the same transaction revokes the sessions of a linked `profissional` user (never the gestor's) and invalidates pending invites. E3.2/E3.4/E3.5 must check `ativo` with `FOR SHARE` on the same row. `normalizarNome` lives in `src/lib/texto.ts`."

**Comandos** (nova linha da tabela):

| Estabilidade de profissionais (D-013) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/profissionais/concorrencia.test.ts \|\| break; done` | CA-14 ("eu também atendo" ×10 em paralelo) e CA-17 (desativar/reativar serializados por `FOR UPDATE`) |
