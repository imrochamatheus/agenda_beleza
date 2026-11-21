# D-029 (E3.4) — Desenho: reserva manual e encaixe

## 1. Solução
`criarReserva` ganha um único ponto de extensão, `deps.decidirEncaixe`, chamado DENTRO da transação logo depois das travas (salão FOR SHARE → profissional FOR NO KEY UPDATE → serviços FOR SHARE) e antes do upsert da cliente. Só é aceito com `modo: 'encaixe'` (equipe) e substitui a revalidação D-018. Ele recebe `{ inicio, fim, fuso, r }` e devolve `{ encaixe: boolean }` ou `{ motivos: MotivoEncaixe[] }`. Se vier `motivos`, a transação desfaz via `DesfazerReserva` com o novo resultado `encaixe_requer_confirmacao { motivos }`. Isso acontece antes do upsert, então não sobra cliente órfã nem mensagem. O flag gravado deixa de ser `modo === 'encaixe'` e passa a ser o `encaixe` devolvido (sem `decidirEncaixe`, mantém o comportamento atual: o modo equipe sem decisor grava `true`, então os testes D-025 continuam verdes). O fluxo público não muda.

Alternativas descartadas:
- Detectar fora da transação: perde a leitura sob o lock do profissional.
- Reusar `antesDaReserva`: roda depois do upsert e só devolve texto.
- Migração ou coluna nova: `reserva.encaixe` já existe.

`fim` é calculado por `montarItens` antes da decisão (movê-lo para antes do upsert é uma mudança local no arquivo).

## 2. Componentes (caminhos)
- `src/server/reservas/tipos.ts`: `MotivoEncaixe = 'fora_da_jornada'|'bloqueado'|'fora_do_funcionamento'`, `MENSAGENS_MOTIVO_ENCAIXE` (pt-BR), a variante `encaixe_requer_confirmacao` em `ResultadoCriarReserva`, `deps.decidirEncaixe`.
- `src/server/reservas/criar-reserva.ts`: ajuste mínimo descrito acima. O `inicio < agora` do modo encaixe continua valendo (RN-5).
- `src/server/reservas/encaixe.ts` (novo, puro): `detectarMotivos({ inicio, fim, fuso, jornada, bloqueios, funcionamento })`. Usa `partesLocais`/`instanteDeHoraLocal`/`intervaloDeDiasInteiros` de `fuso.ts`. Se `fim` cai no dia local seguinte, é fora da jornada.
- `src/server/reservas/reserva-equipe.ts` (novo, sem `next/*`): `criarReservaDaEquipe(ctx, entrada, agora, deps?)`. Passos:
  - valida `data`/`hora` e `confirmarEncaixe` (só `true`/`'on'`);
  - converte para UTC com `instanteDeHoraLocal` usando o fuso do salão, lido por `RepoSalao`;
  - chama `criarReserva` com `modo: 'encaixe'` e um `decidirEncaixe` que lê `lerSemana`, `lerBloqueios` e `lerFuncionamento` com o `r` da transação, sem travar o salão com `FOR SHARE`;
  - o `decidirEncaixe` devolve `{ encaixe: motivos.length > 0 }` se `confirmarEncaixe`, ou `{ motivos }` se há motivo e não houve confirmação.
- `src/server/reservas/reservas-equipe.acao.ts`: `criarReservaManual = defineAcao({ papeis: ['gestor','profissional'], capacidade: 'agendar' })`, handler fino. Autorização: `exigirPermissao('reserva.criar')` mais o alvo. Profissional com `profissionalId` diferente do seu → `AcessoNegado` (403) antes de qualquer leitura. Id de outro salão → `NaoEncontrado` (404), pelo escopo dos repositórios.
- `src/app/painel/agenda/nova/page.tsx`, `acoes.ts` (shell `'use server'` que só converte FormData e resultado), `FormularioReservaManual.tsx` (client). Query de pré-preenchimento: `profissional`, `data`, `hora`.
  - `chaveRequisicao` UUID é gerada no render do servidor e vai em campo oculto.
  - Os campos são os mesmos em todas as respostas: serviços, profissional, data, hora, nome, telefone e `CaixasConsentimento` (origem equipe).
  - O estado `encaixe_requer_confirmacao` volta na resposta (sem PRG), preserva os dados, mostra a lista de motivos e o checkbox "Confirmo o encaixe". O foco vai ao resumo de erros/aviso.
  - O padrão é um `useActionState` por ação, em ordem fixa.
- Agenda E3.3: link "Nova reserva" em `src/app/painel/agenda/page.tsx` (ou `_componentes`), com `ROTAS.novaReserva` mais query. Gestor: profissional da vista; profissional: só o próprio.
- `/dev/reserva-nova` (vitrine; 404 sem `VITRINE_COMPONENTES=true`; `ROTAS.devReservaNova`), com a mesma lógica pura e uma action só de validação, para o E2E sem banco.
- Reuso da D-025: o consentimento usa `registrarConsentimentoDaReserva` (origem equipe), a mensagem usa `registrarMensagem` e `enfileirarMensagens` após o commit. `mensagens_reserva` desmarcado → `nao_enviada` (já é o comportamento da D-024).

