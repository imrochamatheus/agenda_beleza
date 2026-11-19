## Objetivo
Isolar integrações externas da lógica de negócio, permitindo rodar e testar tudo localmente.

## Origem e contexto
PLAN.md, "Direção técnica" (adaptadores reais e simulados por env); CLAUDE.md, invariante "Integrations sit behind adapters". Atual: inexistente.

## Escopo
- Portas: e-mail; WhatsApp; Mercado Pago (`criarAssinatura`, `consultarAssinatura`, `consultarPagamento`, `cancelarAssinatura`, `adiarProximaCobranca`, `validarWebhook`); Turnstile.
- Adaptadores simulados dos quatro.
- Seleção por env: `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER`, `TURNSTILE_ADAPTER` (`simulado|real`, padrão `simulado`).
- Adaptadores reais de e-mail transacional via SMTP (`nodemailer`) e de Turnstile (`siteverify`).
- `src/config/plano.ts`: fonte única do preço (7900 centavos) e dos dias de teste (30).
- Passo `check-env` de validação na inicialização.

## Fora do escopo
Adaptador real do Mercado Pago (E6.6) e do WhatsApp (E7.2).

## Especificação
Decidido:
- RN-1: a lógica de negócio depende só das portas; importar SDK/HTTP de provedor fora dos adaptadores é proibido.
- RN-2: o e-mail simulado grava destinatário, assunto e corpo em `email_log`, consultável por testes e pela pessoa desenvolvedora (links de confirmação, convite e recuperação).
- RN-3: Turnstile simulado aceita um token fixo documentado e rejeita os demais; o real valida no `siteverify` da Cloudflare. A chave pública é lida no servidor em runtime (`TURNSTILE_SITE_KEY`) e passada ao widget por props, sem variável `NEXT_PUBLIC_*`.
- RN-4: MP simulado permite disparar eventos (autorização, cobrança aprovada, falha, cancelamento) e registra adiamentos; WhatsApp simulado permite forçar falha.
- RN-5: a validação do env roda na inicialização (`check-env` no entrypoint do app e no início do worker), nunca no import nem no `next build`; modo real sem credencial obrigatória faz o processo sair com código diferente de 0 nomeando a variável.
- RN-6: a URL base de cada adaptador real é injetável pelo construtor (testes usam servidor HTTP local de stub).
- RN-7: nenhum adaptador registra token ou senha em log.
- RN-8: variáveis no `.env.example`: os 4 seletores; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`; `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. Credenciais reais vazias.

## Critérios de aceite
- [ ] CA-1: Dado o `.env` padrão, quando o app inicia, então os quatro adaptadores ativos são os simulados.
- [ ] CA-2: Dado `EMAIL_ADAPTER=real` sem `SMTP_HOST`, quando o container `app` (ou o `worker`) inicia, então sai com código diferente de 0 e o log contém `SMTP_HOST`.
- [ ] CA-3: Dado o adaptador de e-mail simulado, quando o sistema envia um e-mail, então o teste lê em `email_log` destinatário, assunto e link do corpo.
- [ ] CA-4: Dado o Turnstile simulado, quando se valida o token documentado, então retorna válido; com outro token, retorna inválido.
- [ ] CA-5: Dado o adaptador real do Turnstile apontado para um servidor HTTP local de stub, quando o `siteverify` retorna `success:false`, então a porta retorna inválido.
- [ ] CA-6: Dado um ambiente sem `.env`, quando se executa o build, então ele termina com código 0 (a validação não roda no build).
- [ ] CA-7: Dado `src/config/plano.ts`, quando lido pelo teste, então expõe preço 7900 centavos e 30 dias de teste.

## Validação
Testes unitários de cada adaptador e da seleção por env; para os reais, servidor HTTP local de stub (não é mock de banco). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #6 (E0.4)
- Bloqueia: #13 (E1.1), #14 (E1.3), #21 (E1.4), #49 (E6.6), #31 (E7.1), #50 (E7.2), #54 (E9.1)
- Relacionadas: #49 (E6.6), #50 (E7.2)

## Entregáveis
- src/server/integrations/{email,whatsapp,mercadopago,turnstile}/port.ts
- Adaptadores simulados dos quatro (e-mail grava em email_log; MP com disparo de eventos e adiamento; WhatsApp com falha forçável; Turnstile com token fixo documentado)
- Adaptadores reais: e-mail SMTP (nodemailer) e Turnstile (siteverify via fetch)
- src/server/integrations/registry.ts (seleção por EMAIL_ADAPTER, WHATSAPP_ADAPTER, MP_ADAPTER, TURNSTILE_ADAPTER; falha na inicialização nomeando a variável ausente)
- src/config/plano.ts (7900 centavos/mês, 30 dias de teste)
- .env.example atualizado; testes com servidor HTTP local de stub
- MP simulado com estado em tabela própria (migração do item) e rota /dev/mp-checkout inativa no modo real
- WhatsApp simulado registra as chamadas em tabela e permite falha forçada
- src/server/integrations/mercadopago/real.ts e whatsapp/real.ts criados como stubs NaoImplementado ligados ao registry.ts (E6.6 e E7.2 os substituem)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: DevOps

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.6`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E0.6 -->
