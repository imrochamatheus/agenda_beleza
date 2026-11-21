# D-022 — Testes: clientes por salão com telefone E.164, busca e edição (E5.1)

Testador independente. Branch `feat/d-022-clientes`, árvore sem commit, PostgreSQL 17 do compose, Node 24. Nenhum código de produção alterado.

## Rodada 1

### Gates (reexecutados por mim)

| Comando | Resultado |
|---|---|
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou |
| `npm run test:coverage` | 292 arquivos, 3747 testes passando; linhas **99,79%** (limiar 90%); `repos/cliente.ts` 92,85% de linhas |
| `npm run test:e2e` (build prévio, porta 3000 livre) | **101 passed** (inclui os 8 de clientes: teclado, axe 4.14.0, rolagem horizontal, sem JS) |
| Laço x10 de `tests/integration/clientes/concorrencia.test.ts` | 10 de 10 com 8 testes passando |
| `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/clientes`, `format.test.ts`, `historico.test.ts` | 184 passando em cada |
| Migração | nenhuma (conferido: sem alterações em `prisma/`) |

Exclusões de cobertura: nenhuma nova. Os testes novos verificam comportamento (fotografia `to_jsonb` de reserva/item/mensagem, contagens no banco, paridade JS x SQL da busca).

### Exploratório independente (teste temporário, apagado)

36 casos contra PostgreSQL real, todos conforme a spec:

- Normalização pelo upsert: as 5 máscaras e o fixo resultam em `+5511987654321`/`+551134567890`; recusados (erro no campo telefone, nada gravado): `+1 415 555 0100`, DDD 00 e 20, 0800, 8 e 9 dígitos, vazio, `abc`, 31 caracteres, `null`, número, objeto, array, NBSP no meio.
- Nome: vazio, 1 e 101 caracteres, quebra de linha, `null`, número e objeto recusados no campo nome; 2 e 100 aceitos; `<script>` é gravado como texto.
- Upsert: criada x atualizada (mesmo id, nome normalizado), mesmo número em dois salões independentes (a cliente de B não muda), `salaoId` forjado ignorado, número de anonimizada livre (cria nova), 8 paralelos do mesmo número: 1 cliente e `criada` em exatamente 1.
- Edição: telefone de outra cliente -> `recusado/telefone_em_uso` sem gravar; edição cruzada X<->Y e edição x upsert, 10 repetições, sem erro nem duplicado; cliente de outro salão, id não UUID e anonimizada -> 404; profissional -> 403 sem escrita; `listar`/`obter` negados ao profissional; `lerContatoDaCliente` de outro salão recusado.
- Busca: `JÚLIA`, `zelia`, `a c`, `%`, `_`, `\`, `98765`, `(11) 98765`, `+55 11 9`, `5511987654321`, `987654321` encontram só o esperado; `xyz` e 2 dígitos vazios; `q` de 500 caracteres cortado sem erro; `q` não texto = lista completa; ordem "ANA CLARA, Ana Júlia, Back\slash, João_%, Zélia"; página 0, -1, `abc`, `1.5` -> 1; página 5 de busca vazia mantém total 0; anonimizada fora da lista e da busca, detalhe como "Cliente removida" (nome nulo).
- Histórico: reserva sem itens mostra duração "—" e preço "R$ 0,00", hora no fuso do salão (09:00 local para 12:00Z em São Paulo).
- Consumidores antigos de `RepoCliente.listar`/`renomear` (`repos/index.test.ts`, `tenant/contextos.test.ts`) continuam passando na suíte completa.
- Conferido: `profissional` não tem "Clientes" na navegação (`src/config/navegacao.ts:89`); sem cores nem `style=` fora de `globals.css` nos componentes; R-4 está registrado no `dev.md` §5 (21 ms/5 mil, 212 ms/50 mil, aceito pelo líder), não reportado como defeito.

### Critérios de aceitação

CA-1 a CA-18: **passaram** (evidência: suíte de integração/unidade da seção "Testes e CAs cobertos" do `dev.md`, reexecutada na cobertura, mais o exploratório acima; CA-17/CA-18 pelos E2E `e2e/clientes.spec.ts` e `e2e/clientes-sem-js.spec.ts`, incluindo axe e ausência de rolagem horizontal em lista, lista vazia, página 2, detalhe, erro, sucesso e anonimizada).

### Observações (sem defeito)

- OBS-1 (baixa, não bloqueante): o `spec.md` §6 diz que NBSP é recusado. Na prática, NBSP no meio é recusado, mas NBSP no início ou fim é aceito porque `normalizarTelefoneBr` faz `trim()` (comportamento da D-020, sem mudança nesta demanda). O resultado é sempre um E.164 válido; sem impacto.
- OBS-2: `pagina=99999999999999999999` cai na página 1 (regex `^[1-9]\d{0,6}$`), o que a CA-9 admite ("caem em 1 ou página vazia, sem erro").

### Defeitos

Nenhum.

### Veredito: **APROVADO**

Todos os CAs passaram, todos os gates passaram, cobertura 99,79% (>= 90%), sem defeito aberto. Ambiente ao fim: apenas o postgres no ar, porta 3000 livre.
