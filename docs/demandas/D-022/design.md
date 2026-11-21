# D-022 — Desenho: clientes por salão com telefone E.164, busca e edição (issue #29, E5.1)

Entradas: `docs/demandas/D-022/spec.md` (RN-1..RN-19, CA-1..CA-18, D-1..D-10), `CLAUDE.md`, `docs/demandas/D-017/design.md` (trava do salão, `/dev/*`), `docs/demandas/D-020/design.md` (formato, telefone). Código lido: `src/lib/telefone.ts`, `src/server/repos/{cliente,tipos,transacao,index}.ts`, `src/server/auth/permissoes.ts`, `src/server/bloqueios/{bloqueios.acao,servico}.ts`, `src/app/painel/bloqueios/{acoes.ts,page.tsx}`, `src/config/navegacao.ts`, `prisma/schema.prisma` (`Cliente`, `Reserva`), migrações `init` e `restricoes_sql`.

## 0. Verificações feitas antes do desenho

- **Consumidores de `RepoCliente.listar`:** nenhum código de produção. Só `src/server/repos/index.test.ts:130`, `tests/integration/tenant/{contextos,isolamento}.test.ts` (contratos "inclui anonimizadas, ordem de cadastro"). **`listar` e `renomear` ficam como estão** (os testes de isolamento e de escopo seguem valendo); a lista paginada é um método novo, `buscar`. Nada é substituído, então não há regressão a procurar.
- **Esquema já basta:** `cliente_salao_id_telefone_e164_key` UNIQUE (NULLS DISTINCT), `cliente_anonimizacao_chk`, `cliente_telefone_e164_chk`, `reserva_salao_id_cliente_id_inicio_idx`. `id` tem `gen_random_uuid()` por default: o `INSERT` bruto do upsert não precisa gerar id.
- **`@updatedAt` é do cliente Prisma:** SQL bruto (upsert) precisa de `atualizado_em = now()` explícito (RN-6 já diz).
- **Atualização de coluna de chave:** `UPDATE cliente SET telefone_e164` altera coluna indexada e toma tupla `FOR UPDATE` (conflita com o `FOR KEY SHARE` da FK de `reserva` e `consentimento`); `SET nome` não (FOR NO KEY UPDATE).
- **`SELECT … FOR NO KEY UPDATE` em `salao`** (`RepoSalao`, D-017) é a trava de serialização por salão; não conflita com o `FOR KEY SHARE` de FKs.
- **`registro.test.ts`** usa `import.meta.glob('/src/**/*.acao.ts')`: o novo `clientes.acao.ts` entra sem mudar o teste. **`SEGMENTOS_RESERVADOS` não muda** (`painel`, `dev` já reservados).
- `ROTAS.clientes` e o item "Clientes" existem. Falta `ROTAS.cliente(id)` e `ROTAS.devClientes`.

## 1. Resumo da solução

