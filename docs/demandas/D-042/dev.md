# D-042 (E6.5) Assinatura no painel — dev

## Tarefas
T-2 porta MP (`urlAtualizarMeioPagamento`: porta, simulado com `forcarErro`, real `NaoImplementado('E6.6')`); T-3 repositório (`lerDetalhe`, `listarPagamentos`, `confirmarProvedor` com `null`), RN-8 em `iniciar.ts`, contratos client-safe; T-4 serviços `cancelar.ts`, `regularizar.ts`, `tela.ts` e três `defineAcao` em `assinatura.acao.ts`; T-5 tela (`src/app/painel/assinatura/`: `page`, `acoes` (casca), `estado`, `textos`, `TelaDaAssinatura` com 3 `useActionState` em ordem fixa, `ConteudoDaAssinatura`, `SituacaoDaAssinatura`, `DadosDaAssinatura`, `AcoesDaAssinatura`, `ConfirmarCancelamento`, `HistoricoDePagamentos`, `LinkBotao`, CSS só com tokens; removidos `Resumo`, `FormularioAssinar`, `plano.ts`); T-6 vitrine `/dev/assinatura` (9 estados, `?cancelar=1`, `?resultado=`, `?historico=0..12`) e E2E; T-8 README.
Fora do desenho original, necessário: `tests/integration/politica/varredura.test.ts` (as duas ações novas da capacidade `assinatura`).

## Gates (TZ padrão; postgres local)
- `npm run lint` e `npx tsc --noEmit`: limpos. `next build`: passou (feito numa cópia do repositório, ver abaixo).
- `npm run test:coverage`: 521 arquivos, 6145 testes passando; linhas 98,89% (limiar 90).
- Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/assinatura src/app/painel/assinatura src/app/dev/assinatura` (182 testes, ambos verdes).
- Estabilidade: `cancelar-concorrencia.test.ts` 10 vezes seguidas, verde (inclui cancelar × webhook × retorno × cancelar ×10 e cancelar × iniciar).
- E2E completo (253 testes, Chromium 375×812) verde; specs da assinatura (21) também sem `.env`/`DATABASE_URL`.
- A porta 3000 estava ocupada por um `next-server` do usuário (pid 1699112, não encerrado; seu `.next` também não foi tocado). O build e o E2E rodaram numa cópia em diretório temporário (fora do repositório) com a porta trocada para 3107 (`127.0.0.1:3000` → `127.0.0.1:3107` em `playwright.config.ts` e `e2e/**`). Nada disso está no repositório.
- Capturas 375/768/1280 (fora do repositório, em `.../scratchpad/capturas/`): sem rolagem horizontal em nenhum caso; hierarquia conferida (h1, bloco de estado em `--cor-superficie-alt`, frase em Fraunces, data em `--texto-2xl`, ações, `Alert` de erro com rótulo "Erro de pagamento:", histórico de 12 em tabela a partir de 48rem).

## Testes e CAs
- `tests/integration/assinatura/`: `cancelar` (CA-2, CA-3, CA-9, CA-11, casos limite: vínculo trocado sob a trava, `estadoVisto`, falha do banco após o provedor com trigger de teste, provedor sem transação aberta por `pg_stat_activity`), `cancelar-concorrencia` (CA-6, CA-7), `cancelar-seguranca` (CA-4, CA-8, CA-9 pela ação), `regularizar` (CA-9, CA-13), `tela` (CA-1, CA-11, CA-12), `iniciar-nova` (CA-10), `repo-detalhe`; `mp-simulado` e `repo-iniciar` estendidos.
- Unitários: `cancelar-tipos.test.ts` (mensagens, `lerEstadoVisto`, matriz de ações; CA-14), `textos.test.ts`, `ConteudoDaAssinatura.test.tsx`, `acoes.test.ts` (casca), `dev/assinatura/page.test.tsx`; porta/real/registry atualizados.
- E2E: `e2e/assinatura.spec.ts` (9 estados, etapa 1 sem POST, teclado, axe, alvos de toque, histórico 0/12, resultados) e `e2e/assinatura-sem-js.spec.ts` (CA-5).

## Desvios e riscos
- `ajuste D-040` (sem enfraquecer): `iniciar.test.ts` CA-10 agora cria a `cancelada` com `acesso_ate` futuro (vencida passou a ser encerrada pela RN-8; o caso vencido está em `iniciar-nova.test.ts`).
- Resultado da ação com `em` (timestamp) em `EstadoAcaoAssinatura` para escolher a mensagem mais recente entre os 3 `useActionState`; variante `aviso` adicionada além de sucesso/info/erro; o `Alert` do resultado usa `rotulosVariante={{ erro: 'Erro de pagamento' }}`.
- `TelaDaAssinatura` também renderiza as ações e a etapa 2 (precisam do dispatch do `useActionState`); só a frase de estado e o histórico são slots de servidor. `resultadoInicial` é opcional e só a vitrine o usa.
- `cancelar`: `NaoImplementado` e `ErroMercadoPago` viram `provedor_indisponivel`; outro erro propaga (defeito, não "erro de pagamento"). `regularizar` rejeita URL do provedor que não seja http(s).
- Risco aceito: adaptador real de `urlAtualizarMeioPagamento` só no contrato (E6.6).
