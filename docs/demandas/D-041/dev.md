# D-041 (E6.2) - Webhooks do Mercado Pago - dev

## Tarefas concluídas
- T-1: `src/server/repos/webhook.ts` (`RepoWebhookSistema`: `registrar` com `ON CONFLICT (provedor, chave_dedupe) WHERE origem_valida DO NOTHING`, `reivindicar` (CAS/lease por `recebido_em`), `vincularSalao`, `concluir`); `RepoAssinaturaSistema.buscarPorProvedor` em `repos/assinatura.ts`; reexport em `repos/index.ts`; campo opcional `corpoBruto?` em `NotificacaoWebhook` (`integrations/mercadopago/port.ts`).
- T-2: `src/server/assinatura/webhook-decisao.ts` (puro: `extrairChave`, `sanitizarPayload`, `reconhecerRecurso`, `mapearConsultado`); `retorno.ts` (`processarAutorizada` aceita `eventoId`); `webhook-estatico.test.ts`.
- T-3: `webhook.ts` (`receberWebhook`), `webhook-http.ts` (`tratarWebhook`, corpo ≤ 16 KiB em streaming), `src/app/api/webhooks/mercadopago/route.ts` (POST; demais métodos 405).
- T-4: `webhook-concorrencia.test.ts`, README (seção "Assinatura: webhooks do Mercado Pago"). `CLAUDE.md` NÃO editado (o líder atualiza).

## Testes e CAs
- Unit `src/server/assinatura/webhook-decisao.test.ts` (CA-3 mapeamento, CA-4 e CA-12 sanitização/chave), `webhook-estatico.test.ts` (CA-12 rota sem repos/Prisma, CA-13 matcher e segredo).
- Integração (PostgreSQL real, MP simulado): `webhook-repo.test.ts` (dedupe, CAS, lease; CA-5), `webhook.test.ts` (CA-1..CA-10, isolamento, persistir antes e consulta fora de transação por `pg_stat_activity`, limite de inválidos, rota `POST`), `webhook-concorrencia.test.ts` (CA-11: 10 salões em paralelo, 10 notificações do mesmo pagamento, mesma chave x10, webhook x retorno x job).

## Gates
- `npm run lint`: ok (0 avisos). `npm run typecheck`: ok. `npm run build`: ok (rota `/api/webhooks/mercadopago` dinâmica).
- Estabilidade x10 de `webhook-concorrencia` + `webhook`: 10/10 verdes (31 testes cada), sem 23505 nem 40P01.
- `npm run test:coverage`: ok, linhas 98,78% (limiar 90%); `webhook.ts` 91,9%, `webhook-http.ts` 97,3%, demais arquivos novos 100%.
- Sem datas locais novas (tudo UTC, `agora` injetado): fuso do processo irrelevante; não rodei o laço de dois fusos.
- E2E completo: 237 passaram, 1 falhou (`admin-entrar.spec.ts:90`), falso negativo do ambiente: a porta 3000 estava ocupada por um `next-server` do usuário (pid 1699112, NÃO encerrado), então rodei com config temporária (já apagada) na porta 3100, e o spec compara com `http://127.0.0.1:3000` fixo. Reexecutar com a 3000 livre para confirmar. Nenhum spec novo (sem UI).

## Desvios e riscos
- `EntradaWebhook` ganhou `corpo?: unknown` (JSON parseado) além do desenho; `RespostaWebhook` tipado como união.
- `recurso_id` também fica NULL se tiver 13+ dígitos (além do regex do desenho).
- A redação usa `\d{13,}` (não só 13-19), para que nenhuma subsequência de 13-19 dígitos sobreviva.
- Evento válido sem `x-request-id` vira inválido (401, rejeitado), conforme o desenho.
- Corrida: entrega concorrente sobre `recebido` recente responde 200 sem processar; se o processo cair, a reentrega após 2 min reivindica (R-1).
- Sem migração, env, UI. O adaptador real (E6.6) ainda precisa implementar `validarWebhook` com `corpoBruto`.
