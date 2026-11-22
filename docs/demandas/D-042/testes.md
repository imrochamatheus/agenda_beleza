# D-042 (E6.5) — testes (tester)

## Rodada 1 — veredito: APROVADO
Ambiente: branch feat/d-042-assinatura-painel (não commitada), Node 24, PostgreSQL 17 (docker), Chromium 375x812. Porta 3000 ocupada pelo usuário (não tocada): build e E2E numa cópia em diretório temporário, porta 3207.

## Gates (reexecutados por mim)
- lint e typecheck: limpos. `next build` (cópia): passou.
- `npm run test:coverage`: 521 arquivos, 6145 testes passando; linhas 98,89% (limiar 90). Nenhuma exclusão nova.
- TZ=UTC e TZ=America/Sao_Paulo em `src/server/assinatura src/app/painel/assinatura src/app/dev/assinatura`: 182/182 em ambos.
- `cancelar-concorrencia.test.ts` x10: verde (cancelar x webhook x retorno x cancelar, e cancelar x iniciar).
- E2E `assinatura.spec.ts` + `assinatura-sem-js.spec.ts`: 21/21.
- Migração `20261126000000_...`: só `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, aditiva; `drift.test.ts` e `template.test.ts` passam na cobertura (sem drift).
- `aviso.ts`, `FaixaDoPlano`, webhook, retorno, D-037/38/40/41: sem diff. `varredura.test.ts`: só acrescidas as duas ações. Ajuste do CA-10 da D-040 (cancelada com acesso futuro) confere; o caso vencido está em `iniciar-nova.test.ts`.

## CAs (testes em tests/integration/assinatura/, src/app/painel/assinatura/, e2e/assinatura*.spec.ts)
CA-1 tela.test + E2E (23:30 local); CA-2/3/6/9/11 cancelar.test; CA-4/8/9 cancelar-seguranca (id forjado e estadoVisto fora da lista ignorados; A em_teste x B ativa); CA-5 E2E (etapa 1 é link GET, sem POST; sem JS; teclado; axe); CA-7 concorrência x10; CA-10 iniciar-nova; CA-12 tela/repo-detalhe (<=12, sem ids); CA-13 regularizar; CA-14 dois fusos; CA-15 testes estáticos existentes. Todos PASSARAM.
Pontos extras verificados no código e testes: provedor chamado fora de transação (pg_stat_activity), sem trava de `salao` no cancelar; falha do banco após o provedor -> `tente_novamente` com log só de id; `NaoImplementado`/`ErroMercadoPago` -> "Erro de pagamento" sem alterar estado; RN-8 encerra `cancelada` vencida por evento `prazo` sob trava antes da nova pendente; URL de regularizar só http(s); `estadoVisto` só dica (alvo sempre do ctx); sem dados de cartão.

## Revisão visual (13 critérios, web-design §9)
Capturas geradas por mim (fora do repo) em 375/768/1280 para em_teste, ativa, em_carencia (etapa 2), suspensa, cancelada, encerrada, manual, histórico de 12 e erro: scrollWidth = clientWidth em todas (sem rolagem horizontal).
1 OK (um h1; h2 por seção). 2 OK (frase em Fraunces `--texto-xl`, data `--texto-2xl` 600). 3 OK (CSS só com tokens; `grep` sem #hex/rgb/hsl; um `@media (min-width: 48rem)`). 4 OK (pares do :root, razões do design >= 4,5; axe sem violações). 5 OK. 6 OK (E2E de alvos >= 2,75 rem; botões em coluna a 375). 7 OK (E2E de teclado: primária -> cancelar; foco com contorno do tema). 8 OK (etapa 1 link GET; só "Sim, cancelar" é submit). 9 OK (Alert erro `role=alert`, rótulo "Erro de pagamento:"; Aprovado/Recusado em texto). 10 OK (cancelada/manual sem botões; em_teste sem "Atualizar"). 11 OK (E2E sem JS). 12 OK (sem `toLocale*`/`Intl` na tela; dois fusos). 13 OK (axe 4.14.0 nos 9 estados).
Hierarquia: bloco de estado em `--cor-superficie-alt`, ações e histórico (tabela >= 48rem, cartões no celular) legíveis.

## Defeitos
Nenhum crítico, alto, médio ou baixo.
Observação (não defeito): o adaptador real de `urlAtualizarMeioPagamento` é só contrato (`NaoImplementado('E6.6')`), risco aceito. Artefato conhecido do E2E em porta alternativa (admin-entrar.spec.ts:90) não afetou os specs da assinatura.
