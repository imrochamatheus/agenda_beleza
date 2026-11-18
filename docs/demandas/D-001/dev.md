# D-001 — Parecer do desenvolvedor sobre a implementabilidade do backlog

Escopo do parecer: verificar se cada sub-issue é clara e implementável de forma independente, com tamanho de PR revisável. Nesta demanda nada é implementado e nenhum código foi criado.

Entradas lidas: `CLAUDE.md`, `PLAN.md`, `spec.md` (blocos `### ITEM`), `design.md` (prosa e bloco `json backlog`) e `devops.md`, para não repetir os pontos que ele já cobre (validação do env na inicialização, `NEXT_PUBLIC_*`, retry em segundos por env, teste `.env.example` × schema, `APP_URL`).

Observação de estado: o `spec.md` ainda **não** reflete os ajustes do §11 do design. Por exemplo, E0.4 ainda traz `status <> 'cancelado'` e a coluna `periodo`, e E3.2 RN-6 continua "não decidida". Este parecer considera o spec já com o §11 aplicado. Os pontos abaixo **complementam** o §11 e não o repetem.

Tamanhos (E3.1, E3.2, E6.3, E7.1): **nenhuma divisão é necessária.** E3.1 é uma função pura com uma consulta, E3.2 é um serviço sem UI e E6.3 é uma máquina de estados com um job. E7.1 cabe em um PR se adotar o outbox (ajuste A-1 abaixo), que remove a parte mais complexa (reconciliação por derivação). E0.5, E0.6 e E0.8 são os PRs mais pesados da fundação. Ficam inteiros, desde que o escopo de repositórios de E0.5 se limite ao que o CA exige (ver tabela).

## 1. Clareza por sub-issue

