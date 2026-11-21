# D-035 (E8.4) — Testes (Rodada 1)

Ambiente: branch feat/d-035-denuncias-moderacao (alterações não commitadas), Node 24, postgres do compose.

## Gates (reexecutados pelo tester)
- `npm run lint`, `npm run typecheck`: sem avisos.
- `npm run test:coverage`: exit 0, linhas 99,24% (7805/7864), funções 99,36%.
- `npm run test:e2e` (inclui build): 196 passaram com `.env`; 196 passaram sem `.env`/`DATABASE_URL`. Porta 3000 livre ao final.
- Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em unitários de denuncias/tenant/admin/dev/format: 414 testes ok nos dois.
- Estabilidade: `denuncias/concorrencia` + `denunciar` 5x (12 testes) sem falha.

## CAs (testes em tests/integration/denuncias, unitários e e2e/denuncia*, e2e/moderacao*)
CA-1..CA-14: passaram (denunciar, moderacao, acoes, paginas, fila, concorrencia, estatico, drift; E2E com e sem JS).

## Segurança (revisão de código + testes)
- `ip_hash` = HMAC-SHA256 com segredo (`hashIpDenuncia`), não SHA puro; dedupe por índice único parcial com ON CONFLICT DO NOTHING; teto 20.
- Ordem validar -> limite (escopo `denuncia`) -> Turnstile (falha fechada) -> insert; resposta uniforme para avaliação inexistente/retirada/outro salão/malformada.
- `defineAcaoAdmin`: 401 sem sessão, 403 para sessão de salão ou admin sem TOTP; auditoria na mesma transação, por último (rollback testado); ação `avaliacao.denuncia_resolver`.
- Sem `dangerouslySetInnerHTML` na área nova (único uso pré-existente em admin/entrar, D-034, QR do TOTP). Sem rota/ação de salão para editar/apagar avaliação.
- Migração aditiva, sem drift; testes de contrato só acrescidos (drift/template); D-032 só ganhou `id` no DTO (ajustes de teste justificados); D-033/D-034 sem alteração de arquivos além do vocabulário de auditoria (acréscimo).

## Desvios do dev.md
- registro.ts tipo admin: aceito. Ajustes nos testes da D-032: aceitos (apenas acréscimo de `id`).
- Corrida benigna (denúncia pendente em avaliação recém-retirada): classificada BAIXA/aceitável; sem vazamento, sem duplicidade, a fila a mostra como não publicada.
- Um widget Turnstile por avaliação listada (até 10): aceito (baixa; só modo real).

## Defeitos
Nenhum aberto (crítico/alto/médio/baixo: 0). Observação baixa: motivo digitado se perde no PRG de erro (já aceito pelo dev).

## Veredito: APROVADO
