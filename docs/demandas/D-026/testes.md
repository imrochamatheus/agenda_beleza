# D-026 (E4.1) — Testes

## Rodada 1 — VEREDITO: APROVADO
Ambiente: branch feat/d-026-pagina-publica (não commitada), Node 24, postgres via compose, Chromium 375x812.

Gates (reexecutados):
- `npm run lint`: ok. `npm run typecheck`: ok. `npm run build`: ok (`/[slug]` ƒ; `/termos` e `/privacidade` ○).
- `npm run test:coverage`: 360 arquivos, 4381 testes passaram; linhas 99,46% (gate 90%).
- `npm run test:e2e`: 118 passaram (inclui reserva-publica e reserva-publica-sem-js).

CAs: CA-1..CA-14 atendidos, conforme os testes mapeados em dev.md §3 (integração com PostgreSQL real, `http.test.ts` com 308 real, concorrência, E2E).

Revisões:
- Desvio nº1 (eslint.config.mjs): regra `no-html-link-for-pages` desligada só em `TESTES`; produção continua sob a regra. Aceito.
- Segurança: sem `dangerouslySetInnerHTML` na rota; repositório público com projeção mínima (sem usuario_id, cliente ou reserva); ação usa `modo: 'normal'` fixo; reservados/malformados retornam 404; isolamento coberto por testes.
- Sem Referrer-Policy na rota: aceito (design §1; a política padrão do navegador não quebra o POST sem JS).

Defeitos: nenhum.