1. **Sem migração, sem DBA, sem DevOps** (§4, §5).
2. Domínio puro `src/server/clientes/` (`tipos.ts` client-safe, `validacao.ts`): nome (2..100), telefone (via `normalizarTelefoneBr`), consulta de busca e número de página.
3. `RepoCliente` ganha `upsert` (um `INSERT … ON CONFLICT … DO UPDATE … RETURNING (xmax = 0)`), `buscar` (lista paginada num só comando), `atualizar` (edição sob trava), `historico` e `buscarContato`.
4. Serviço `servico.ts` (`upsertCliente`, `listar`, `obter`, `editar`), leitura `leitura.ts` (`lerContatoDaCliente`) e `clientes.acao.ts` com uma ação, `editarCliente` (`defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`).
5. Operação nova `cliente.contato` na matriz.
6. Telas `/painel/clientes` (busca GET, lista, paginação por links) e `/painel/clientes/[id]` (dados, edição, histórico); vitrine `/dev/clientes` para o E2E sem banco.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| `pg_trgm`/`unaccent` + índice GIN, ou coluna `nome_busca` | Extensão ou migração nova por um ganho que a v1 não precisa (milhares de linhas por salão, filtro por `salao_id` no índice existente). Reabrir com o DBA se o volume medido mudar (R-4). |
| `LIKE`/`ILIKE` com escape de `%`, `_`, `\` | `position(texto IN expressão) > 0` é literal por construção: elimina o escape e sua classe de defeito. |
| Contar com `count(*) OVER()` | Página além da última não devolve linha e perde o total. O comando único com subconsulta de total (§3.3) devolve sempre o total. |
| `upsert` do Prisma (`db.cliente.upsert`) | Faz `SELECT` e depois `INSERT`/`UPDATE`: viola RN-6 (nunca "SELECT depois INSERT") e perde `criada`. |
| Captura de 23505 dentro de savepoint no repositório | Savepoint manual em transação do Prisma é frágil. A captura fica **fora** da transação, no serviço (A-4). |
| Advisory lock por (salão, telefone) | Segundo mecanismo de trava no projeto (descartado já na D-020). A linha do salão e a restrição UNIQUE bastam. |
| Edição trocando `id` (apagar e recriar) | Quebraria a FK de `reserva`. O `id` nunca muda (RN-14). |
| Sem trava (só pré-checagem + captura) | Duas edições cruzadas (X: A→B, Y: B→A) produzem impasse 40P01 (cada `UPDATE` espera a entrada de índice não confirmada da outra). Ver A-4. |
| Nova tela "nova cliente" | Fora do escopo (spec §3). |

### 1.2 Dependências novas

Nenhuma (sem `libphonenumber-js`, D-1 da spec). Reusa `src/lib/{telefone,texto,format}.ts`.

## 2. Decisões

| ID | Decisão | Justificativa |
|---|---|---|
| A-1 (D-2) | **Sem migração.** Busca em SQL: `position($q IN lower(regexp_replace(normalize(nome, NFD), '[̀-ͯ]', '', 'g'))) > 0`; telefone: `position($d IN substr(telefone_e164, 2)) > 0`. O texto da consulta é normalizado na aplicação com a **mesma** regra (`NFD`, remover U+0300..U+036F, `toLowerCase`, nos dois lados o mesmo intervalo, não `\p{M}`). Página 20, ordem `(expressão normalizada, id)`. | Confirmada. `normalize()` do PostgreSQL exige codificação UTF8 (a do projeto); o teste de integração de CA-8 é a prova, sem consulta ao DBA. O `lower` do lado SQL só age sobre ASCII depois de remover acentos, então independe da colação. |
| A-2 (D-3) | `upsertCliente(ctx: ContextoEscopado, entrada, repos?: Repos)`. Sem `repos`, usa `repos()` (comando isolado, que já é atômico). Com `repos` (da `emTransacao` do chamador) grava na transação da reserva. Valida e normaliza antes de tocar o banco. Retorno `{ resultado: 'ok', cliente: { id, nome, telefoneE164 }, criada } \| { resultado: 'invalido', erros }`. O repositório recebe valores **já normalizados** e confere `ehTelefoneBrE164` (defesa; o CHECK do banco é a última). | Confirmada. `ContextoEscopado` = `TenantContext \| SistemaContext` (E4.2 usa `SistemaContext`). Assinatura estável para E3.2/E3.4/E4.2 (obrigação §11). |
| A-3 (D-7) | O upsert grava sempre (nome e `atualizado_em`). `criada` vem de `(xmax = 0)`. | Confirmada. `xmax = 0` é idioma consagrado mas não documentado: o CA-6 (×10) é o guarda (R-1). |
| A-4 (D-10) | **Edição de telefone: trava de serialização do salão + pré-checagem + captura do 23505 fora da transação.** Em `emTransacao`: (1) `r.saloes.travar(ctx)` (`FOR NO KEY UPDATE` em `salao`, a mesma trava da D-017); (2) `SELECT … FROM cliente WHERE id AND salao_id AND anonimizada_em IS NULL FOR UPDATE` (404 se vazio); (3) se nada mudou, sai sem escrever (RN-12); (4) se o telefone muda, pré-checa `SELECT id, nome FROM cliente WHERE salao_id AND telefone_e164 = $novo AND id <> $id` → `recusado/telefone_em_uso` com `{ id, nome }` da existente (D-6); (5) `UPDATE cliente SET nome, telefone_e164, atualizado_em = now() WHERE id AND salao_id`. O serviço envolve a `emTransacao` num `try/catch` que trata **somente** a violação de `cliente_salao_id_telefone_e164_key` (helper `ehViolacaoDeTelefoneUnico`, aceita `P2002` com `target` contendo `telefone_e164` e `P2010` com `meta.code = '23505'` e a constraint) e responde `recusado/telefone_em_uso` depois de uma releitura **fora** da transação abortada (a transação inteira foi desfeita; só havia essa escrita). Qualquer outro erro sobe. | A trava do salão serializa as edições entre si (elimina o impasse da troca cruzada e deixa a pré-checagem decisiva para edição × edição, sem 23505). O único corredor que sobra é edição × `upsertCliente` (o upsert não toma a trava do salão): o `UPDATE` espera a entrada de índice do `INSERT` não confirmado e, se ele confirma, falha com 23505. `UPDATE` não tem `ON CONFLICT`, então a regra "nunca capturar 23505" da D-017 (slug com `ON CONFLICT` disponível) não se aplica; a captura é estreita, nomeada pela constraint e fora da transação (sem savepoint). O upsert nunca falha: o `INSERT … ON CONFLICT` espera a edição e, se ela confirma, atualiza a linha vencedora (CA-12: "se une à vencedora"). |
| A-5 (D-5) | `cliente.contato`: `linha('salao', 'proprio', 'negado')`. `cliente.gerir` não muda. | Confirmada. |
| A-6 | Ordem canônica de travas, estendida (obrigação para E3.x): `salao` (só quando a operação precisar de `FOR SHARE`/`NO KEY UPDATE` dele, **sempre primeiro**) → profissional(is) → serviço(s) → **cliente** → `servico_profissional`/`jornada`/`reserva`/`reserva_item`. Edição: salão → cliente. Upsert: cliente (dentro da ordem do chamador). | Sem ciclo: a edição só pega `salao` e uma linha de `cliente`; a reserva em curso segura a linha de `cliente` (via upsert, `NO KEY UPDATE`) e nunca espera pelo `salao` se a E3.2 respeitar "salão primeiro". Registrado em §11. |
| A-7 | Histórico: duas leituras do repositório (`historico`: até 50 reservas com profissional e itens + `total` num comando único). Fuso do salão: `bloqueios.fusoDoSalao(ctx)` já existente (o dev pode movê-lo para `RepoSalao`, sem mudar contrato). Formatação em `src/lib/format.ts` (`formatarDataHora`), status por mapa em `tipos.ts`. Valor total e duração somam o **snapshot** de `reserva_item`. | RN-15. |
| A-8 | Detalhe de anonimizada: o serviço devolve `{ anonimizada: true, nome: null, telefone: null, historico }` e a página não renderiza formulário. `editar` sobre anonimizada ou de outro salão: `NaoEncontrado`. | RN-4, RN-13, D-9. |
| A-9 | Página: `?pagina` aceito só se `^[1-9]\d{0,6}$` (inválido ou enorme → 1); `?q` aparado, colapsado, cortado em 80. Passos em `validacao.ts` (puros, com teste). | RN-8/RN-9, CA-9. Página enorme dentro do formato (`9999999`) → `OFFSET` de 199.999.980 cabe em `int4`; devolve página vazia. |
| A-10 | O formulário de edição devolve o estado na resposta (sem PRG), como a D-017/D-016, com `useActionState`; valores digitados preservados; resumo de erros com foco. `type="tel"` `autocomplete="off"`. | RN-19. |

## 3. Interfaces

### 3.1 Contratos do domínio (`src/server/clientes/tipos.ts`, client-safe)

```ts
export const TEXTO_CLIENTE_REMOVIDA = 'cliente removida';           // RN-17, importada pela E5.2/E3.3
export const LIMITES_CLIENTE = { nomeMin: 2, nomeMax: 100, buscaMax: 80, porPagina: 20, historicoMax: 50 } as const;
export const MENSAGENS_CLIENTE: { telefone: string; nomeObrigatorio: string; nomeTamanho: string; /* … */ };
export type ErrosCliente = { telefone?: string; nome?: string };
export type EntradaUpsertCliente = { telefone: unknown; nome: unknown };
export type ResultadoUpsertCliente =
  | { resultado: 'ok'; cliente: { id: string; nome: string; telefoneE164: string }; criada: boolean }
  | { resultado: 'invalido'; erros: ErrosCliente };