| chave | clareza | observação |
|---|---|---|
| E0.1 | ajustar | Para cumprir 90% já no primeiro PR, `src/app/page.tsx` precisa de teste de componente. Faltam no entregável o `@testing-library/react` e o ambiente `jsdom` para `*.test.tsx`. O design conta com testes de componente (§8), mas nenhum item instala essas ferramentas. O projeto `integration` fica sem testes até E0.3/E0.4, então precisa de `passWithNoTests` até lá, ou o comando oficial falha. |
| E0.2 | ok | Os ajustes do `devops.md` bastam. O stub do worker deve exportar uma função testável, como `iniciarWorker()`, para não pesar na cobertura. |
| E0.3 | ok | — |
| E0.4 | ajustar | Os testes de integração de E0.4 (`reserva-exclusion`, `cliente-unicidade`) rodam antes de E0.5, mas o harness de banco de teste só nasce em E0.5. E0.4 precisa entregar um harness mínimo (`globalSetup`: cria a base de teste, `migrate deploy` e limpeza entre arquivos), que E0.5 evolui para template por worker. Declarar também que E0.4 congela o schema da v1: um item posterior que precise de migração vira trabalho serializado pelo líder (uma migração por onda). |
| E0.5 | ajustar | É o item mais ambíguo para começar. Faltam: (a) os tipos de contexto além do `TenantContext` (público por slug, sistema para worker/webhook/cadastro/login e admin); sem eles, cada item inventará um desvio; (b) o padrão de transação entre repositórios, necessário para E3.2 (cliente + reserva + itens), E3.5 e E8.1 (auditoria na mesma transação); (c) o núcleo de `defineAcao` testável sem `next/headers`, porque `cookies()` não existe fora de uma requisição Next no Vitest; (d) o contrato de erro (`AcessoNegado`/`NaoEncontrado`), já que server actions não devolvem 403/404 HTTP; (e) a convenção de nome dos arquivos de ação, para o teste "percorre o registro" (E6.4) carregar todos via `import.meta.glob`; registro em tempo de import só enxerga módulos já importados; (f) `exigirContexto()` para as leituras em Server Components, que `defineAcao` não cobre; (g) o lint: liberar `tests/**` e deixar explícito que SQL bruto (disponibilidade, rate limit) fica em `src/server/repos/**`. Repositórios em E0.5: apenas os 4 agregados de CA-1/CA-2, com `buscarPorId`/`atualizar`. Os demais itens os estendem. |
| E0.6 | ajustar | O MP simulado precisa de estado persistido (tabela), porque app, worker, Vitest e Playwright são processos distintos. Também precisa de uma rota de checkout simulado (`/dev/mp-checkout`, inativa com `MP_ADAPTER=real`). Sem ela, E6.1 não roda localmente nem no E2E. O WhatsApp simulado deve gravar as chamadas em tabela, para provar "uma única chamada ao adaptador" (E7.1 CA-4, E8.3 CA-2) entre processos. Ele também precisa de um meio de forçar falhas (contador por env ou tabela). O `registry.ts` deve importar `mercadopago/real.ts` e `whatsapp/real.ts` como stubs (`NaoImplementado`) criados aqui. Assim E6.6 e E7.2, que estão na mesma onda 5, não editam o mesmo arquivo. |
| E0.7 | ajustar | `src/worker/handlers/registry.ts` seria editado ao mesmo tempo por E6.3 e E7.1 (ambos na onda 5). E0.7 deve criar os handlers como stubs registrados (`assinatura-prazos.ts`, `whatsapp-reserva.ts`, `reconciliar-mensagens.ts`), e cada item preenche só o próprio arquivo. |
| E0.8 | ajustar | O CA-3 (painel em 375 px com menu) e o `e2e/a11y-base.spec.ts` precisam de uma página real, mas nenhuma tela de painel existe nessa onda. Incluir uma vitrine `src/app/dev/componentes/page.tsx` (404 em produção). A navegação do painel deve nascer completa (`src/config/navegacao.ts`, com todas as rotas da v1). Se não nascer, E2.1, E2.3 e E2.4 (onda 7) editam o mesmo `PanelLayout`. |
| E1.1 | ok | — |
| E1.2 | ajustar | O entregável `src/middleware.ts`: no Next 16, o arquivo passa a ser `proxy.ts`. Em qualquer versão, ele faz só uma verificação otimista (cookie presente → redireciona). A autorização real fica em `defineAcao`/`exigirContexto`, com consulta ao banco. Registrar isso no item para ninguém buscar a sessão no proxy. |
| E1.3 | ok | — |
| E1.4 | ok | Capacidade `configurar` (ver ajuste geral G-2). |
| E1.5 | ajustar | O CA-1 cita "o seed roda duas vezes", mas `prisma/seed.ts` pertence a E9.2, que depende de E1.5. E1.5 deve entregar `garantirSuperAdmin()` e um script npm (`superadmin:criar`). O CA-1 testa a função executada duas vezes, e E9.2 a chama no seed. |
| E2.1 | ajustar | Nome de serviço duplicado está "não decidido". Decidir (sugestão: permitido, sem constraint nem aviso). |
| E2.2 | ok | — |
| E2.3 | ajustar | Jornada que atravessa a meia-noite está "não decidida". Decidir: não suportada na v1 (`fim ≤ 24:00`, validado no servidor). |
| E2.4 | ajustar | O CA-3 já foi apontado pelo arquiteto. Nada a acrescentar. |
| E2.5 | ajustar | (1) A "resolução de slug público com 301" fica em `src/app/[slug]/**`, que pertence a E4.1, e E2.5 roda antes (onda 6 × 10). Mover a resolução para E4.1. E2.5 só grava `slug_historico`. (2) `permanentRedirect()` do Next responde **308**, não 301. Aceitar "redirecionamento permanente (301 ou 308)" ou exigir 301 no `proxy`. (3) Os limites do RN-1 estão "sugestão, não decidida": decidir. |
| E3.1 | ajustar | (1) O CA-3 depende do `ocupado_ate` da reserva existente (snapshot), e o fixture não o informa. Com intervalo 0, 09:30 só é oferecido se a reserva existente tiver `ocupado_ate = 10:30`. (2) O RN-3 exige que o intervalo caiba na jornada (`inicio + duração + intervalo` dentro dela). Com intervalo de 15 min, o último horário do dia some. Decidir se a jornada e os bloqueios usam `[inicio, fim)` e o intervalo só vale contra outras reservas (recomendado). (3) Deixar explícito que a regra de salão suspenso não é implementada aqui (é de E6.4). |
| E3.2 | ajustar | O CA-2 (10 requisições paralelas) com o mesmo telefone quebra o `upsert` do Prisma, que não é atômico: a disputa gera P2002 em vez de "horário indisponível". O upsert de cliente precisa usar `INSERT … ON CONFLICT` (entregável de E5.1), e o CA-2 deve fixar o mesmo telefone em todas as requisições. O entregável muda se o outbox (A-1) for aceito. |
| E3.3 | ok | — |
| E3.4 | ajustar | (1) O CA-5 diz "nenhuma mensagem é enfileirada", mas E7.1 e E7.3 registram a mensagem como `nao_enviada` (sem consentimento). Reescrever: "nenhum envio ocorre; o registro fica `nao_enviada`". (2) Usa `registrar.ts` de E4.3 (consentimento declarado `equipe`), mas não depende de E4.3 (ver A-3). |
| E3.5 | ajustar | O CA-5 (salão suspenso) não passa em E3.5: a política real só chega em E6.4, que depende de E3.5. Esse cenário já está nos CAs 2 e 3 de E6.4. Em E3.5, trocar por "cancelar e marcar status declaram `cancelar`; remarcar declara `agendar`". |
| E4.1 | ajustar | Passa a resolver o slug (atual ou `slug_historico`) com redirecionamento permanente (ver E2.5). Novo CA: "slug histórico → redirecionamento permanente para o atual". O RN-5 (salão não operável) fica só como referência: quem implementa é E6.4. |
| E4.2 | ajustar | (1) O limite por IP vale para quais requisições? O S7 fala em 10/min, mas a consulta de disponibilidade ao trocar de dia esgota esse limite. Decidir: envio de reserva (10/min) e disponibilidade com limite próprio, mais alto, ambos por env. (2) O widget simulado precisa de definição: um componente local que entrega o token fixo e oferece um meio de gerar token inválido, para o cenário "captcha inválido" de E4.4. |
| E4.3 | ok | — |
| E4.4 | ok | Depende da definição do widget simulado (E4.2). |
| E5.1 | ajustar | O entregável `upsert.ts` precisa ser atômico (`ON CONFLICT (salao_id, telefone_e164) DO UPDATE`), com CA de concorrência: 2 upserts paralelos do mesmo número geram 1 cliente. |
| E5.2 | ajustar | O entregável "Exibição 'cliente removida' nas visões de reserva" edita telas de E3.3, que roda depois (onda 7 × 8) e já tem esse RN-3. Retirar o entregável de E5.2, que fica com a exibição na lista e no detalhe de clientes. |
| E6.1 | ajustar | O CA-3 "a página pública passa a aceitar reservas" depende de E4.1 e E6.4, que vêm depois. Trocar por "o estado efetivo do salão permite `agendar`". |
| E6.2 | ok | Ajustes do §11 suficientes. |
| E6.3 | ajustar | O "período pago" (E6.2 CA-2 "estendido uma única vez"; E6.3 RN-5 "acesso até o fim do período pago") não tem regra de cálculo. Definir: pagamento aprovado → `pago_ate = max(pago_ate, data_pagamento) + 1 mês`, aplicado uma vez por `pagamento_id`, ou adotar o `next_payment_date` consultado. Declarar também a API de entrada (`aplicarEventoAssinatura`), usada por E6.1, E6.2 e E6.5. |
| E6.4 | ajustar | (1) Precisa de E4.1 (testa a reserva pública bloqueada e a página "agendamento indisponível" em `src/app/[slug]/**`), mas não depende dele. (2) A reserva pública não passa por `defineAcao` autenticado. Ela precisa do contexto público de E0.5, ou a política não a alcança. (3) Ver G-2 (mapa ação → capacidade). |
| E6.5 | ok | — |
| E6.6 | ok | — |
| E7.1 | ajustar | Ver A-1 (outbox). No desenho atual, o job de reconciliação "recria mensagens a partir do estado das reservas". Com isso, ele geraria confirmações e cancelamentos para todas as reservas do seed (E9.2) e para reservas antigas. Também não distingue "falhou ao enfileirar" de "intencionalmente sem mensagem". Definir ainda a semântica do consentimento: existe consentimento da cliente (qualquer origem) e ela não está anonimizada. |
| E7.2 | ok | — |
| E7.3 | ok | — |
| E8.1 | ajustar | (1) `src/app/admin/auditoria/**` precisa da guarda do painel admin (E1.5), mas E1.5 depende de E8.1: ciclo. Mover a tela para E8.3. (2) O CA-1 usa "editar nome do salão", ação de E8.2. Reescrever com uma mutação de teste qualquer via `registrarAuditoria`. |
| E8.2 | ajustar | (1) O CA-2 "a página pública mostra 'agendamento indisponível'" depende de E6.4, que não é dependência. Trocar por "o estado efetivo do salão não permite `agendar`". (2) O limite de 1–90 dias do RN-3 está "não decidido": decidir. |
| E8.3 | ajustar | Recebe a tela de auditoria (E8.1). A máscara de telefone do RN-2 está "não decidida": decidir (sugestão: `+55 11 *****-4321`). |
| E9.1 | ok | — |
| E9.2 | ok | Com A-1, o seed pode inserir reservas direto pelos repositórios sem disparar mensagens. Sem A-1, a reconciliação de E7.1 dispara confirmações para os dados de demonstração. |
| E9.3 | ok | Ver `devops.md` (E4.2 em `blocked_by`). |
| E9.4 | ok | — |

