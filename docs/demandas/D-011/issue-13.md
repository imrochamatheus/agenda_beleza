# Issue #13 — Cadastrar gestor e salão com confirmação de e-mail e slug gerado

## Objetivo
Permitir que um novo gestor crie sua conta e seu salão e confirme o e-mail.

## Origem e contexto
PLAN.md, "Perfis e acesso" (gestor cria o salão; confirma o e-mail; slug gerado do nome). Atual: inexistente.

## Escopo
Formulário de cadastro (nome do gestor, e-mail, senha, nome do salão), criação de usuário gestor + salão (conta provisória, S9), geração do slug, envio e consumo do link de confirmação, reenvio do link.

## Fora do escopo
Fluxo de assinatura (E6.1); edição do slug (E2.5).

## Especificação
Decidido:
- RN-1: e-mail único entre usuários da plataforma; um gestor por salão.
- RN-2: slug derivado do nome: minúsculas, sem acentos, espaços → hífen, apenas `[a-z0-9-]`; em colisão, sufixo numérico (`-2`, `-3`…).
- RN-3: salão nasce com fuso `America/Sao_Paulo`, grade 15 min, antecedência 2 h, janela 60 dias, intervalo 0 min.
- RN-4: senha armazenada com hash forte (ex.: argon2/bcrypt); mínimo 8 caracteres (S15).
- RN-5: gestor sem e-mail confirmado não entra (S17); link de confirmação expira em 24 h e é de uso único.
- RN-6: validação no servidor de todos os campos; mensagens em pt-BR.
Casos limite: nome do salão só com caracteres especiais (gera slug de fallback não vazio); e-mail com maiúsculas (normalizar para minúsculas); duplo envio do formulário (não cria dois salões).

## Critérios de aceite
- [ ] CA-1: Dado dados válidos, quando o formulário é enviado, então são criados um usuário gestor não confirmado e um salão com slug derivado do nome e configurações padrão, e o e-mail simulado contém um link de confirmação.
- [ ] CA-2: Dado um salão "Studio Bela" existente, quando outro salão "Studio Bela" é cadastrado, então seu slug é `studio-bela-2`.
- [ ] CA-3: Dado um e-mail já cadastrado, quando se envia o formulário, então o cadastro é recusado com mensagem e nenhum salão é criado.
- [ ] CA-4: Dado um link de confirmação válido, quando é aberto, então o usuário fica confirmado; quando reaberto, então é recusado como já utilizado.
- [ ] CA-5: Dado um link com mais de 24 h, quando é aberto, então é recusado e a tela oferece reenvio.
- [ ] CA-6: Dado um gestor não confirmado, quando tenta entrar com senha correta, então o acesso é negado com opção de reenviar o link.

## Validação
Unitários (slug, validações); integração com PostgreSQL real (criação, unicidade, tokens); E2E opcional do cadastro. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #11 (E1)
- Bloqueada por: #12 (E1.2), #8 (E0.6)
- Bloqueia: #46 (E6.1)
- Relacionadas: #46 (E6.1)

## Entregáveis
- src/app/(publico)/cadastro/** e src/app/(publico)/confirmar-email/**
- src/server/auth/cadastro.ts e src/server/auth/confirmacao-email.ts (token com hash, 24 h, uso único, reenvio)
- src/lib/slug.ts com testes unitários (acentos, colisão -2/-3, fallback)
- tests/integration/auth/cadastro.test.ts (CA-1..CA-6)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E1.1`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E1.1 -->
