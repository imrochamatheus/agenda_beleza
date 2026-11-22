# D-044 (E8.2) Salões no painel do super admin: testes

## Rodada 1 (tester, independente)
Ambiente: branch feat/d-044-saloes-admin (não commitada), Node 24, PostgreSQL 17 (docker), adaptadores simulados, Chromium 375×812. Porta 3000 ocupada pelo `next dev` do usuário (preservado, `.next` dele intacto): build e `next start` rodaram numa CÓPIA em outro diretório, porta 3100, com config temporária (removida).

## Comandos e resultados (reexecutados)
- `npm run lint`: passa (0 avisos). `npm run typecheck`: passa.
- `npm run build` (cópia): passa; `/admin/saloes`, `/admin/saloes/[id]` dinâmicas.
- `npm run test:coverage`: 543 arquivos, 6400 testes passam; linhas **98,92%** (limiar 90%); `src/server/admin` 97,83%, `repos/admin-saloes.ts` 100%, `app/admin/saloes` 100%. Sem exclusões novas.
- Unitários em `TZ=UTC` e `TZ=America/Sao_Paulo` (admin, app/admin, dev/admin-saloes, config, lib): 359/359 em ambos.
- Estabilidade ×10 de `tests/integration/admin-saloes/concorrencia.test.ts` + meu teste de atomicidade: 10/10 (14 testes cada), sem impasse.
- E2E `admin-saloes.spec.ts` + `admin-saloes-sem-js.spec.ts` (porta 3100, mesmo Playwright do repo): 33/33 (teclado, axe 4.14.0, 375×812, sem JS, N inválido `1e1/+5/0/91/5.5/vazio`). `docker/smoke.sh` não rodado (instrução). `admin-entrar.spec.ts:90` (porta 3000 fixa) não executado: artefato conhecido.
- Teste novo meu: `tests/integration/admin-saloes/tester-atomicidade.test.ts` (4 passam). Gatilho de banco recusa a auditoria de sucesso: suspender, reativar, editar (nome+slug+grade+e-mail do gestor) e estender revertem TUDO (slug/histórico, e-mail, sessões do gestor, `teste_fim_em`); nada auditado como sucesso.

## CAs
| CA | Status | Evidência |
|---|---|---|
| CA-1 lista/paginação/busca/filtros/contagem constante | passou | `lista.test.ts`, E2E (20 de 23, Próxima), `admin-saloes.ts` SQL único `count(*) OVER()`, JOIN no índice parcial (plano do dba.md; página além do fim = vazio) |
| CA-2 suspender/reativar + capacidade `agendar` | passou | `suspensao.test.ts`; motivo obrigatório; auditoria com motivo |
| CA-3 só `suspenso_manual_em`, assinatura/sessões intactas, 2ª vez `sem_efeito` | passou | `suspensao.test.ts`, concorrência (1 auditoria) |
| CA-4 estender | passou | `extensao.test.ts` (D+N, `sim_mp_adiamento`, auditoria D e D+N) |
| CA-5 recusas sem chamar provedor | passou | `extensao.test.ts` (inclui folga de 5 min) |
| CA-6 N inválido | passou | `validarDias` `^[1-9]\d?$`; unit + E2E |
| CA-7 falha do provedor | passou | nada muda; auditoria `falha` em conexão própria; real `NaoImplementado` |
| CA-8 edição reutiliza E2.5 | passou | `validarRegras`/`normalizarSlug`/`validarNovoSlug`/`trocarSlug` importados, sem regra copiada; diff só do alterado |
| CA-9 e-mail do gestor | passou | minúsculas, 23505 fora da transação, desconfirma, revoga só sessões do gestor, token e e-mail após commit, senha intacta |
| CA-10 acesso | passou | `acoes.test.ts` (401, 403 real para gestor/profissional/admin sem TOTP, 404); páginas via `exigirAcessoAoAdmin` |
| CA-11 concorrência ×10 | passou | ver acima |
| CA-13 escopo/DTO sem segredos | passou | `provedor_assinatura_id` só em `lerParaExtensao`; detalhe expõe `vinculada` booleano |
| CA-14 E2E/seed/README | passou | CLAUDE.md não editado ainda (líder) |

## Foco de segurança/correção
- Auditoria na mesma transação: confirmado (teste meu). `adiarProximaCobranca` fora da transação: confirmado (código + teste de corrida `aposProvedor`).
- Motivo: só em `depois.motivo`; hrefs só levam `q/estado/suspenso/pagina`; nenhum log no módulo; o POST devolve o eco do motivo no estado (resposta do POST, não URL/GET). Detalhe não lê auditoria.
- `contextoDeSistema(salaoId,'admin-saloes')`: criado só após `defineAcaoAdmin` + `ehUuid` + existência (`exigirSalao`); escopo restrito ao salão informado; risco de vazamento entre salões: baixo (admin já é de plataforma). Aceito.
- Extensão não trava `salao` (desvio documentado, travas `assinatura` apenas): sem impasse nos ×10 e no teste com `pg_stat_activity`.
- Menu admin: só "Salões" (teste garante `page.tsx`); "Avaliações" continua só no atalho de `/admin` (design permitiu). Ajustes de testes existentes (`usePathname` nos mocks; `paginas.test.ts` passa a exigir `/admin/saloes` e a proibir mensagens/auditoria) não enfraquecem. D-033/D-034/D-035/D-037/D-042: suíte completa verde (6400).

## Revisão visual (capturas minhas 375/768/1280 de `/dev/admin-saloes`, lista, detalhe e detalhe-suspenso, em diretório temporário fora do repo)
- Selos: ícone SVG `aria-hidden` + texto, formas distintas (círculo, relógio, triângulo, traço, cadeado); suspensão manual em variante erro com cadeado; nenhuma palavra partida (quebram só entre palavras).
- Hierarquia: h1 único, DataList com legenda "Salões da plataforma", empilhada em 375, tabela em ≥768; detalhe em coluna de 40rem com filetes.
- Tokens: `Saloes.module.css` sem cor literal (grep de `#`/`rgb`/`hsl` vazio), só `var(--…)`; breakpoint único 48rem. Foco: sem `outline:none`; foco por `:focus` com `--cor-foco`; axe zero violações (inclui contraste AA) nos estados do E2E.
- Sem rolagem horizontal (scrollWidth = largura) nas três larguras e três vistas. Sem JS: fluxos completos (E2E).
- Observação baixa (não bloqueante): em 768 e 1280 os selos da coluna Assinatura quebram em 2 linhas ("Em período de / teste") por largura estreita da coluna; legível, apenas menos compacto.

## Defeitos
Nenhum crítico, alto ou médio. DEF-1 (baixa, cosmético, aberto): selos quebram em duas linhas em tabelas de 768/1280.

## Veredito: APROVADO