Épicos (E0–E9): ok, porque só agregam as filhas.

## 2. Ajustes pedidos ao analista

Gerais (valem para todo o spec):

| chave | mudança concreta |
|---|---|
| G-1 (topo do spec, "Convenções") | Acrescentar: "Em CAs de ações do servidor, '403' e '404' significam o erro tipado `AcessoNegado`/`NaoEncontrado` devolvido por `defineAcao`; em rotas HTTP e páginas, o status HTTP correspondente." Evita discutir status HTTP em server actions (E1.2, E1.5, E2.3, E2.4, E3.3, E3.4, E3.5, E5.1, E6.5, E7.3). |
| G-2 (itens com mutação) | Trocar "bloqueado com salão suspenso (S13)" por "capacidade declarada: X; o bloqueio é verificado em E6.4". Mapa: E1.4 `configurar`; E2.1–E2.5 `configurar`; E3.4 `agendar`; E3.5 remarcar `agendar`, cancelar e marcar status `cancelar`; E4.1 `agendar` (público); E5.1 editar `configurar`; E5.2 `lgpd`; E6.1 e E6.5 `assinatura`. |

Por item:

| chave | mudança concreta |
|---|---|
| E1.5 | CA-1: "Dado `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`, quando `garantirSuperAdmin()` (ou `npm run superadmin:criar`) roda duas vezes, então existe exatamente uma conta." |
| E2.1 | Decidir nome duplicado: permitido, sem aviso. |
| E2.3 | Decidir: jornada não atravessa a meia-noite (`fim ≤ 24:00`); o servidor recusa o contrário. |
| E2.5 | CA-1: "…então `slug_historico` registra `studio-bela` → salão e `bela-studio` passa a ser o slug atual" (a parte HTTP vai para E4.1). RN-1: decidir os limites. RN-4: "redirecionamento permanente (301 ou 308)". |
| E3.1 | CA-3: fixar "reserva existente 10:00–10:30 criada com intervalo 15 (`ocupado_ate` 10:45)" e, para o caso de intervalo 0, "criada com intervalo 0 (`ocupado_ate` 10:30)". RN-3: jornada e bloqueios verificados com `[inicio, fim)`; o intervalo vale só contra `[inicio, ocupado_ate)` de outras reservas (recomendado). Casos limite: salão não operável fora do escopo (E6.4). |
| E3.2 | CA-2: "…10 requisições simultâneas, **com o mesmo telefone**…". |
| E3.4 | CA-5: "…então nenhum envio ocorre e o registro de mensagem fica `nao_enviada`". |
| E3.5 | Remover o CA-5 (coberto pelos CAs 2 e 3 de E6.4). RN-5 conforme G-2. |
| E4.1 | Novo CA: "Dado um slug histórico, quando acessado, então redireciona permanentemente para o slug atual." Escopo: resolução de slug atual e histórico. |
| E4.2 | Decidir o escopo do limite por IP: envio de reserva e consulta de disponibilidade com limites próprios por env. Novo RN: "com `TURNSTILE_ADAPTER=simulado`, o widget é um componente local que entrega o token documentado e permite gerar um token inválido (usado em E4.4)". |
| E5.1 | RN novo: "upsert atômico por (`salao_id`, `telefone_e164`)". CA novo: "2 upserts paralelos do mesmo número → 1 cliente, sem erro". |
| E5.2 | Escopo: a exibição de "cliente removida" na agenda é de E3.3 (RN-3). E5.2 cobre a lista e o detalhe de clientes. |
| E6.1 | CA-3: "…então a assinatura fica `em_teste` com fim = autorização + 30 dias e o estado efetivo do salão permite `agendar`". |
| E6.3 | RN novo: regra de `pago_ate` (ver tabela). RN novo: ponto de entrada único `aplicarEventoAssinatura` para E6.1, E6.2 e E6.5. |
| E7.1 | Se A-1 for aceito: "o registro da mensagem é gravado na mesma transação da reserva (outbox); o envio à fila ocorre após o commit; a reconciliação reenfileira mensagens `pendente` sem job ativo há mais de N minutos". Consentimento: "existe consentimento da cliente (qualquer origem) e a cliente não está anonimizada". |
| E8.1 | CA-1: "Dado uma mutação de super admin executada com `registrarAuditoria`…". Escopo: retirar a "tela de consulta" (vai para E8.3). |
| E8.2 | CA-2: "…então o estado efetivo do salão não permite `agendar` e há registro de auditoria; quando reativa, volta a permitir e há novo registro". RN-3: decidir o limite de N. |
| E8.3 | Escopo: incluir a consulta da auditoria com filtros (vinda de E8.1). RN-2: decidir a máscara. |

