# D-034 (E1.5) Super admin + TOTP — testes

## Rodada 1 — veredito: APROVADO (com 2 ressalvas, sem defeito crítico ou alto)

Ambiente: branch feat/d-034-superadmin-totp (alterações não commitadas), Node 24, PostgreSQL do compose, Chromium 375x812.

### Gates (reexecutados pelo tester)
- `npm run lint`: 0 avisos. `npm run typecheck`: limpo.
- `npm run test:coverage`: 449 arquivos, 5166 testes, 0 falhas; linhas 99,23% (limiar 90). auth/admin 97,35%, repos/admin.ts 100%. Nenhuma exclusão nova de cobertura.
- `npm run test:e2e` com DATABASE_URL e TEST_DATABASE_URL removidas: 182 passed (build incluso). Specs do admin (11) também passam com o `.env` movido para fora.
- Não reexecutado: `sh docker/smoke.sh` (CA-11 parte compose; compose/`.env.example`/README revisados estaticamente; CI sem alteração, os testes injetam a chave).

### CAs
CA-1..CA-14: atendidos, cada um com teste próprio em `tests/integration/auth/admin/` (garantir, login, sessao, concorrencia, paginas, esquema), unit (`totp`, `cifra`, `validade-admin`, `qr`, proxy, env) e E2E `e2e/admin-entrar*.spec.ts`. Exceção parcial: CA-4 (ver DEF-1).

Revisão de segurança (leitura do código + testes): TOTP RFC 6238 com vetores e ±1 (compara os 3 passos em tempo constante); anti-replay por UPDATE condicional atômico (2 e 10 paralelos, cada um com sua pré-sessão: 1 sucesso); AES-256-GCM com IV aleatório e AAD = id do usuário, erros de decifragem genéricos; cookie `ab_admin` httpOnly, Strict, Path /admin, Secure em produção, 10 min na pré-sessão; pré-sessão não resolve como admin; sessão admin 30 min/teto 8 h sem a renovação 7/30 d; `resolverTenant` recusa admin e `resolverAdmin` recusa salão; `garantirSuperAdmin` com `ON CONFLICT DO NOTHING`, nunca altera conta existente, 10 paralelas = 1 conta, script sem senha na saída; nenhuma rota pública cria admin; resposta uniforme (hash fictício); limite de TOTP vem antes da verificação; `login.sucesso` na transação (falha desfaz a sessão), falhas em conexão própria; QR local em SVG, `qrcode-generator` só em `qr.ts` (lint); `no-store` e `noindex` em `/admin/:path*`. D-010 (`login.ts`, `validade.ts`) e D-033 (auditoria; só vocabulário estendido) sem alteração de lógica.

### Defeitos / desvios
- DEF-1 — CA-4 pede 403 e a página `/admin` responde "Acesso negado" com HTTP 200 para gestor/profissional. Severidade: **média**, estado aberto/aceitável. Mesmo padrão do painel (D-010 D-9), sem exposição de dados (sem cookie `ab_admin` nada é lido); a RN-10 da spec já descreve "403 Acesso negado" nesse formato. O 403 HTTP real das ações admin deve ser exigido nos CAs da E8.2 (recomendo registrar). Não bloqueia.
- DEF-2 — Tentativas de TOTP após o limite (6ª em diante) não são auditadas (só log). Severidade: **baixa**. Evita inundar `auditoria` sob força bruta; as 5 primeiras falhas e o log `admin.totp` cobrem o rastro. Aceitável; sugiro um único registro de "limite atingido" por janela na E8.3.

Classe de falha recorrente: nenhuma.