export type EntradaEditarCliente = { id: unknown; nome: unknown; telefone: unknown };
export type ResultadoEditarCliente =
  | { resultado: 'ok'; cliente: ClienteVisao; alterada: boolean }
  | { resultado: 'invalido'; erros: ErrosCliente }
  | { resultado: 'recusado'; motivo: 'telefone_em_uso'; existente: { id: string; nome: string } };
export type ClienteVisao = { id: string; nome: string | null; telefone: string | null; telefoneFormatado: string | null; anonimizada: boolean };
export type ItemHistorico = { id: string; inicioLocal: string; status: StatusRotulo; profissional: string; servicos: string[]; duracaoTotal: string; precoTotal: string };
export type ListaClientes = { itens: ClienteVisao[]; total: number; pagina: number; porPagina: number; q: string };
export type DetalheCliente = { cliente: ClienteVisao; historico: ItemHistorico[]; totalReservas: number };
export type ContatoCliente = { id: string; nome: string | null; telefoneE164: string | null; anonimizada: boolean };
```

`validacao.ts` (puro, sem `server-only`): `validarNomeCliente(v: unknown)`, `validarTelefoneCliente(v: unknown)` (usa `normalizarTelefoneBr`; mensagem da RN-1), `validarEntradaCliente(e) → { ok: true; nome; telefoneE164 } | { ok: false; erros }` (todos os erros juntos), `lerBusca(v: unknown): { q: string; nome: string; digitos: string | null }` (`nome` normalizado; `digitos` só se a regra da RN-9 vale), `lerPagina(v: unknown): number`.

### 3.2 Permissão (`src/server/auth/permissoes.ts`)

Acrescentar `'cliente.contato'` a `OPERACOES` e `'cliente.contato': linha('salao', 'proprio', 'negado')` à `MATRIZ`; atualizar o teste de matriz.

### 3.3 Repositório (`src/server/repos/cliente.ts`, DTOs em `repos/tipos.ts`)

```ts
interface RepoCliente {
  buscarPorId; listar; renomear;                         // inalterados
  upsert(ctx: ContextoEscopado, v: { nome: string; telefoneE164: string }): Promise<{ cliente: { id; nome; telefoneE164 }; criada: boolean }>;
  buscar(ctx, p: { nome: string; digitos: string | null; pagina: number }): Promise<{ itens: ClienteDTO[]; total: number }>;
  atualizar(ctx, id: string, v: { nome: string; telefoneE164: string }): Promise<
    | { resultado: 'ok'; cliente: ClienteDTO; alterada: boolean }
    | { resultado: 'em_uso'; existente: { id: string; nome: string } }>;  // pré-checagem; 404 por NaoEncontrado
  historico(ctx, clienteId: string, limite: number): Promise<{ reservas: ReservaHistoricoDTO[]; total: number }>;
  buscarContato(ctx, id: string, so?: { profissionalId: string }): Promise<ClienteDTO>;   // NaoEncontrado
}
```

SQL do upsert (valores como parâmetros; `exigirEscopo(ctx)` fornece `salao_id`):

```sql
INSERT INTO cliente (salao_id, nome, telefone_e164)
VALUES ($1::uuid, $2, $3)
ON CONFLICT (salao_id, telefone_e164)
DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now()
RETURNING id, nome, telefone_e164, (xmax = 0) AS criada
```

Busca (comando único, `salao_id` e `anonimizada_em IS NULL` sempre; `$nome` e `$digitos` parâmetros, `$digitos` nulo desliga o critério do telefone):

```sql
WITH f AS (
  SELECT id, nome, telefone_e164, anonimizada_em, criado_em, atualizado_em,
         lower(regexp_replace(normalize(nome, NFD), '[̀-ͯ]', '', 'g')) AS chave
    FROM cliente
   WHERE salao_id = $1::uuid AND anonimizada_em IS NULL
     AND ($2 = '' OR position($2 IN lower(regexp_replace(normalize(nome, NFD), '[̀-ͯ]', '', 'g'))) > 0
          OR ($3::text IS NOT NULL AND position($3 IN substr(telefone_e164, 2)) > 0))
)
SELECT (SELECT count(*) FROM f)::int AS total, p.*
  FROM (SELECT 1) d
  LEFT JOIN (SELECT * FROM f ORDER BY chave, id LIMIT 20 OFFSET $4) p ON true
