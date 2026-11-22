# D-039 (E1.4) — Testes (Rodada 1, tester)

Ambiente: branch feat/d-039-convite-profissional (não commitado), Node 24, PostgreSQL local do compose, TZ do processo variado.

## Gates (reexecutados)
- `npm run lint` e `npm run typecheck`: limpos. `npm run build`: ok.
- `npm run test:coverage`: 498 arquivos, 5908 testes passando; linhas 99,15% (limiar 90%).
- `TZ=UTC` e `TZ=America/Sao_Paulo` em `auth/convite.test.ts`, `convites`, `tests/integration/{convites,politica,db}`, `convite-esquema`, `template`: 24 arquivos / 685 testes verdes nos dois.
- `convites/concorrencia.test.ts` x10: 10/10 (8 testes cada). Regressão `tests/integration/auth` + `profissionais` (D-010..D-013): 31 arquivos / 314 testes verdes.
- E2E (config temporária na porta 3100, removida; 3000 e o next-server do usuário intocados): convite, convite-sem-js, recuperar-senha, entrar, cadastro, cadastro-sem-js: 31/31. `docker/smoke.sh` não rodado (instrução do líder).

## CAs (código e testes lidos; verificados pela suíte acima)
CA-1..CA-16: passam (envio, aceite, concorrência aceite×aceite/reenvio×aceite/desativação×aceite/edição×aceite, rate limit 3/15 min, falha do e-mail, headers strict-origin/no-store/noindex, GET sem escrita, estados no painel).

## Segurança (revisão de código)
Token 32 bytes, só SHA-256 no banco; aceite sem sessão; ordem de travas profissional → convite → usuário, `ON CONFLICT (email) DO NOTHING` sem capturar 23505; mensagem de recusa uniforme; `salao_id` derivado do convite; edição de e-mail invalida pendentes na mesma transação, sob a trava do profissional (`servico.ts#editar`); migração do índice parcial sem drift; contratos (drift/template/varredura) só acrescidos, sem enfraquecer; bug da APP_URL inválida corrigido (`enviarConvite` com try).

## Defeitos
Nenhum crítico/alto/médio. Observação baixa (sem defeito): `estadoDosConvites` mostra convite invalidado como "sem convite" (coerente com o spec).

## Veredito: APROVADO
