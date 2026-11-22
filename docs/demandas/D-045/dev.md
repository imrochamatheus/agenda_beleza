# D-045 (E8.3) dev

Tarefas T-2 a T-10 feitas. Sem migração (parecer do DBA). Sem commit.

## Arquivos
- Domínio/servidor: `src/lib/format.ts` (`mascararTelefone`), `src/server/auditoria/tipos.ts`, `src/server/mensagens/reenviar.ts` (`reenviarNoRepos`/`enfileirarReenvio`; `reenviarMensagem` com o mesmo contrato), `src/server/admin/{rotulos-admin,paginacao,filtro-salao,mensagens*,auditoria*,assinatura*}.ts`, `mensagens.acao.ts` (`defineAcaoAdmin`), repos `admin-mensagens.ts`, `admin-assinatura.ts`, `admin-filtros.ts` e a leitura da auditoria dentro de `repos/auditoria.ts` (a fronteira "só este arquivo toca `auditoria`" do teste D-033 foi mantida).
- UI: `src/app/admin/{mensagens,auditoria,saloes/[id]/assinatura}`, `admin/_componentes/{SeloDeEstado,FiltrosGet,AntesDepois,Admin.module.css,quando}`, `DataList` (`detalhe?`, `classeCelula?`), `navegacao.ts`, `/dev/admin-mensagens`, README, E2E `e2e/admin-mensagens{,-sem-js}.spec.ts`.
- Testes: unit em cada módulo; integração em `tests/integration/admin/{reenvio,concorrencia-reenvio,mensagens-lista,auditoria,assinatura,paginas,plano}.test.ts`.

## Gates
- lint 0 avisos; typecheck ok; build ok.
- `npm run test:coverage`: 562 arquivos, 6587 testes passando; linhas 98,91% (limiar 90).
- E2E completo (porta 3000 ocupada por um `next dev` do usuário, não encerrado; usei config temporária na 3100, removida): 344 passaram, 1 falhou só por artefato da porta (`admin-entrar.spec.ts:93` compara com `127.0.0.1:3000` fixo); as novas e as da D-044 passam.
- Concorrência (`concorrencia-reenvio`) 5x ok; fuso UTC e America/Sao_Paulo ok. `[CA-15]` (100 mil mensagens, 200 mil auditorias): fila 4–31 ms, auditoria 0–30 ms (limiar 300).
- Capturas 375/768/1280 conferidas (fora do repo).

## Desvios
- Fila de mensagens e auditoria usam CTE da página + total `MATERIALIZED` + JOIN só nas 20 linhas (dba.md), não `count(*) OVER ()`.
- Para caber em 768 px (menu lateral deixa ~500 px), colunas foram compostas: fila 2 colunas, auditoria 3, salões (D-044) 3 (suspensão junto da assinatura), eventos 4. Selo `nowrap` + `min-width: max-content` na célula, como pedido.
- `formatarDiaCivil` não criado: `formatarDataCivil` já existe. `?reenvio=inexistente` acrescentado à lista fechada.
- 401 redireciona para `/admin/entrar` sem `?proximo=` (comportamento de `exigirAcessoAoAdmin`, igual à D-044).
- Seed opcional não feito. CLAUDE.md não editado (líder).
## Riscos
- `clientes/paginas-permissoes` estourou 5 s uma vez sob carga total; passa isolado (flaky preexistente).
