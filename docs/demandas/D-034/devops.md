# D-034 (E8.5) — DevOps (T-2)

- **Variáveis:** `ADMIN_TOTP_CHAVE` (32 bytes, base64 ou 64 hex; opcional no schema, obrigatória com `NODE_ENV=production`, o `check-env` a nomeia sem citar o valor; `chaveTotpValida` em `src/server/env.ts`). `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` (senha 12 a 1024) só são validadas se presentes e não são exigidas pelo `check-env`. Nenhuma entra no `Env`.
- **Arquivos:** `src/server/env.ts` (+ teste), `.env.example` (vazias), `docker-compose.yml` (chave de desenvolvimento só no app; o worker não usa), README (tabela de variáveis, perda da chave, reset manual de TOTP), `package.json` (`superadmin:criar`, entrada esbuild `src/scripts/superadmin-criar.ts`, hoje um stub), `eslint.config.mjs` (`qrcode-generator` só em `src/server/auth/admin/qr.ts`).
- **Dependência nova:** `qrcode-generator` 2.0.4 exata (MIT, sem dependências, gera o QR local sem rede); `npm audit` mantém as mesmas 3 vulnerabilidades altas de antes (nenhuma dela é desta lib).
- **Evidência:** lint, typecheck e testes unitários de env/check-env passam; `docker compose config` válido.
- **Pendências:** CI não precisa de chave (testes de produção injetam a sua); cadastrar `ADMIN_TOTP_CHAVE` real no provedor de produção. Rotacionar/perder a chave invalida os TOTP (README).
