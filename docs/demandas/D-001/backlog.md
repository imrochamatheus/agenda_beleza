# D-001 — Backlog rascunho (líder)

Demanda: publicar o planejamento do PLAN.md como issues no GitHub (repo imrochamatheus/agenda_beleza, Project #3). Nenhuma implementação nesta demanda. Repositório sem código de aplicação; nada concluído.

Épicos são issues pai; os itens abaixo de cada um são sub-issues. A notação "← X" significa "bloqueada por X".

- **E0 Fundação técnica**
  - E0.1 Scaffolding Next.js+TS, ESLint, typecheck, Vitest com coverage-v8 (threshold de linhas em 90) e Playwright (devops)
  - E0.2 docker-compose (app, worker, postgres), Dockerfile e `.env.example` (devops) ← E0.1
  - E0.3 CI no GitHub Actions: lint, typecheck, build, testes com Postgres de serviço, gate de cobertura e E2E (devops) ← E0.1, E0.2
  - E0.4 Esquema Prisma base, migração SQL com `btree_gist` e exclusion constraint `tstzrange` só para status ativos (dba) ← E0.1
  - E0.5 Escopo de tenant no servidor e infraestrutura de testes de integração com PostgreSQL real (arquiteto/dev) ← E0.4
  - E0.6 Portas e adaptadores (e-mail, WhatsApp, Mercado Pago, Turnstile), com real e simulado escolhidos por variável de ambiente (dev) ← E0.1
  - E0.7 Worker separado com pg-boss: bootstrap, fila e backoff (dev) ← E0.2, E0.4
  - E0.8 Base de UI: tokens de cor terrosos e nude, tipografia serifada e sem serifa, layout responsivo e acessível por teclado, pt-BR e BRL (dev)
- **E1 Autenticação e perfis**: E1.1 cadastro do gestor e do salão, confirmação de e-mail e slug; E1.2 login, sessão httpOnly e RBAC; E1.3 recuperação de senha; E1.4 convite e aceite de profissional; E1.5 super admin por seed/env com TOTP
- **E2 Configuração do salão**: E2.1 serviços (preço, duração, desativação) e vínculo com profissionais; E2.2 profissionais, incluindo o gestor que atende, com desativação; E2.3 jornadas semanais com pausas; E2.4 bloqueios de profissional e de salão; E2.5 configurações (fuso, regras de horário, slug editável com redirect)
- **E3 Agenda**: E3.1 motor de disponibilidade (multi-serviço em sequência, grade, antecedência, janela, intervalo, fuso, bloqueios, ocupação); E3.2 criação de reserva com snapshot dos itens e tratamento de conflito vindo da constraint, com teste de concorrência; E3.3 agenda da equipe (reserva manual, remarcar, cancelar, status, encaixe com aviso) com permissões gestor × profissional
- **E4 Página pública**: E4.1 fluxo serviços → profissional → horário → dados e consentimento → confirmação, mobile; E4.2 proteções (rate limit por IP e por número, até 3 reservas futuras, Turnstile); E4.3 Termos, Privacidade e consentimento versionado; E4.4 E2E Playwright em viewport de celular
- **E5 Clientes/LGPD**: E5.1 cadastro por salão com normalização E.164, atualização do nome pelo mesmo número, busca e edição; E5.2 anonimização ("cliente removida")
- **E6 Assinatura**: E6.1 início do teste com autorização confirmada no MP e conta provisória; E6.2 webhooks (validação de origem, persistência, idempotência, consulta ao provedor); E6.3 máquina de estados (teste, ativo, carência de 3 dias, suspenso, regularizado, cancelado) e jobs; E6.4 modo suspenso (somente leitura, exceção de cancelamento, página pública indisponível); E6.5 tela de assinatura do gestor
- **E7 WhatsApp**: E7.1 enfileirar depois do commit com idempotência por reserva + evento, log de tentativas e backoff, sem afetar a reserva; E7.2 adaptador real da Cloud API com os 3 templates
- **E8 Super admin**: E8.1 log de auditoria; E8.2 painel (salões, edição, suspender e reativar, estender teste, assinatura e eventos, fila e reenvio)
- **E9 Entrega da v1**: E9.1 landing page; E9.2 seed com dois salões e um super admin; E9.3 README (execução, testes, credenciais reais) e registro do risco de custo da Meta; E9.4 validação final dos 11 critérios de aceite e do gate de cobertura (tester)

Cada issue segue o padrão exigido: Objetivo, Origem e contexto (citando a seção do PLAN), Escopo, Fora do escopo, Especificação, Critérios de aceite, Validação (unitários e cobertura ≥ 90%, aprovação do tester), Dependências, Entregáveis e Papel responsável. Sem assignee, porque nenhuma conta foi mapeada a papéis. Labels: só as existentes (`enhancement`, `documentation`, `accessibility`); nenhum label novo será criado. Prioridade, estimativa e iteração só serão preenchidas se o Project tiver esses campos. Nesse caso, a prioridade segue o caminho crítico de dependências (fundação > núcleo da agenda > o resto). Sem datas e sem milestone.

