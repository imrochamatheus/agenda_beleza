# D-020 — Testes: perfil público e horário de funcionamento do salão (issue #75, E2.6)

## Rodada 1 (2026-11-20) — veredito: **APROVADO**

### Ambiente

- Branch `feat/d-020-perfil-funcionamento`, árvore de trabalho sem commit sobre `bc7877c`.
- Node v24.21.0 (`nvm use`), PostgreSQL 17 do compose (`agenda_beleza-postgres-1`), adaptadores `simulado` (`.env`).
- Playwright Chromium, projeto `mobile-chromium` (375×812, `isMobile`, `hasTouch`).
- Antes de tudo: `npm run db:generate`.

### Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0, 0 avisos |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0; lista `ƒ /painel/configuracoes/perfil`, `ƒ /painel/configuracoes/funcionamento`, `ƒ /dev/perfil` e `ƒ /dev/funcionamento` |
| `npm run test:coverage` | exit 0. **231 arquivos, 3.134 testes, todos verdes.** Linhas **99,89%** (3816/3820), statements 99,43%, branches 98,2%, funções 99,59%. O harness monta o template aplicando todas as migrações (inclusive `20261120000000_perfil_funcionamento`) numa base limpa, e o `drift.test.ts` passou |
| `npm run test:e2e` (build + todos os specs) | exit 0, **77 passed** (inclui `perfil*`, `funcionamento*` e `jornada*`) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia-perfil-funcionamento.test.ts \|\| break; done` | **10/10 verdes**, 8 testes por rodada. Nenhum `deadlock detected` nem 23P01 nos logs |
| `sh docker/smoke.sh` | `smoke: OK` (`/api/health` 200, `referrer-policy: strict-origin` nas duas páginas) |
| `git diff --stat -- 'src/server/jornadas/*.test.ts' tests/integration/jornadas src/app/dev/jornada 'src/app/painel/profissionais/[id]/jornada/*.test.tsx' e2e/jornada.spec.ts e2e/jornada-sem-js.spec.ts` | **vazio** (CA-19, R-1, R-2) |
| `git status` de `vitest.config.ts`, `.env.example` e `.github/` | sem alteração: o limiar e as exclusões de cobertura não mudaram, e não há variável nova nem mudança de CI (DevOps dispensado no desenho) |

### Critérios de aceitação

| CA | Estado | Evidência |
|---|---|---|
| CA-1 | passou | Testes do desenvolvedor (`perfil.test.ts`, `funcionamento.test.ts`, `repos-perfil-funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts`). Exploratório de integração do tester: gestor de S2 com `salaoId`/`salao_id` de S1 na entrada do perfil e do funcionamento ("informar" e "não informar") deixou a linha de S1 e as linhas de funcionamento de S1 idênticas, e só S2 mudou. O profissional recebeu 403 nas duas ações, sem escrita. Manual na app do compose: o gestor de S2 injetou `salaoId`/`salao_id`/`id` de S1 como campos ocultos no formulário real e só S2 mudou (consulta direta a `salao`) |
| CA-2 | passou | Unidade e integração do desenvolvedor. Exploratório: 31 valores-limite aceitos e 26 entradas hostis (tipos errados, `null`, array no lugar de texto, 10.000 caracteres, 500 itens, `\u0000`, `\u0085`, surrogate isolado, `instagram.com.evil.com`, `evil.com/instagram.com`, `javascript:`, `++55`, `+` no fim), todas sem 5xx; as recusadas não alteraram a linha. E2E exploratório (com e sem JS): CEP `1234-567`, telefone `(00) 3456-7890`, WhatsApp `+1 212 555 0100` e Instagram `pe..rfil` no mesmo envio devolveram cada erro ligado ao campo por `aria-describedby`/`aria-invalid`, com os valores e as caixas preservados |
| CA-3 | passou | `semana/validacao.test.ts`, `funcionamento-validacao.test.ts`, `funcionamento.test.ts`. Exploratório: 22:00–02:00, 24:00–24:00, 7 e 21 linhas num dia, `modo` inválido ou ausente e `dias` malformado foram recusados sem escrita (`xmin`/`atualizado_em` iguais). Manual sem JS: 22:00–02:00 na terça mostrou o erro com o valor preservado |
| CA-4 | passou | Exploratório: a mesma semana regravada 3× numa forma não canônica (contíguos separados e ordem trocada) devolveu `alterado: false`, com ids, `xmin` e `atualizado_em` iguais. Laço ×10 em paralelo verde. Manual: segunda gravação idêntica pela página real sem JS, sem mudança de `xmin`/`atualizado_em` |
| CA-5 | passou | E2E (77 passed). Exploratório: axe sem violações e sem rolagem horizontal em `?modo=nao-informado`, `?modo=fechado`, informado e no erro do perfil; foco visível (outline sólido de 3 px) nas paradas; Shift+Tab volta à parada anterior; a descrição de 1.000 caracteres com quebras de linha, digitada no navegador, foi aceita com e sem JS (o `\r\n` é normalizado). Manual na página real: axe sem violações (inicial e sucesso), sem rolagem horizontal |
| CA-6 | passou | Testes do desenvolvedor. Exploratório: salão novo com `funcionamento_definido = false`. Manual: página real abriu com "Não informar" marcado |
| CA-7 | passou | Exploratório: "informar" com todos os dias vazios → `definido: true`, leitura pública não nula, e regravar não escreve. Vitrine `?modo=fechado`: "Fechado" ×7 e o aviso "Todos os dias estão fechados…" |
| CA-8 | passou | Exploratório: "não informar" com linhas inválidas digitadas (`xx`, `25:00`) → sucesso sem escrita (já não informado). "Não informar" depois de informado → `alterado: true` e leitura pública `null` |
| CA-9 | passou | `funcionamento.test.ts` (verde na cobertura) |
| CA-10 | passou | `funcionamento.test.ts` (fotografia de reserva, itens, jornada, bloqueio e `mensagem`) |
| CA-11 | passou | `funcionamento.test.ts` e `paginas-perfil-funcionamento.test.ts` |
| CA-12 | passou | Laço ×10 (casos a, b, c e perfil × perfil) |
| CA-13 | passou | `metadadosDaAcao` nos testes, `tenant/registro.test.ts`. Manual: sem sessão, ou com cookie inválido, as duas páginas respondem 307 para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2F{perfil,funcionamento}`. Com a vitrine desligada, `/dev/perfil` e `/dev/funcionamento` dão 404 |
| CA-14 | passou | Testes do desenvolvedor; exploratório "endereço sem complemento" grava `NULL` |
| CA-15 | passou | Testes do desenvolvedor. Manual: Pix + Dinheiro marcados gravaram `{dinheiro,pix}`, e a página recarregada mostrou as caixas marcadas |
| CA-16 | passou | `leituras.test.ts` (conjunto exato de chaves, suspenso) |
| CA-17 | passou | `leituras.test.ts`, `repos-perfil-funcionamento.test.ts` |
| CA-18 | passou | `telefone.test.ts`, `format.test.ts`, `format.fonte-unica.test.ts` verdes. Manual: `11 3456 7890` → `+551134567890`, exibido como `(11) 3456-7890`; CEP `01305000` exibido como `01305-000` |
| CA-19 | passou | Diff vazio nos testes da jornada; todos verdes na cobertura e nos E2E `jornada*`. Revisei a fachada `validarSemana`: mesmo comportamento (forma inválida → `FORMULARIO_INVALIDO`, núcleo idêntico) |
| CA-20 | passou | `navegacao.test.ts`, `paginas-perfil-funcionamento.test.ts`. Manual: `/painel/configuracoes` tem os links para as duas subpáginas, e em `/painel/configuracoes/perfil` o único `aria-current="page"` é "Configurações" |

