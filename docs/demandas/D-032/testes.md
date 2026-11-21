# D-032 (E4.5) Avaliações verificadas — testes

## Rodada 1 — VEREDITO: APROVADO

Ambiente: branch `feat/d-032-avaliacoes` (alterações não commitadas), Node v24.21.0, PostgreSQL do `docker compose up -d postgres`, adaptadores simulados, Chromium 375×812.

### Gates (reexecutados pelo tester)
| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | 0 avisos |
| Typecheck | `npm run typecheck` | ok |
| Cobertura | `npm run test:coverage` | 431 arquivos, 4988 testes passaram; linhas 99,46% (limiar 90%); `src/server/avaliacoes` 98,09% |
| Build + E2E | `npm run test:e2e` (faz `next build`) | 171 passed |
| E2E ambiente limpo | `.env` removido temporariamente, sem `DATABASE_URL`/`TEST_DATABASE_URL`, `LANG=en_US.UTF-8`, `npm run test:e2e` | 171 passed (`.env` restaurado) |
| Estabilidade CA-10 | `tests/integration/avaliacoes/concorrencia.test.ts` ×10 | 10/10 verdes (6 testes cada), sem impasse nem 23505 |
| Fuso | `TZ=UTC` e `TZ=America/Sao_Paulo`: `src/server/avaliacoes`, `format.test.ts`, `src/app/(publico)` | 296/296 nos dois |
| Integração clientes (D-031) + avaliações | `vitest run --project integration tests/integration/clientes tests/integration/avaliacoes` | 195 passed; D-031 inalterada |

### CAs
CA-1/2 (`convite.test.ts`, worker real, token fora de mensagem/tentativas/jobs/logs), CA-3/4/5/6/9/12/13/14 (`envio.test.ts`), CA-7/8/11/15 (`visibilidade.test.ts`), CA-10 (`concorrencia.test.ts`), CA-16 (`e2e/avaliacao*.spec.ts`: teclado, axe, sem JS, cabeçalhos reais strict-origin/no-store/noindex), CA-17 (`drift.test.ts`, `esquema.test.ts`): todos PASSARAM. Verificação própria em `tests/integration/avaliacoes/independente-tester.test.ts` (3 testes, passam): 8 recusas (usado, nao_compareceu, anonimizada, outro salão, token implausível, token alterado, vencido em `agora = criação + 30 d` exatos) devolvem o mesmo `{resultado:'link_invalido'}` e a fotografia das tabelas não muda; GET igual, com fronteira `<` (1 ms antes ainda válido); 16 envios simultâneos = 1 `enviada` + 15 `link_invalido` e 1 linha; média/contagem só de concluídas, não anonimizadas, não retiradas (4,5 com 2 de 4), isolamento entre salões, nome "Ana L.", comentário `<script>` cru (React escapa).

### Revisão estática
- Token: HMAC determinístico, só SHA-256 gravado, busca por igualdade do hash sobre UNIQUE; sem rota por reserva+telefone; cabeçalhos `strict-origin`, `no-store`, `noindex` na regra `/:slug/avaliar/:token`; logs só com `salaoId`/motivo.
- Ordem de travas reserva FOR SHARE → cliente FOR SHARE → convite FOR UPDATE; 23505 nunca capturado; gancho de anonimização dentro da transação (falha desfaz, testado).
- Migração aditiva (2 tabelas), sem drift; as atualizações de `drift.test.ts`, `template.test.ts`, `recuperacao-senha-paginas.test.ts`, `navegacao.test.ts` e `convite.test.ts` só acrescentam (nada enfraquecido; `convite.test.ts` só mudou o título e o cenário continua afirmando `falhou/link_indisponivel`).
- Sem exclusões de cobertura novas.

### Defeitos
Nenhum crítico, alto ou médio aberto.

Observações (baixas, sem defeito):
- OBS-1 Limite excedido na página (GET e ação) responde HTTP 200 com mensagem genérica, não 429 (aceito como na D-027; dev.md §4b).
- OBS-2 Rotação de `AVALIACAO_SEGREDO` mantém o hash antigo (`ON CONFLICT DO NOTHING`): reenvio após a rotação gera link que não casa. Documentado (R-6, README).
- OBS-3 A página com token sem banco responde 500, só em ambiente sem banco; os E2E verificam os cabeçalhos mesmo assim e passam no ambiente limpo.
- OBS-4 `CLAUDE.md` ainda não descreve a D-032 (pendência do líder, já registrada no dev.md).

Arquivo criado pelo tester: `tests/integration/avaliacoes/independente-tester.test.ts`. Estado final: só o postgres no ar.
