# Issue #14 — Recuperar senha por e-mail transacional

## Objetivo
Permitir que gestor e profissional redefinam a senha com um link enviado por e-mail.

## Origem e contexto
PLAN.md, "Perfis e acesso" e CA 8 do PLAN. Atual: inexistente.

## Escopo
Solicitação por e-mail, token de uso único, tela de nova senha, invalidação das demais sessões.

## Fora do escopo
Recuperação de senha do super admin (gerido por seed/env, E1.5).

## Especificação
Decidido:
- RN-1: a resposta à solicitação é a mesma para e-mail existente ou não.
- RN-2: token aleatório, armazenado como hash, expira em 1 h, uso único; nova solicitação invalida tokens anteriores (S15).
- RN-3: ao redefinir, todas as sessões do usuário são encerradas.

## Critérios de aceite
- [ ] CA-1: Dado um e-mail cadastrado, quando solicita recuperação, então o e-mail simulado recebe um link com token.
- [ ] CA-2: Dado um e-mail não cadastrado, quando solicita recuperação, então a tela mostra a mesma mensagem e nenhum e-mail é enviado.
- [ ] CA-3: Dado um link válido, quando define nova senha, então consegue entrar com a nova senha e não com a antiga, e sessões anteriores são invalidadas.
- [ ] CA-4: Dado um link usado, expirado ou substituído por solicitação posterior, quando é aberto, então é recusado.

## Validação
Integração com PostgreSQL real e e-mail simulado; unitários de expiração. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #11 (E1)
- Bloqueada por: #12 (E1.2), #8 (E0.6)
- Bloqueia: #56 (E9.4)

## Entregáveis
- src/app/(publico)/recuperar-senha/** e src/app/(publico)/redefinir-senha/**
- src/server/auth/recuperacao-senha.ts (token com hash, 1 h, uso único, invalida anteriores, encerra sessões)
- tests/integration/auth/recuperacao-senha.test.ts (CA-1..CA-4)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E1.3`. Prioridade P1, tamanho S (Project #3)._
<!-- agenda-beleza-backlog:E1.3 -->