### CHECKs do banco × validação da aplicação (R-10)

Gravei pela ação real (`salvarPerfilDoSalao.executar`) estes valores aceitos pela aplicação, todos no limite. **Nenhum foi recusado pelo banco:**
- descrição com 1.000 unidades UTF-16 (500 emojis), com 1.000 caracteres acentuados, com 1.000 caracteres e quebras `\r\n`, com NBSP, U+3000 e U+2003 nas pontas, com U+2028, zero-width ou BOM nas pontas e com `\t` interno;
- logradouro com 120 caracteres acentuados, com 60 emojis e com NBSP interno e nas pontas; número com 10 caracteres e `S/N`; complemento com 60, bairro com 80 e cidade com 80 caracteres;
- UF ` to `; CEP `99999999` e `00000-001`;
- telefone fixo começando por 2 e por 5, `55` + 10 dígitos e WhatsApp fixo com pontos;
- Instagram com 30 caracteres, `_a_`, `@123`, `http://instagram.com/ab_c/` e `instagram.com/abc#x`;
- as listas com todas as chaves.

### Desvios do desenvolvedor (`dev.md` §4)

Os seis desvios respeitam a spec. O desvio 2 ("Não informado" no resumo do dia enquanto o funcionamento não foi informado; "Fechado" só com o funcionamento informado) é a leitura coerente da RN-13 com a RN-19, e conferi os dois estados na vitrine. Os demais são internos ou aditivos, sem mudar as interfaces do §3 do desenho.

### Defeitos

Nenhum.

### Observações (não são defeitos; nenhuma exige ação nesta demanda)

- **OBS-1:** com o JSON forjado `descricao: null` ou `descricao: 5`, a mensagem é "Use no máximo 1.000 caracteres na descrição.", embora o problema seja o tipo. Só é alcançável com uma requisição forjada: o formulário sempre envia texto. A recusa acontece, sem 5xx, como pede a spec (§6).
- **OBS-2:** a UF `ſp` (s longo) vira `SP` por `toUpperCase` e é gravada. O valor gravado é válido e o banco concorda.
- **OBS-3:** uma descrição bruta com mais de 2.000 caracteres é recusada mesmo que, aparada, caiba em 1.000 (ex.: texto curto seguido de 2.500 espaços). O `maxlength=1000` do navegador impede esse envio pela tela.
- **OBS-4:** "Acesso negado" responde HTTP 200. É o padrão da D-010 (D-9, opção b), já registrado na D-013 (OBS-4).

### Limpeza

- Apaguei os testes temporários (`tests/integration/salao/zz-tester-exploratorio.test.ts`, `e2e/zz-tester.spec.ts` e `e2e/zz-tester-real.spec.ts`) e os artefatos `test-results/zz-tester*`.
- Removi da base do compose os dados manuais: os salões "Tester S1"/"Tester S2" com usuários, sessões, profissional, slugs e funcionamento.
- Rodei `docker compose stop app worker`: só o postgres ficou no ar e a porta 3000 está livre.
