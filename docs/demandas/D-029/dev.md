# D-029 (E3.4) — Desenvolvimento

## 1. Tarefas e arquivos
- **T-1** `src/server/reservas/{tipos,criar-reserva,encaixe}.ts` (+ `encaixe.test.ts`, `criar-reserva.test.ts`); `src/server/reserva-publica/servico.ts` (um `case` novo no `switch`, inalcançável no público).
- **T-2** `src/server/reservas/{reserva-equipe,reservas-equipe.acao}.ts` (+ `reserva-equipe.test.ts`); `tests/integration/reservas/equipe/{apoio,equipe,concorrencia,paginas}`.
- **T-3** `src/app/painel/agenda/nova/**` (page, `acoes.ts`, `estado.ts`, `FormularioReservaManual.tsx`, `pre-preenchimento.ts`, CSS), `src/app/dev/reserva-nova/**`, link "Nova reserva" (`links.ts` `hrefNovaReserva`, `VistaDaAgenda`, `Agenda.module.css`, `MENSAGENS_AGENDA.novaReserva`), `ROTAS.devReservaNova`, `e2e/reserva-nova*.spec.ts`.
- **T-4** README (seção "Reserva manual e encaixe"). O CLAUDE.md fica com o líder.

## 2. Como ficou (resumo)
- `criarReserva` ganhou `deps.decidirEncaixe` (só `modo: 'encaixe'`, depois das travas, antes do upsert; `motivos` desfaz via `DesfazerReserva` → `encaixe_requer_confirmacao`) e `deps.consentimentoOpcional` (só equipe). Sem as duas, o comportamento da D-025 e do fluxo público é idêntico (o flag gravado segue `modo === 'encaixe'`). `RangeError` se usadas fora do contexto.
- `detectarMotivos` (puro) usa `partesLocais`/`somarDias` de `fuso.ts`; `criarReservaDaEquipe` converte data+hora com `instanteDeHoraLocal` e lê jornada/bloqueios/funcionamento com o `r` da transação (as mesmas consultas dos `lerSemana`/`lerBloqueios`/`lerFuncionamento`).
- Autorização: `exigirPermissao('reserva.criar')`, id malformado/de outro salão → 404, outro profissional do mesmo salão (papel profissional) → 403.

## 3. Comandos e resultados
- `npm run lint` (0 avisos), `npm run typecheck`, `npm run build` (`/painel/agenda/nova` e `/dev/reserva-nova` dinâmicas): passaram.
- `npm run test:coverage`: 400 arquivos, 4680 testes passando; **99,47%** de linhas (arquivos novos 94–100%). Uma execução anterior teve 1 timeout de 5 s em `harness/template.test.ts` sob carga (flaky de recriação de base; passa isolado 3x e na execução seguinte completa).
- `npm run test:e2e`: 147 passaram (inclui `reserva-nova*.spec.ts`: 8).
- Estabilidade 10x: `tests/integration/reservas/equipe/concorrencia.test.ts` + `reservas/concorrencia` + `reservas/idempotencia`: 10/10 verdes.
- Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/reservas`, `src/app/painel/agenda`, `src/app/dev/reserva-nova` e `tests/integration/reservas/equipe`: 160/160 em ambos.

## 4. Testes por CA
- CA-1/2/3/5/6/7/8/9/10/11/12/13/17/18: `tests/integration/reservas/equipe/equipe.test.ts` (PostgreSQL real; CA-3 sem cliente nova nem mensagem; CA-13 por `deps.politica` e pela ação; CA-18 com Manaus, virada de dia e DST de Santiago em 2027). Unidade: `encaixe.test.ts` (jornada, bloqueio, funcionamento, meia-noite, DST, fuso), `reserva-equipe.test.ts`, `criar-reserva.test.ts`.
- CA-14: `concorrencia.test.ts` (10 encaixes paralelos: 1 criada e 9 `horario_indisponivel`, sem cliente/mensagem órfã; encaixe × público; mesma chave ×10).
- CA-4/15/16/17 (página e casca): `paginas.test.ts` (sessões reais, 401/403/404, isolamento do formulário, primeiro envio com aviso, reenvio confirmado, duplo envio).
- CA-15/16 E2E: `e2e/reserva-nova.spec.ts` (teclado, foco no aviso/resultado, axe, 375×812, link da agenda) e `e2e/reserva-nova-sem-js.spec.ts`.
- UI: `FormularioReservaManual.test.tsx`, `estado.test.ts`, `pre-preenchimento.test.ts`, `VistaDaAgenda.test.tsx`, `/dev/reserva-nova/*.test.*`.

## 5. Desvios e riscos
- **D-1** Consentimento da equipe: o desenho citava `CaixasConsentimento`, mas ela traz a caixa obrigatória e o convite (que a equipe não declara). O formulário usa uma única caixa opcional com o texto de `TEXTOS_CONSENTIMENTO.mensagens_reserva` (lido da config, sem cópia). Para CA-5 foi preciso `deps.consentimentoOpcional` (não previsto no desenho), pois `criarReserva` recusava aceite ausente também para a equipe.
- **D-2** `decidirEncaixe` lê com o `r` da transação (e não com `lerSemana` & cia, que usam `repos()` global): evita segurar duas conexões por reserva (esgotamento do pool em concorrência). Mesmas consultas de repositório.
- **D-3** Um `case 'encaixe_requer_confirmacao'` em `reserva-publica/servico.ts` (exigência do `switch` exaustivo; inalcançável no público).
- **D-4** `baseNovaReserva` é prop opcional de `VistaDaAgenda` (sem ela não há link), para não quebrar testes existentes.
- **D-5** Dois guardas estáticos antigos foram ajustados porque o desenho põe a casca em `src/app/painel/agenda/nova/` e faz a `src/app` importar `@/server/reservas/*`: `tests/integration/reservas/estrutura.test.ts` agora proíbe só `@/server/reservas/criar-reserva` e `aposRevalidar` em `src/app`/`src/worker`; `tests/integration/agenda/estatico.test.ts` exclui `agenda/nova/` da regra "agenda somente leitura" (a agenda em si segue sem ação).
- Risco aceito (D-025): bloqueio criado entre a detecção e o INSERT.
- Data/hora do formulário: `type=date` nativo + texto `HH:MM`. Nos passos de Tab, o seletor de data tem paradas internas; o E2E só confere o contorno na primeira.
- Pendências: nenhuma TODO. Comando de estabilidade novo para o CLAUDE.md (líder): o do README, seção "Reserva manual e encaixe".