## 3. Interfaces
```ts
type DecisaoEncaixe = { encaixe: boolean } | { motivos: MotivoEncaixe[] };
deps.decidirEncaixe?: (ctx: ContextoEscopado, r: Repos,
  d: { inicio: Date; fim: Date; fuso: string; profissionalId: string }) => Promise<DecisaoEncaixe>;
// novo resultado: { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] }
```

## 4. Dados
Sem migração, constraint ou índice novos. As leituras são as existentes (`COLUNAS_FUNCIONAMENTO`, jornada e bloqueio por profissional/dia). **DBA: dispensado**, porque não há mudança de esquema e as leituras já têm índices (D-015/D-016/D-018). O bloqueio criado entre a detecção e o INSERT é risco aceito (D-025).

## 5. Infra
Nenhuma variável de ambiente, container ou CI novos; o E2E roda no job existente. **DevOps: dispensado.**

## 6. Invariantes
- Escopo por salão: ctx tenant e repositórios com escopo; profissional só para si (matriz mais comparação de alvo); ids de outro salão = 404.
- Anti-sobreposição: só a constraint `reserva_sem_sobreposicao` (`23P01` → `horario_indisponivel`), inclusive para encaixe. O INSERT mantém o literal `'confirmado'`.
- UTC e fuso: `data`+`hora` locais → UTC só via `fuso.ts`; formato de exibição só via `format.ts`.
- Adaptadores: nenhum novo; o WhatsApp só pela fila, após o commit.
- Soft delete e anonimização: não se aplicam, só o `upsertCliente`. Cliente anonimizada gera nova cliente.
- Salão suspenso: `politicaPadraoDeReserva` → `AcessoNegado` 403 (CA-13).
- Idempotência: `chaveRequisicao` mais `ON CONFLICT` (D-025); a mensagem tem a chave `reserva:tipo:revisao`.
- Auditoria de super admin: não se aplica.
- Ordem de travas: canônica, sem trava nova. As leituras de detecção vêm depois do profissional FOR NO KEY UPDATE e antes do upsert da cliente.

## 7. Riscos
- R-1: o motivo de encaixe depende das leituras sob a trava. Mitigação: um teste de integração com bloqueio concorrente documenta o risco aceito.
- R-2: o desacoplamento do flag pode quebrar testes da D-025 que esperam `encaixe === true` no modo encaixe. Mitigação: sem `decidirEncaixe`, o comportamento é idêntico; revisar `tests/integration/reservas/` (encaixe) para tratar os usos novos.
- R-3: o resultado novo exige tratar `encaixe_requer_confirmacao` nos `switch` de `ResultadoCriarReserva` (erro de tipo guia a correção).
- R-4: DST, virada de dia e fuso do processo. Mitigação: testes com `TZ=UTC` e `TZ=America/Sao_Paulo`.

## 8. Testes
- Unitários: `encaixe.ts` (jornada, bloqueio, funcionamento, meia-noite, DST, `definido:false`), parsing e validação, `reserva-equipe` com fakes de funções puras → CA-1, 2, 6, 7, 8, 9, 18.
- Integração (PostgreSQL real, `tests/integration/reservas/equipe/`): CA-2 a CA-14 e CA-17 (sobreposição sem cliente órfã nem mensagem, 403/404, `nao_enviada`, 4ª futura, mesma chave, serviço inativo, suspenso, 10 paralelos, isolamento).
- Playwright em `/dev/reserva-nova`: CA-15 (link e rótulo, pelo `e2e` existente da agenda se houver, ou na vitrine), CA-16 (sem JS, teclado, axe, 375×812).
- Cobertura ≥ 90% mantida com os testes dos arquivos novos. Comando de estabilidade novo (×10) para a concorrência do CA-14, a documentar no CLAUDE.md pelo desenvolvedor.

## 9. Tarefas
- **T-1 (desenvolvedor)**: `tipos.ts`, `criar-reserva.ts`, `encaixe.ts` e testes unitários; ajusta os testes D-025 afetados. Sem dependências. Posse: `src/server/reservas/{tipos,criar-reserva,encaixe}*.ts`, `tests/integration/reservas/*` existentes. Pronto quando CA-1/2/6/7/8/9/18 passam em unidade e a D-025 continua verde.
- **T-2 (desenvolvedor)**: `reserva-equipe.ts`, `reservas-equipe.acao.ts` e a integração CA-2 a CA-14 e CA-17. Depende de T-1. Posse: os dois arquivos novos mais `tests/integration/reservas/equipe/**`.
- **T-3 (desenvolvedor)**: `src/app/painel/agenda/nova/**`, `ROTAS.devReservaNova` em `src/config/navegacao.ts`, `/dev/reserva-nova`, o link na agenda e os E2E `e2e/reserva-nova*.spec.ts`. Depende de T-2 para a integração; pode começar em paralelo com T-2 sobre os contratos de T-1, e não compartilha arquivos com T-2. Posse: `src/app/painel/agenda/**`, `src/app/dev/reserva-nova/**`, `src/config/navegacao.ts`, `e2e/reserva-nova*`. Pronto quando CA-15 e CA-16 passam.
- **T-4 (desenvolvedor)**: README e CLAUDE.md (comandos de estabilidade e fuso), mais a conferência do gate de cobertura. Depende de T-2 e T-3.
- T-2 e T-3 são paralelas depois de T-1.
