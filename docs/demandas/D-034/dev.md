# D-034 (E1.5) Super admin + TOTP — dev

## 1. Tarefas e arquivos
- **T-3 (núcleo puro):** `src/server/auth/admin/{totp,cifra,validade-admin,cookie-admin,qr}.ts` + testes unit. `qr.ts` é o único importador de `qrcode-generator` (lint já feito na T-2).
- **T-4:** `src/server/repos/admin.ts` (pré-contexto; único acesso às colunas TOTP; `emTransacaoAdmin` entrega operações ligadas à transação + `Repos`), `src/server/auth/admin/garantir-super-admin.ts`, `src/scripts/superadmin-criar.ts` (completa o stub), `ACOES_AUDITAVEIS` ganhou `login.sucesso` e `totp.cadastrar`.
- **T-5:** `sessao-admin.ts`, `login-admin.ts` (`entrarAdmin`, `verificarTotpAdmin`, `cadastrarTotp`, `obterCadastroTotp`, `etapaDaPreSessao`, `validarCredenciaisAdmin`), `pagina.ts` (`exigirAcessoAoAdmin`, `lerTokenAdminDoCookie`) e ajuste de `src/server/tenant/sessao.ts` (`sessaoDaCredencial(c, agora, modo)`: super admin nunca usa a renovação 7/30 d; só `resolverAdmin` com TOTP renova, 30 min/teto 8 h; `resolverTenant` e pré-sessão não renovam; `validade.ts` intacto).
- **T-6:** `src/app/admin/{page.tsx,acoes.ts}`, `src/app/admin/entrar/{page.tsx,acoes.ts,estado.ts,FormularioAdmin.tsx,PassoCadastro.tsx,*.module.css}`, `src/proxy.ts` (matcher `/admin`, `/admin/:path*`; só presença de `ab_admin`/`ab_sessao`; `/admin/entrar` livre), `next.config.ts` (`Cache-Control: no-store` + `X-Robots-Tag: noindex` em `/admin/:path*`), `ROTAS.devAdminEntrar`, `AdminLayout` (prop opcional `semNavegacao`, para `/admin` não apontar para telas inexistentes).
- **T-7:** `src/app/dev/admin-entrar/{page.tsx,acoes.ts}` (+ testes), `e2e/admin-entrar.spec.ts`, `e2e/admin-entrar-sem-js.spec.ts`.
- **T-8:** README (seção "Super admin e TOTP"); cobertura. **CLAUDE.md não editado** (o líder atualiza).

## 2. Testes e CAs
- Unit: `totp.test.ts` (vetores RFC 6238, ±1, formato — CA-6), `cifra.test.ts` (CA-5), `validade-admin.test.ts` (CA-9 puro, cookie), `qr.test.ts` (CA-2), `proxy.test.ts` (CA-4), `Layouts.test.tsx`, `navegacao.test.ts`, `src/app/dev/admin-entrar/*.test.ts(x)`.
- Integração (`tests/integration/auth/admin/`): `garantir.test.ts` (CA-1, serviço + script em processo filho, 10 paralelas, gestor existente), `login.test.ts` (CA-2, 3, 5, 8, 9 pré-sessão/rotação/logout, 10 com trigger que falha o INSERT, respostas uniformes, rate limit de senha), `sessao.test.ts` (CA-9 30 min/8 h sem 7/30 d, CA-14, CA-4/RN-10 guarda), `concorrencia.test.ts` (CA-7 replay 2×/10×/mesma pré-sessão; cadastro 2×; segredo pendente único), `paginas.test.ts` (ações e páginas reais: CA-2, CA-4, CA-12, cookie Strict/Path/Max-Age).
- E2E sem banco (375×812, locale en-US, teclado, axe 4.14.0, sem JS): CA-13 e CA-2/CA-4 parciais.

## 3. Gates (todos passando)
- `npm run lint` (0 avisos), `npm run typecheck`, `npm run build`: OK.
- `npm run test:coverage`: 449 arquivos, 5166 testes, 0 falhas; linhas 99,23% (limiar 90). (Uma 1ª execução teve 1 timeout de 5 s em `salao/perfil.test.ts` por carga e 2 testes de vocabulário/cabeçalhos que precisavam acompanhar a D-034: corrigidos; reexecução limpa.)
- `npm run test:e2e` com `DATABASE_URL` removida: 182 passed; specs do admin também passam com o `.env` fora do lugar.
- Concorrência 10x (`auth/admin/concorrencia` + `garantir`): 10/10 verdes. `TZ=UTC` e `TZ=America/Sao_Paulo`: unit (auth, auditoria, tenant, proxy) e integração (auth, auditoria, tenant) verdes. D-010 (login) e D-033 (auditoria) verdes.

## 4. Desvios e decisões
- **403 em `/admin`:** gestor/profissional recebem a tela "Acesso negado" (HTTP 200), como o painel (D-010 D-9 opção b); Next não define status em Server Component. "Ação admin → 403" fica para as ações da E8.2, que usarão `exigirAcessoAoAdmin`.
- **Limite de TOTP:** as tentativas depois da 5ª (`limite`) não são auditadas (evita inundar `auditoria` sob força bruta); falha de auditoria de uma FALHA nunca muda a resposta (registra `admin.auditoria_falha` no log).
- **Replay também pré-conferido** (`passo <= totp_ultimo_passo` antes da transação) além do UPDATE condicional atômico (que é a garantia).
- **Fábrica `criarSuperAdmin`** não mudou (segredo `'segredo-cifrado-ficticio'`); sem CHECK `^v1:` (parecer do DBA). A validação do formato é de `decifrarSegredo`.
- `AdminLayout.semNavegacao` é mudança aditiva em componente compartilhado (default inalterado).
- Chave AES nos serviços é injetável (`deps.chave`); em produção vem de `chaveDoAmbiente()` (única leitura de `ADMIN_TOTP_CHAVE`).

## 5. Riscos/pendências
- Testes existentes ajustados por consequência da D-034: `registrar.test.ts` (entidade de `totp.*` = `usuario`), `recuperacao-senha-paginas.test.ts` (nova regra de cabeçalhos `/admin/:path*`), `proxy.test.ts`.
- Chave perdida/trocada invalida os TOTP (README). Decifragem falha → 500 (erro de configuração, por desenho).
- Sessões admin não têm coluna de tipo: a distinção depende de `papel=super_admin`; `garantirSuperAdmin` nunca altera papel (R-3).
- `Cache-Control: no-store` em `/admin/:path*` conferido no E2E (`/admin/entrar` e o 307 do proxy).
