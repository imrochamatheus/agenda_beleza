# D-027 (E4.2) — Design: proteção da página pública

## 1. Resumo e decisões das suposições
Módulo `src/server/protecao/` (sem `next/*`, sem `'use server'`) sobre `rate_limit_janela` (`incrementarJanela`), sem tabela nova.
- **S-1 (decidido):** sem 429 real na página GET. O serviço devolve `limitado`; a página mostra aviso pt-BR sem calcular (CA-14). A ação de reserva (POST) é shell `'use server'`, que não fixa status; o 429 HTTP é entregue só onde há route handler. Descartado: `proxy.ts` contando GET (roda no edge, sem banco, e quebra a regra "proxy só confere cookie"). CA-3/CA-8 verificados no serviço (integração) e na UI (aviso). Registrar a limitação no README.
- **S-2 (confirmado):** contador do número não é devolvido.
- **S-3 (confirmado):** chave `pub:reserva:tel:<HMAC-SHA256(RATE_LIMIT_SEGREDO, salaoId + ':' + E.164)>`.
- **S-4:** o PLAN.md não traz valores numéricos (só "limite por IP e por número", "3 futuras", captcha). Padrões propostos e documentados: janela 15 min (`PROTECAO_JANELA_SEGUNDOS=900`); IP reserva 10; IP disponibilidade 60; IP avaliação 5; IP denúncia 5; número 5; futuras 3 (constante do PLAN, não env). Via env: `PROTECAO_LIMITE_IP_RESERVA|DISPONIBILIDADE|AVALIACAO|DENUNCIA`, `PROTECAO_LIMITE_NUMERO`, `PROTECAO_JANELA_SEGUNDOS`.
- Alternativa descartada: contar futuras com trigger/constraint (regra de negócio no banco, mensagem não controlável); descartada também biblioteca externa de rate limit (já existe `incrementarJanela`).

## 2. Componentes
- `src/server/protecao/config.ts` (lê env validada; padrões), `ip.ts` (`extrairIp(headers, hops)`: hops 0 ignora XFF e `x-real-ip`, usa só o IP da conexão quando disponível, senão `desconhecido`; N>0 = N-ésima entrada da direita; normaliza `::ffff:a.b.c.d`; valida com `node:net.isIP`; ilegível → `desconhecido`), `chaves.ts` (`chaveIp(escopo, ip)` = `pub:<escopo>:ip:<sha256>`, `chaveNumero(salaoId, e164)` HMAC), `limite.ts` (`limitarPorIp(ip, escopo, agora)`, `limitarPorNumero`), `turnstile.ts` (`verificarHumano(token, ip)` falha fechada), `futuras.ts` (`criarAntesDaReserva({ chave })`), `tipos.ts` (client-safe, mensagens pt-BR), `limpeza.ts`.
- `src/server/repos/rate-limit.ts`: acrescentar `removerExpiradas(antes: Date, lote: number)` (DELETE por lote com subselect `ctid`/id usando índice `janelaInicio`).
- `src/server/repos/reserva.ts`: `contarFuturasPorTelefone(ctx, { clienteId, agora, ignorarChave })` — SQL com o literal `'confirmado'`, `inicio > $agora`, `salao_id` do ctx, mesma `cliente_id`; cliente anonimizada não conta (sem telefone).
- `src/server/reserva-publica/servico.ts`: orquestra a ordem RN-7: salão suspenso/indisponível (CA-17) → IP → Turnstile → validação/normalização do telefone → número → `criarReserva({ antesDaReserva })`. Consulta de disponibilidade chama `limitarPorIp(ip,'disponibilidade')` antes de `consultarDisponibilidade`.
- `src/app/(publico)/[slug]/`: página lê `headers()`, repassa o IP ao serviço; aviso de limite sem cálculo. Widget `WidgetTurnstile.tsx` (client; simulado: campo oculto `cf-turnstile-response` com `XXXX.DUMMY.TOKEN.XXXX` e, só quando `VITRINE_COMPONENTES`/dev, controle para token inválido; real: script oficial + `TURNSTILE_SITE_KEY` passada como texto). Sem JS: o simulado é `<input type=hidden>` renderizado no servidor; o real exige JS (documentar).
- `src/worker/handlers/limpar-rate-limit.ts` + registro em `registry.ts`: cron UTC a cada hora; remove `janela_inicio < agora - (maior janela + 1 h)`, lotes de 1000 até esgotar; idempotente (CA-12).
- Atenção: login/recuperação/confirmação usam janelas de 15 min e chaves próprias; a limpeza usa o maior valor entre elas e `PROTECAO_JANELA_SEGUNDOS`.

