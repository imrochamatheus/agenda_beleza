# D-047 (E7.2): dev

## Tarefas e arquivos
- T-1: `src/server/integrations/whatsapp/mapeamento.ts` (puro; único lugar com formato/códigos da Meta; classificação por `error.code`, 5xx/429 vencem, 401/403 com código desconhecido = `configuracao_invalida`) e `mapeamento.test.ts`.
- T-2: `whatsapp/ambiente.ts` (8 `CHAVES`, `VERSAO_API_PADRAO = 'v25.0'`, `IDIOMA_PADRAO`, sem imports) e testes `ambiente`, `env`, `check-env`, `worker/iniciar` atualizados. `env.ts` e `scripts/check-env.test.ts` sem mudança.
- T-3: `http.ts` (timeout 10 s, `redirect:'manual'`, zero retentativa), `real.ts`, `registry.ts` (`selecionarWhatsApp(ConfigIntegracao)`), `nao-implementado.ts` (só comentário), testes `http`, `real` (servidor `node:http`), `registry`, `tests/integration/integracoes/whatsapp-real.test.ts` (CA-12), `tests/integration/mensagens/migracao.test.ts` (o teste do stub NaoImplementado virou contrato do 4º modelo no real).
- T-4: `.env.example`, `README.md` (tabela de adaptadores, validação na inicialização, seção WhatsApp com PENDENTE DE VALIDAÇÃO NA META e lista de `erro_codigo`), `docs/whatsapp-templates.md`, `tests/integration/integracoes/documentacao.test.ts`. `docker-compose.yml` conferido: app e worker herdam `env_file` (sem mudança); `e2e/suporte/ambiente.ts` segue simulado.

## Gates
- `npm run lint` e `npm run typecheck` (inclui testes): passam.
- `npm run test:coverage`: 571 arquivos, 6804 testes passam; linhas 98,93%.
- `npm run build` feito numa CÓPIA em /tmp (porta 3000 ocupada por processo do usuário, não tocado): passa; `build:node` e `check-env` com `WHATSAPP_ADAPTER=real` sem credenciais saem com 1 nomeando as variáveis.
- `tests/integration/mensagens` (D-024) e `integracoes`: verdes dentro da suíte de cobertura.
- E2E e `sh docker/smoke.sh`: NÃO executados (porta 3000 ocupada); sem UI/compose alterados. Ficam para a CI.

## Desvios e riscos
- Versão padrão `v25.0` (design), não `v23.0` da spec.
- Duplicidade rara em timeout pós-aceite (aceita; sem idempotência na Meta). Nada validado contra a Meta real (README lista os itens PENDENTE DE VALIDAÇÃO NA META).
- Campos de `mensagem_tentativa.resultado` é `falha` (não distingue temporária/permanente; o tipo está no estado da mensagem).