```

(sempre devolve uma linha com o total; página vazia → `id` nulo). Ao implementar, a coluna `chave` pode ser calculada uma vez num CTE interno; o dev mantém a ordem e a semântica. O `$3` deve ir com cast `::text` (parâmetro nulo).

`atualizar` roda **dentro** de uma transação do serviço (que já travou o salão): `SELECT … FOR UPDATE` da linha (`salao_id`, `anonimizada_em IS NULL`), compara, pré-checa e faz o `UPDATE`. Não captura erros.

`historico`: `reserva` (`salao_id`, `cliente_id`, `inicio DESC, id`), `LIMIT $limite`, mais `count(*)`; por reserva, `profissional.nome` atual, itens por `ordem` com `servico.nome` atual e o snapshot (`preco_centavos`, `duracao_min`). Sem telefone ou nome de outra cliente.

`buscarContato`: `WHERE id AND salao_id` (+ `AND EXISTS (SELECT 1 FROM reserva WHERE salao_id AND cliente_id = c.id AND profissional_id = $p)` quando `so`). Inclui anonimizadas.

### 3.4 Serviço e leitura (`src/server/clientes/{servico,leitura}.ts`, sem `next/*`)

```ts
export function upsertCliente(ctx: ContextoEscopado, entrada: EntradaUpsertCliente, r?: Repos): Promise<ResultadoUpsertCliente>;
export function listar(ctx: TenantContext, entrada: { q?: unknown; pagina?: unknown }): Promise<ListaClientes>;       // exigirPermissao('cliente.gerir')
export function obter(ctx: TenantContext, id: unknown, agora?: Date): Promise<DetalheCliente>;                        // 'cliente.gerir'; id não UUID → NaoEncontrado
export function editar(ctx: TenantContext, entrada: EntradaEditarCliente): Promise<ResultadoEditarCliente>;           // A-4
// leitura.ts
export function lerContatoDaCliente(ctx: TenantContext, clienteId: unknown): Promise<ContatoCliente>;                 // 'cliente.contato'; gestor: qualquer; profissional: só das próprias reservas
```

`lerContatoDaCliente`: `exigirPermissao(ctx, 'cliente.contato')`; gestor → `buscarContato(ctx, id)`; profissional → `buscarContato(ctx, id, { profissionalId: ctx.profissionalId })`; `NaoEncontrado` não distingue "outro profissional", "outro salão" e "inexistente".

`editar` também faz `exigirPermissao(ctx, 'cliente.gerir')`. Log estruturado só com ids (nome e telefone **não** vão para log).

### 3.5 Ação (`src/server/clientes/clientes.acao.ts`, sem `'use server'`)

```ts
export const editarCliente = defineAcao<EntradaEditarCliente, ResultadoEditarCliente>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.editar(ctx, e),
);
```

O upsert não é ação (é função de serviço chamada por E3.2/E3.4/E4.2 dentro de ações delas).

### 3.6 Telas

- `src/app/painel/clientes/page.tsx` (`exigirAcessoAoPainel(ROTAS.clientes, ['gestor'], 'cliente.gerir')`, "Acesso negado" no 403): `<form method="get">` com `q` rotulado e botão "Buscar"; lista (nome, telefone formatado, link); contagem ("N clientes" / "Nenhuma cliente encontrada."); `nav` "Anterior/Próxima" como links que preservam `q`; página vazia além da última com link para a 1.
- `src/app/painel/clientes/[id]/page.tsx`: 404 para id não UUID/outro salão/inexistente; dados, `FormularioCliente` (cliente anonimizada: texto "Cliente removida", sem formulário), `HistoricoCliente`.
- `src/app/painel/clientes/acoes.ts` (`'use server'`, só converte `FormData` e resultado), `estado.ts`, `FormularioCliente.tsx`, `ListaClientes.tsx`, `BuscaClientes.tsx`, `HistoricoCliente.tsx`, `Clientes.module.css` (cores só por tokens de `globals.css`).
- `/dev/clientes` (`src/app/dev/clientes/{page.tsx,acoes.ts}`, 404 sem `VITRINE_COMPONENTES=true`/`next dev`): os mesmos componentes com dados fixos e ação que só valida; páginas de lista, vazia, detalhe, erro e sucesso.
- `src/config/navegacao.ts`: `cliente: (id) => `/painel/clientes/${seg(id)}``, `devClientes: '/dev/clientes'` (+ teste). O item "Clientes" do profissional continua ausente (já é assim).

## 4. Dados: **DBA dispensado**

Nenhuma tabela, coluna, constraint, índice ou extensão. Justificativa: o UNIQUE `(salao_id, telefone_e164)` serve ao `ON CONFLICT` e à pré-checagem; o filtro por `salao_id` usa o prefixo desse índice; o histórico usa `reserva_salao_id_cliente_id_inicio_idx`. A busca por substring varre as linhas do salão (milhares): aceitável na v1 (R-4). `normalize(… NFD)` depende de UTF8: os testes de integração (CA-8) rodam no PostgreSQL 17 do projeto e falhariam se não valesse. **Gatilho para reabrir o DBA:** `EXPLAIN` de salão sintético com 50 mil clientes acima de ~50 ms, ou `normalize` indisponível no ambiente real.

## 5. Infraestrutura: **DevOps dispensado**

Sem variável de ambiente, container, workflow ou dependência. Os E2E novos entram no job `e2e` existente (vitrine liga com `VITRINE_COMPONENTES=true` do `webServer`).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `exigirEscopo(ctx)` em todo método; nenhuma entrada carrega `salaoId`; `salao_id` em toda consulta, inclusive histórico, upsert, contato (RN-3, CA-4, CA-15). |
| Exclusion anti-sobreposição | Não | Sem reserva aqui; a edição não toca `reserva`. |
| UTC + fuso do salão | Sim | Histórico formata com o fuso do salão (`format.ts`), nunca o do servidor (CA-13, teste com `TZ`). |
| Adaptadores de integração | Não | Nenhuma integração. |
| Soft delete / anonimização | Sim | Nada é apagado; anonimizada fora da lista/edição, detalhe somente leitura, número livre (RN-4); contrato `nome: null` + `TEXTO_CLIENTE_REMOVIDA`. A ação de anonimizar é a E5.2. |
| Salão suspenso somente leitura | Parcial | `capacidade: 'configurar'` na ação; bloqueio real é da E6.4; leituras seguem disponíveis. |
| Idempotência de webhooks/mensagens | Não | Edição não envia mensagem (RN-13); `upsertCliente` não enfileira. |
| Auditoria do super admin | Não | Super admin sem acesso (`cliente.gerir`/`contato` negados). |
| Dados pessoais | Sim | Nome e telefone fora de logs; mensagem de erro não revela outra cliente além do link do telefone em uso (D-6, o gestor já vê o cadastro). |

## 7. Riscos e mitigações

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | `xmax = 0` é comportamento não documentado do PostgreSQL | CA-6 ×10 com 2 e 10 paralelos; teste de upsert nova × existente; se falhar em versão futura, trocar por `INSERT … ON CONFLICT DO NOTHING RETURNING` + `UPDATE` em dois comandos sob a mesma transação. |
| R-2 | Edição × `upsertCliente` pode produzir 23505 na edição | Captura estreita e fora da transação (A-4); CA-12 ×10 cobre os dois resultados; teste de unidade de `ehViolacaoDeTelefoneUnico` com `P2002` e `P2010`. |
| R-3 | A E3.2 poderia tomar `salao` depois do cliente e criar ciclo com a edição | Obrigação §11: "salão primeiro" (A-6); registrada no cabeçalho de `repos/cliente.ts`. |
| R-4 | Varredura por substring em salões grandes | Dispensa documentada (§4) com gatilho mensurável. |
| R-5 | Paridade da normalização JS × SQL | Teste de paridade (acentos, maiúsculas, `ç`, `ñ`, "ß", combinados) comparando `lerBusca` com a expressão SQL num `SELECT` real. |
| R-6 | `*.test.tsx` precisa de `/** @vitest-environment jsdom */` | Convenção do projeto; lembrada nas tarefas. |

## 8. Estratégia de testes

- **Unidade:** `validacao.test.ts` (nome, telefone incl. CA-1/CA-2, `lerBusca`, `lerPagina`), `tipos`/formatação, `ehViolacaoDeTelefoneUnico`, matriz (`cliente.contato`), componentes (`*.test.tsx`: erro por campo, resumo, anonimizada sem formulário, lista vazia).
- **Integração (PostgreSQL real, `tests/integration/clientes/`):** `upsert.test.ts` (CA-2 via, CA-3, CA-4, CA-15), `busca-lista.test.ts` (CA-7, CA-8, CA-9), `edicao.test.ts` (CA-10, CA-11, RN-13: reservas e mensagens idênticas por `SELECT`), `historico.test.ts` (CA-13, fusos, snapshots, 60 reservas), `contato.test.ts` (CA-14), `paginas-permissoes.test.ts` (CA-5: 403 do profissional, redirecionamento sem sessão, 404 do detalhe cruzado; teste de registro: `papeis`/`capacidade`), `concorrencia.test.ts` (CA-6, CA-12 e edição cruzada sem impasse).
- **E2E (Playwright, `/dev/clientes`, 375×812):** teclado, axe 4.14.0, sem JS, sem rolagem horizontal (CA-17, CA-18).
- **Cobertura:** ≥ 90% de linhas mantida por unidade + integração (todo arquivo novo de `src/**` tem teste). O gate é `npm run test:coverage`.

## 9. Tarefas

Convenção: responsável é o `desenvolvedor` em todas; cada arquivo tem um dono por rodada.

| Tarefa | Dependências | Paralela com |
|---|---|---|
| T-1 domínio puro, permissão e rotas | — | T-2 |
| T-2 repositório | — (usa só tipos do próprio `repos/tipos.ts`) | T-1 |
| T-3 serviço, leitura e ação | T-1, T-2 | — |
| T-4 telas do painel | T-3 | T-5 (disjuntos) |
| T-5 testes de integração | T-3 | T-4 |
| T-6 vitrine `/dev/clientes` e E2E | T-4 | — |
| T-7 documentação e fechamento | T-5, T-6 | — |

### T-1 — Domínio puro, permissão e rotas
- **Arquivos:** `src/server/clientes/{tipos.ts,validacao.ts}` (+ `validacao.test.ts`), `src/server/auth/permissoes.ts` (+ teste de matriz), `src/config/navegacao.ts` (+ teste), `src/lib/format.ts` (só se faltar formatador; hoje não falta).
- **Entregável:** §3.1 e §3.2.
- **Conclusão:** `npm run test:unit` verde; `lerBusca`/`lerPagina` cobrem CA-8/CA-9; matriz com `cliente.contato`.

### T-2 — Repositório
- **Arquivos:** `src/server/repos/cliente.ts`, `src/server/repos/tipos.ts` (acrescentar `ReservaHistoricoDTO` e tipos de retorno), `src/server/repos/index.test.ts` (contratos de escopo dos novos métodos).
- **Entregável:** §3.3, com cabeçalho de travas (A-6) em `cliente.ts`. `listar` e `renomear` intactos.
- **Conclusão:** `npm run typecheck` e `npm run lint` verdes; `index.test.ts` exige `exigirEscopo` nos métodos novos.

### T-3 — Serviço, leitura e ação
- **Arquivos:** `src/server/clientes/{servico.ts,leitura.ts,clientes.acao.ts,erros-banco.ts}` (+ testes unitários; `ehViolacaoDeTelefoneUnico` em `erros-banco.ts`).
- **Entregável:** §3.4 e §3.5; edição conforme A-4.
- **Conclusão:** o teste de registro (`tests/integration/tenant/registro.test.ts`) passa com `clientes.acao.ts`; unidade verde; `src/server/clientes/**` sem `next/*`.

### T-4 — Telas do painel
- **Arquivos:** `src/app/painel/clientes/**` (`page.tsx`, `[id]/page.tsx`, `acoes.ts`, `estado.ts`, componentes e CSS com seus testes `*.test.tsx`).
- **Entregável:** §3.6 (painel).
- **Conclusão:** build, lint e typecheck verdes; `acoes.ts` não importa repositório; testes de componente cobrem erro por campo e resumo.

### T-5 — Testes de integração
- **Arquivos:** `tests/integration/clientes/**` (e apoio local).
- **Entregável:** §8 (integração).
- **Conclusão:** CA-2..CA-16 verdes; `for i in $(seq 10); do npx vitest run --project integration tests/integration/clientes/concorrencia.test.ts || break; done` verde; `TZ=UTC` e `TZ=America/Sao_Paulo` iguais nos testes de histórico.

### T-6 — Vitrine e E2E
- **Arquivos:** `src/app/dev/clientes/**` (+ testes), `e2e/clientes.spec.ts`, `e2e/clientes-sem-js.spec.ts`.
- **Conclusão:** CA-17/CA-18 verdes; axe sem violações; `format.fonte-unica.test.ts` e `conformidade.test.ts` verdes.

### T-7 — Documentação e fechamento
- **Arquivos:** `README.md`, `CLAUDE.md` (parágrafo D-022 e linha de estabilidade), `docs/demandas/D-022/dev.md`.
- **Conclusão:** `npm run test:coverage` ≥ 90%; gates da definição de pronto.

### Mapa CA → tarefa → teste

| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-1 | unidade (já existente + via `validarEntradaCliente`) |
| CA-2 | T-1, T-5 | unidade + integração (upsert e edição) |
| CA-3 | T-1, T-5 | unidade + integração |
| CA-4 | T-5 | integração |
| CA-5 | T-3, T-5 | integração + registro |
| CA-6 | T-5 | integração (×10) |
| CA-7 | T-5 | integração |
| CA-8 | T-1, T-5 | unidade + integração |
| CA-9 | T-1, T-5 | unidade + integração |
| CA-10 | T-5 | integração |
| CA-11 | T-5 | integração |
| CA-12 | T-5 | integração (×10) |
| CA-13 | T-5 | integração (+ unidade de formatação) |
| CA-14 | T-5 | integração |
| CA-15 | T-5 | integração |
| CA-16 | T-3, T-4 | registro + unidade + lint |
| CA-17 | T-6 | E2E |
| CA-18 | T-4, T-6 | unidade de componente + E2E |

## 10. Transferências

- **DBA:** dispensado (§4). **DevOps:** dispensado (§5).

## 11. Obrigações registradas para as próximas demandas

- **E3.2/E3.4/E4.2:** reservar com `upsertCliente(ctx, { telefone, nome }, r)` dentro da `emTransacao` da reserva; ordem de travas `salao` (se usado) → profissional → serviço → cliente → reserva; `ok` com `invalido` vira erro de campo, nunca 500.
- **E3.3/E3.5:** usar `lerContatoDaCliente` e `TEXTO_CLIENTE_REMOVIDA`.
- **E5.2:** reusar `TEXTO_CLIENTE_REMOVIDA`; anonimização deve tomar a mesma trava de `salao` + linha de `cliente` `FOR UPDATE` da edição (A-4) para serializar com ela.
- **E6.4:** o bloqueio por suspensão entra na política já ligada à capacidade `configurar` de `editarCliente`.