## 3. Interfaces
```ts
type EscopoIp = 'reserva' | 'disponibilidade' | 'avaliacao' | 'denuncia';
limitarPorIp(ip: string, escopo: EscopoIp, agora: Date, deps?): Promise<{ permitido: true } | { permitido: false; reiniciaEm: Date }>;
extrairIp(h: { get(n: string): string | null }, hops: number, socket?: string | null): string;
verificarHumano(token: string | null, ip: string): Promise<boolean>; // porta integracoes().turnstile
criarAntesDaReserva(a: { chave: string; agora: Date }): DependenciasCriarReserva['antesDaReserva'];
```
Janela fixa: `janelaInicio = floor(agora / janela) * janela`. `limitarPorIp` e `limitarPorNumero` incrementam e comparam `contador > limite` (a chamada K+1 é negada). Mensagens: `Muitas tentativas. Aguarde alguns minutos e tente novamente.`; futuras: `Não foi possível concluir o agendamento com este número. Fale com o salão.` (sem revelar). Novo resultado do serviço público: `limitado` (IP/número) além de `recusado`.

## 4. Dados
Sem migração. Consulta de futuras usa o índice de `reserva` por salão/cliente; **DBA dispensado para esquema, mas solicito parecer curto** (plano de `contarFuturasPorTelefone` e do DELETE em lote por `janelaInicio`; índice existente? se faltar, só ele cria a migração). Avaliar se o DELETE em lote disputa linha com `incrementarJanela` (linhas expiradas nunca são atualizadas; sem conflito).

## 5. Infraestrutura (DevOps dispensado)
Só variáveis: `TRUSTED_PROXY_HOPS` (inteiro 0–10, inválido falha em `check-env`, CA-15), `RATE_LIMIT_SEGREDO` (≥ 32 chars; obrigatório com `NODE_ENV=production`, padrão fixo de dev só fora de produção), os `PROTECAO_*` acima, e `TURNSTILE_SITE_KEY` exposta ao servidor e passada como texto ao widget. Atualizar `src/server/env.ts`, `.env.example`, `docker-compose.yml` (se listar env), README e tabela de comandos do CLAUDE.md. CI sem mudança, portanto o DevOps é dispensado (a edição de compose é trivial e vai na tarefa do desenvolvedor).

## 6. Invariantes
- **Escopo por salão:** contagem de futuras e chave do número incluem `salao_id`; salão B não afeta A (CA-1/2).
- **Exclusion constraint:** intocada; o literal `'confirmado'` na contagem não afeta o índice parcial (a contagem não é por profissional).
- **UTC:** `agora` injetado; janela calculada em UTC.
- **Adaptadores:** Turnstile só por `integracoes().turnstile`; HMAC/IP sem dado pessoal em claro (CA-9).
- **Soft delete/anonimização:** cliente anonimizada tem telefone nulo e não conta.
- **Suspenso:** a checagem de D-026 vem antes de consumir cota.
- **Webhooks/mensagens:** não se aplicam; idempotência da reserva preservada (§7).
- **Auditoria super admin:** não se aplica.

