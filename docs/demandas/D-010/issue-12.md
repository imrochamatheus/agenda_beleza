# Issue #12 — Implementar login, sessão em cookie httpOnly e permissões por perfil

## Objetivo
Autenticar a equipe com e-mail e senha e aplicar permissões por perfil em todas as rotas e ações do servidor.

## Origem e contexto
PLAN.md, "Perfis e acesso" (sessões seguras com cookie httpOnly e permissões por perfil); CLAUDE.md, "Roles". Atual: inexistente.

## Escopo
Login, logout, sessão persistida no servidor, cookie httpOnly/Secure/SameSite, middleware de autorização por papel (gestor, profissional, super admin), redirecionamento pós-login por perfil.

## Especificação
Decidido:
- RN-1: cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; sessão revogável no servidor.
- RN-2: mensagem de erro de login não revela se o e-mail existe.
- RN-3: matriz de permissões: gestor administra todo o salão; profissional só a própria agenda, os próprios bloqueios e as próprias reservas; super admin só o painel da plataforma (exige TOTP, E1.5).
- RN-4: profissional desativado não entra e suas sessões são revogadas (S16).
- RN-5: toda ação do servidor verifica papel e escopo via `defineAcao` (E0.5), não apenas a UI.

## Critérios de aceite
- [ ] CA-1: Dado credenciais válidas de gestor, quando faz login, então recebe cookie httpOnly e é redirecionado para `/painel`.
- [ ] CA-2: Dado senha errada ou e-mail inexistente, quando tenta entrar, então recebe a mesma mensagem genérica.
- [ ] CA-3: Dado um profissional autenticado, quando chama diretamente uma ação registrada com `papeis: ['gestor']` (ação de teste do registro de E0.5), então recebe 403 e nada é alterado.
- [ ] CA-4: Dado um usuário que fez logout, quando reutiliza o cookie antigo, então é tratado como não autenticado.
- [ ] CA-5: Dado um profissional com `ativo = false` (fábrica), quando tenta entrar, então o acesso é negado.

## Validação
Unitários (matriz de permissões); integração com PostgreSQL real (sessões, 403 por papel — exigido pelo CA 11 do PLAN). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #11 (E1)
- Bloqueada por: #7 (E0.5), #10 (E0.8)
- Bloqueia: #13 (E1.1), #14 (E1.3), #24 (E1.5), #16 (E2.2), #26 (E2.5), #29 (E5.1)

## Entregáveis
- src/server/auth/{sessao.ts,senha.ts,permissoes.ts} (sessão em tabela, cookie httpOnly/SameSite=Lax/Secure, argon2id)
- src/proxy.ts (Next 16; ou middleware.ts conforme a versão fixada em E0.1) só com verificação otimista; autorização em defineAcao/exigirContexto
- src/app/(publico)/entrar/** e logout; redirecionamento por papel
- tests/unit/auth/permissoes.test.ts (matriz) e tests/integration/auth/sessao-rbac.test.ts (CA-1..CA-5, 403 por papel)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Arquiteto de software, Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E1.2`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E1.2 -->
