# D-027 (E4.2, issue #38) — Proteção da página pública

## 1. Problema
Não há limite algum na página pública. Evidência: `reservarPelaPagina` (src/server/reserva-publica/servico.ts) chama `criarReserva` sem `antesDaReserva`; a página `src/app/(publico)/[slug]/page.tsx` consulta disponibilidade por GET (`searchParams`) sem limite; nenhum Turnstile é chamado no fluxo público; `/api` e o worker não limpam `rate_limit_janela` (grep em src/worker: nada).
Já existe: `repos/rate-limit.ts` (`incrementarJanela(chave, janelaInicio)` upsert atômico `ON CONFLICT … RETURNING contador`; `decrementarJanela`), usados por login/recuperação/confirmação; porta Turnstile (D-007, `TURNSTILE_ADAPTER`, token simulado `XXXX.DUMMY.TOKEN.XXXX`); ponto `antesDaReserva(ctx, r, {clienteId, inicio})` em criar-reserva.ts:194 (após o upsert da cliente, dentro da transação).

## 2. Objetivo
Reduzir abuso e mensagens a terceiros na página pública (CA 10 do PLAN) e deixar a API de limite por IP reutilizável pelo envio de avaliação (E4.5) e denúncia (E8.4) (CA-R1, revisão D-019).

## 3. Escopo
Entra: `src/server/protecao/` (limite por janela, extração de IP, chave HMAC, verificação Turnstile, limite de futuras); limites por IP em reserva e em consulta de disponibilidade; limite por número; máx. 3 futuras por número/salão; widget Turnstile na etapa de dados (real e simulado); limpeza periódica no worker; env/.env.example/README.
API reutilizável (sem consumidor nesta demanda): `limitarPorIp(ip, escopo, agora)` com escopos `reserva`, `disponibilidade`, `avaliacao`, `denuncia` (limites próprios por env), documentada em JSDoc e README; E4.5/E8.4 só a chamam. Não cria rota, tabela nem UI de avaliação/denúncia (fora de escopo; E4.5/E8.4).
Fora (PLAN "Fora da primeira versão"): CAPTCHA próprio, lista de bloqueio permanente, rate limit de login (já existe, D-010), painel da equipe.

## 4. Regras de negócio
- RN-1: janelas em `rate_limit_janela` via `incrementarJanela` (reutilizar, sem nova tabela). Chave: `pub:<escopo>:ip:<sha256(ip)>` ou `pub:reserva:tel:<HMAC-SHA256(E.164)>`; nunca dado pessoal em claro. Janela fixa; limites e tamanho da janela por env com padrões documentados.
- RN-2: futuras = `reserva.status='confirmado'` e `inicio > agora`, mesmo salão e telefone; contagem em `antesDaReserva`, depois do upsert que trava a cliente (a contagem e o INSERT são serializados pela trava do profissional e pelo FOR UPDATE da cliente; arquiteto confirma que cobre CA-7). `>= 3` → `recusado` com mensagem pt-BR que não revela reservas existentes.
- RN-3: Turnstile validado no servidor pela porta (com IP) ANTES de criar reserva/cliente; inválido, ausente ou erro da porta → recusa sem escrita (falha fechada).
- RN-4: excedido → HTTP 429 + pt-BR, sem revelar dados de reservas. Onde a resposta é uma página GET, ver §9 suposição S-1.
- RN-5: `TRUSTED_PROXY_HOPS` (padrão 0 ignora `X-Forwarded-For`, usa o IP do socket/`x-real-ip` não confiável também ignorado; N>0 = N-ésima entrada da direita). Valor inválido falha em `check-env`. IP ausente/ilegível → balde único `desconhecido` (não ignora o limite).
- RN-6: com `TURNSTILE_ADAPTER=simulado`, widget local entrega o token documentado e há controle para gerar token inválido (usado em E4.4). Com real, widget oficial com `TURNSTILE_SITE_KEY`.
- RN-7: ordem na reserva: IP → Turnstile → validação/resolução → número (HMAC) → transação (futuras). Um refugo antes da transação não consome a cota do número além do necessário; contador do número é devolvido (`decrementarJanela`) só se a reserva não for criada por erro nosso? Suposição S-2: não devolver (simples, conservador).
- RN-8: limpeza: job cron no worker apaga `rate_limit_janela` com `janela_inicio` mais antiga que a maior janela + folga (usa índice `janelaInicio`), em lotes; idempotente.
- RN-9: o limite de consulta de disponibilidade tem limites próprios e vale também para a página com query GET.