## 7. Concorrência (CA-7) e idempotência
Ordem de locks canônica preservada: salão `FOR SHARE` → profissional `FOR NO KEY UPDATE` → serviços → upsert da cliente (`ON CONFLICT DO UPDATE` trava a linha da cliente até o commit) → `antesDaReserva` → INSERT. A contagem de futuras roda DEPOIS do upsert; uma segunda transação do mesmo número bloqueia no upsert até o commit da primeira, e como o READ COMMITTED toma um snapshot por comando, a contagem posterior enxerga a reserva comitada. Isso cobre também profissionais DIFERENTES (a trava do profissional sozinha não cobriria; a da cliente cobre). Sem inversão de ordem de locks (cliente sempre depois de profissional), logo sem impasse. Cliente nova: o `ON CONFLICT` do concorrente espera a inserção comitada. Nenhum `FOR UPDATE` extra nem lock novo.
Idempotência: `contarFuturasPorTelefone` exclui a reserva de mesma `chave_requisicao`, e se ela existir `antesDaReserva` devolve `permitido` (o INSERT depois responde `chave_repetida` → `repetida`); `repetida` nunca é recusada por futuras e não consome cota extra do número (a cota do número é consumida só quando a chave ainda não existe: o serviço checa a chave por leitura antes de `limitarPorNumero`). O `salao`, o profissional e a janela do contador de IP não são tocados dentro da transação.
Recusa por futuras → `DesfazerReserva` existente desfaz upsert/consentimento (CA-16).

## 8. Riscos
- R-1: janela fixa permite burst 2× (aceito, documentado).
- R-2: `x-forwarded-for` forjado com hops 0 (ignorado) e hops errado (documentar; padrão 0 seguro, balde único se o IP do socket não existir: usuários legítimos compartilham o limite, aceito).
- R-3: Turnstile real depende de JS; sem JS só o simulado funciona (documentar).
- R-4: `limitarPorIp` na página GET faz escrita por consulta; mitigado por limite alto (60) e incremento atômico único.
- R-5: o contador do número é consumido por tentativas sem reserva (S-2); limite do número 5 > futuras 3 reduz o impacto.
- R-6: `RATE_LIMIT_SEGREDO` rotacionado zera a contagem por número (aceito).

## 9. Testes
Unitário: `ip.ts` (hops 0/1/N, IPv6, `::ffff:`, ilegível), `chaves.ts`, `limite.ts` com relógio injetado, `config`/`check-env` (CA-15), `limpeza`, widget (jsdom).
Integração (PostgreSQL real): CA-1..CA-4, CA-6 (via função de extração + serviço), CA-7 (5 e 10 paralelas, mesmo número, profissionais diferentes e iguais, exatamente 1 aceita quando já há 2 futuras), CA-8, CA-9 (varredura de `rate_limit_janela`), CA-11, CA-12, CA-16, CA-17, idempotência (`repetida`), isolamento entre salões, estabilidade ×10.
Playwright sem banco: CA-5/CA-10/CA-13 (widget simulado, token ausente/inválido, sem JS), CA-14 (aviso). Cobertura ≥ 90% mantida por testes de todo arquivo novo.

## 10. Tarefas
- **T-1 (dba, paralela com T-2):** parecer sobre planos e índice (§4). Arquivos: `docs/demandas/D-027/dba.md`. Conclusão: parecer registrado; migração só se necessária.
- **T-2 (desenvolvedor, paralela com T-1):** núcleo puro: `protecao/{config,ip,chaves,tipos}.ts` + testes; `env.ts`, `check-env.ts`, `.env.example`, `docker-compose.yml`. Conclusão: CA-6 (unidade), CA-15.
- **T-3 (desenvolvedor; dep. T-2):** `repos/rate-limit.ts` (`removerExpiradas`), `protecao/{limite,limpeza}.ts`, `worker/handlers/limpar-rate-limit.ts`, `registry.ts`. Conclusão: CA-11, CA-12, incrementos paralelos.
- **T-4 (desenvolvedor; dep. T-2, T-1):** `repos/reserva.ts` (`contarFuturasPorTelefone`), `protecao/{futuras,turnstile}.ts`. Conclusão: CA-1, CA-2, CA-5, CA-7, CA-16.
- **T-5 (desenvolvedor; dep. T-3, T-4):** `reserva-publica/{servico,tipos,estado}.ts`, página `(publico)/[slug]`, `WidgetTurnstile.tsx`, ação shell. Conclusão: CA-3, CA-4, CA-8, CA-10, CA-14, CA-17.
- **T-6 (desenvolvedor; dep. T-5):** `e2e/protecao*.spec.ts`, README, CLAUDE.md. Conclusão: CA-13, CA-9, E2E passando.
T-2 e T-1 em paralelo; T-3 e T-4 em paralelo só depois de T-2 (arquivos disjuntos: T-3 toca `repos/rate-limit.ts`, T-4 toca `repos/reserva.ts`).