## 3. Ajustes pedidos ao arquiteto

| chave | mudança no JSON |
|---|---|
| A-1 E7.1 (outbox) | Trocar o entregável de `enfileirar.ts` para: "registro `mensagem` (estado `pendente`, chave única, `ON CONFLICT DO NOTHING`) gravado na transação da reserva/remarcação/cancelamento, com a substituição de pendentes obsoletas na mesma transação; `boss.send` com `singletonKey` após o commit". Trocar `reconciliar-mensagens.ts` para: "reenfileira `pendente` sem job ativo há > N min". Motivo: inserir numa tabela própria não é "enfileirar dentro da transação" (a alternativa descartada no §1): a falha da fila continua sem desfazer a reserva, a reconciliação deixa de derivar eventos do estado das reservas (o que geraria mensagens para o seed e reservas antigas) e a substituição fica atômica. Nenhuma mudança de dependência. |
| A-1 E3.2 | No entregável `criar-reserva.ts`, trocar "enfileiramento pós-commit" por "registro da mensagem na transação (E7.1) e envio à fila pós-commit". |
| E0.1 | Acrescentar o entregável: "`@testing-library/react` + `jsdom` para `*.test.tsx`; projeto `integration` com `passWithNoTests` até existir teste de banco". |
| E0.4 | Acrescentar os entregáveis "`tests/support/db.ts` mínimo (globalSetup: base de teste + `migrate deploy` + limpeza)" e "schema da v1 congelado; migrações posteriores serializadas pelo líder". |
| E0.5 | Acrescentar aos entregáveis: "contextos `TenantContext`, `PublicoContext` (slug), `SistemaContext` e `AdminContext`"; "`src/server/repos/transacao.ts` (unidade de trabalho compartilhada entre repositórios)"; "núcleo de `defineAcao` testável sem `next/headers` e `exigirContexto()` para Server Components"; "erros `AcessoNegado`/`NaoEncontrado`"; "convenção de arquivos de ação (`*.acao.ts`) carregados por `import.meta.glob` no teste de registro"; "lint libera `tests/**`". Limitar `src/server/repos/**` aos agregados do CA-1. `tests/support/db.ts` passa a "evolui o harness de E0.4 para template por worker". |
| E0.6 | Acrescentar: "MP simulado com estado em tabela própria (migração do item) e rota `/dev/mp-checkout` inativa no modo real"; "WhatsApp simulado registra as chamadas em tabela e permite falha forçada"; "`mercadopago/real.ts` e `whatsapp/real.ts` criados como stubs `NaoImplementado` já ligados ao `registry.ts`". |
| E0.7 | Acrescentar: "handlers `assinatura-prazos.ts`, `whatsapp-reserva.ts` e `reconciliar-mensagens.ts` criados como stubs registrados" (E6.3 e E7.1 só os preenchem). |
| E0.8 | Acrescentar: "`src/app/dev/componentes/page.tsx` (vitrine para E2E, 404 em produção)" e "`src/config/navegacao.ts` com todas as rotas da v1". |
| E1.2 | Trocar `"src/middleware.ts e integração de defineAcao com a sessão"` por `"src/proxy.ts (Next 16; ou middleware.ts conforme a versão fixada em E0.1) só com verificação otimista; autorização em defineAcao/exigirContexto"`. |
| E1.5 | Trocar o primeiro entregável por: "`src/server/auth/superadmin.ts` (`garantirSuperAdmin()` idempotente) e script npm `superadmin:criar`; chamado pelo seed em E9.2". |
| E2.5 | Remover `"Resolução de slug público com 301 para o atual"`. `slug-redirect.test.ts` passa a "`slug-historico.test.ts`". |
| E3.4 | `blocked_by`: acrescentar `"E4.3"` (consentimento declarado). E4.3 está na onda 5, sem efeito no caminho crítico, e P0 → P0. |
| E4.1 | Acrescentar o entregável: "resolução de slug atual/histórico com redirecionamento permanente (usa `slug_historico`)". Não adicionar E2.5 a `blocked_by` (evita P0 → P1, pois a tabela vem de E0.4). |
| E5.2 | Remover `"Exibição 'cliente removida' nas visões de reserva"` (já é RN-3 de E3.3, que roda depois). |
| E6.4 | `blocked_by`: acrescentar `"E4.1"`. E4.1 está na onda 10 e E3.5 na 11, então o caminho crítico não muda. |
| E8.1 | Remover `"src/app/admin/auditoria/** (consulta com filtros)"` (ciclo com a guarda de E1.5). |
| E8.3 | Acrescentar `"src/app/admin/auditoria/** (consulta com filtros)"`. O tamanho continua M. |

Verificação: nenhuma das mudanças de `blocked_by` acima cria um ciclo, altera o caminho crítico de 14 ondas ou faz um P0 depender de um P1.