## 5. Critérios de aceitação
CA-1..CA-9 da issue #38 valem como escritos (CA-1 e CA-2 com o salão B e cancelada; CA-3 IP reserva N+1; CA-4 número de IPs distintos; CA-5 token inválido simulado sem reserva nem cliente; CA-6 proxy 0 e 1; CA-7 paralelo exatamente 1 aceita; CA-8 consulta M+1; CA-9 nenhuma linha com E.164 em claro). Acrescentados:
- CA-10: Dado Turnstile simulado, quando o token documentado é enviado, então a reserva segue; token ausente → recusa sem escrita (CA-5).
- CA-11 (CA-R1): Dado `limitarPorIp(ip,'avaliacao'|'denuncia',agora)` com limite K, quando chamado K+1 vezes, então a última é negada; escopos não compartilham contador; teste unitário/integração da API sem E4.5/E8.4.
- CA-12: Dado limpeza executada, então linhas com janela expirada somem e janelas vigentes ficam; reexecutar não altera nada.
- CA-13: Dado JS desabilitado, quando o formulário de dados é enviado, então Turnstile (simulado) e mensagens de limite funcionam (E2E sem banco para o widget simulado).
- CA-14: Dado a consulta limitada na página (GET com query), então nenhum cálculo de disponibilidade é feito e aparece aviso pt-BR; sem JS idem.
- CA-15: Dado `TRUSTED_PROXY_HOPS` inválido, `check-env` falha nomeando a variável.
- CA-16: Dado reserva negada por limite (IP/número/futuras), nenhuma reserva, cliente, consentimento ou mensagem é criado (futuras: o upsert da cliente é desfeito junto com a transação).
- CA-17: a regra de salão suspenso/indisponível (D-026) segue antes do consumo de cota quando possível.

## 6. Casos limite
Virada de janela (limite reinicia na janela seguinte, fixa; aceitável burst 2×); concorrência 5 paralelas (CA-7) e incrementos paralelos sem perda; isolamento entre salões (contagem por salão; limite por número global ou por salão? S-3: por número+salão na chave HMAC? Decisão: chave do número inclui salaoId); telefone não brasileiro/inválido → erro de validação antes do contador de número (não grava chave em claro); cliente anonimizada (telefone nulo) não conta; reservas `cancelado/concluido/nao_compareceu` ou passadas não contam; salão suspenso recusado antes; `X-Forwarded-For` forjado com hops 0; IPv6 (normaliza ::ffff:v4 e usa o IP completo); reserva `repetida` (mesma chave de requisição) não deve ser recusada por limite de futuras nem consumir cota extra (idempotência do D-025 precede: verificar chave antes de contar).

## 7. Dependências
D-025 (`criarReserva`, `antesDaReserva`), D-026 (`reservarPelaPagina`, página), D-007 (Turnstile), D-010 (`rate_limit_janela`), D-008 (worker/cron). Bloqueia E4.4 (#44), E9.3 (#55); consumido por E4.5/E8.4.

## 8. Impactos
- Env/.env.example/README/check-env: limites por IP (reserva, disponibilidade, avaliação, denúncia), por número, janela(s), `TRUSTED_PROXY_HOPS`, `RATE_LIMIT_SEGREDO` (chave do HMAC; obrigatório em produção, padrão de dev só fora de produção). Reaproveita `TURNSTILE_*`.
- Dados: sem migração prevista (reaproveita `rate_limit_janela`; consulta de futuras usa índices existentes de `reserva`; DBA confirma plano). DBA opina sobre a limpeza e o índice.
- Worker: novo cron (UTC) em `src/worker/handlers/`; README e tabela de comandos. CI sem mudança.
- Front: widget na etapa de dados (client component), texto sem função vindo de server page.

## 9. Dúvidas
Bloqueantes: nenhuma.
Suposições:
- S-1: página GET não consegue fixar status 429 no App Router sem route handler. Adotado: serviço devolve `limitado`; a página mostra aviso pt-BR sem calcular; a Server Action/endpoint de reserva responde 429 quando houver controle HTTP. Se o arquiteto achar necessário 429 real na página, usar `proxy.ts`/handler (decisão de design). CA-8 verificado no serviço e, se possível, por HTTP.
- S-2: contador do número não é devolvido após recusas posteriores.
- S-3: chave por número inclui `salaoId` (isolamento entre salões).
- S-4: padrões (de S7 do PLAN, conferir): arquiteto confirma valores no PLAN.md.
