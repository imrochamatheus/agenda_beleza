# D-032 (E4.5) Avaliações verificadas — spec

Fonte: `docs/trinks-alinhamento.md` DT-4, DT-7, DT-8, §7.4, §8.1 e linha E4.5 da matriz (prevalece sobre o `PLAN.md`). Evidências lidas: `alterar-status.ts:50-57` (E3.5 já registra `convite_avaliacao` ao concluir e substitui o pendente ao ir a `nao_compareceu`; a volta cai na chave única), `whatsapp-reserva.ts` (sem `gerarLink`; convite hoje termina `falhou/link_indisponivel`), `mensagens/envio.ts:21,111`, `D-024/design.md §3.9` (HMAC recomendado), `clientes/anonimizar.ts:13-17` (gancho `AoAnonimizar` vazio, dentro da transação), `protecao/limite.ts` (`limitarPorIp(ip,'avaliacao',agora)`; `ESCOPOS_IP` já tem `avaliacao` e `denuncia`), `protecao/turnstile.ts` (`verificarHumano`), `src/app/(publico)/[slug]/page.tsx` (grep: nenhuma seção de avaliações hoje). Tabela `avaliacao`: inexistente.

## 1. Problema
Há convite por WhatsApp sem link e sem destino; a página pública não mostra nota nem avaliações; o gancho de anonimização não trata avaliações.

## 2. Objetivo
A cliente, com link individual do convite, avalia uma reserva concluída (nota 1–5, comentário opcional, aceite de publicação); a avaliação é publicada na hora na `/{slug}` com média e contagem, e some se a reserva deixar de ser `concluido` ou a cliente for anonimizada.

## 3. Escopo
Entra: migração `avaliacao` (+ `avaliacao_convite`); `GeradorLinkAvaliacao` real injetado em `whatsapp-reserva.ts`; rota pública `/{slug}/avaliar/[token]` (GET verifica, POST/ação envia; funciona sem JS); leitura pública (`lerAvaliacoesPublicas`: média, contagem, lista paginada ou últimas N); seção na E4.1; filtro por status/anonimização; gancho E5.2; testes, README, `.env.example`, `check-env`.
Fora (E8.4): denúncia (`avaliacao_denuncia`, botão "Denunciar", escopo `denuncia`), retirada/restauração pelo super admin, auditoria, fila de moderação. Coluna `retirada_em`/`retirada_por` entra agora (nullable, sem fluxo) porque a visibilidade a considera; sem UI. Fora também: resposta do salão, edição/apagamento pela cliente ou pelo gestor, e-mail/lembrete, fotos em avaliação, ordenação/filtros, avaliação sem link. Nada disso consta em "Fora da primeira versão" de modo conflitante.

## 4. Regras de negócio
- RN-1 (DT-7) Uma avaliação por reserva (`UNIQUE (reserva_id)`), só de reserva `concluido`, só por link individual; telefone nunca autentica; não existe rota por reserva+telefone.
- RN-2 Token: `HMAC-SHA256(AVALIACAO_SEGREDO, "convite-avaliacao:" + salaoId + ":" + reservaId)`, base64url, determinístico (reenvio/retentativa geram o mesmo link; design D-024 §3.9). Só `SHA-256(token)` é gravado (`avaliacao_convite.token_hash`, `reserva_id` único, `expira_em` = criação + 30 dias, `usado_em`, `invalidado_em`). Token em claro só em memória até a chamada ao adaptador (RN-14 da D-024: nunca em `parametros`, log, erro, payload).
- RN-3 Link: `APP_URL/{slug}/avaliar/<token>` (slug atual do salão, lido pelo gerador). Validade 30 dias contados da primeira geração (a linha do convite não é renovada por reenvio). Se o slug mudar, o slug antigo (histórico) também resolve o mesmo salão pela rota do E4.1 (308 ou resolução por histórico; ver D-1).
- RN-4 Resposta uniforme "Link inválido ou expirado." (mesmo texto, status e corpo, sem timing distinguível além do uniforme) para: token malformado, desconhecido, de outro salão, vencido, já usado, invalidado, reserva não `concluido`, cliente anonimizada. Nada é gravado.
- RN-5 Validade em tempo de uso: reserva `concluido` e cliente com `anonimizada_em IS NULL`, `usado_em IS NULL`, `invalidado_em IS NULL`, `agora < expira_em`. Linha de `avaliacao_convite` é criada pelo gerador (`INSERT … ON CONFLICT (reserva_id) DO NOTHING`) antes do envio; o gerador só funciona para reserva `concluido` do salão do contexto, senão lança erro permanente (`link_indisponivel`).
- RN-6 Reserva `nao_compareceu`: link recusado (RN-5) e avaliação existente fica oculta; a volta a `concluido` reexibe a avaliação e reabre o link ainda não usado e dentro do prazo; não reenvia convite (já garantido pela chave única da D-030). O convite NÃO é invalidado por escrita em `avaliacao_convite` na troca de status: a verificação é sempre em tempo de uso (sem novo acoplamento em `alterar-status.ts`).
- RN-7 Envio: nota inteira 1–5 (obrigatória), comentário opcional 0–1000 caracteres (trim, colapso de espaços, texto puro, sem HTML renderizado; React escapa), aceite de publicação obrigatório (`true`/`on` estrito, como D-023): sem aceite não grava nada e o formulário volta com erro de campo (o link continua válido). `publicacao_aceita_em` e `versao_termos` (de `src/config/termos.ts`) gravados; texto do aceite entra em `termos.ts` com nova versão e novo hash em `HASHES_POR_VERSAO` (regra do guard test) e a Política (`#avaliacoes`) já o cobre.
- RN-8 `nome_exibicao` = "Primeiro nome + inicial do último sobrenome com ponto" (ex.: "Maria S."; nome único → só o nome), calculado no envio a partir de `cliente.nome` (puro, em `src/lib/texto.ts` ou módulo da avaliação) e gravado; nunca expõe telefone, id, reserva, serviço, profissional ou data exata (mês/ano apenas, no fuso do salão, via `format.ts`).
- RN-9 Publicação imediata (DT-8); visibilidade derivada: `retirada_em IS NULL` ∧ reserva `concluido` ∧ `cliente.anonimizada_em IS NULL`. Média = média das visíveis (1 casa decimal, `formatarInteiro`/formatter em `format.ts`), contagem = visíveis; sem avaliações → "Ainda sem avaliações", sem nota. Um único predicado SQL compartilhado por média, contagem e lista (como `ondeServicoOfertavel`).
- RN-10 Anonimização (E5.2): o gancho `aoAnonimizar`, dentro da transação (ordem de travas: salão → cliente → … → avaliacao por último), apaga `nome_exibicao` e `comentario` das avaliações da cliente (a avaliação some da página e dos agregados pelo filtro) e marca `avaliacao_convite.invalidado_em`. O filtro `anonimizada_em IS NULL` é a proteção primária; a limpeza é defesa em profundidade e LGPD.
- RN-11 Salão suspenso/pendente: leitura pública e envio continuam (nenhuma checagem de assinatura). Salão inexistente → 404 do E4.1.
- RN-12 Proteção: rate limit por IP `limitarPorIp(ip,'avaliacao',agora)` no GET? Só no POST de envio (e no GET da verificação, com o mesmo escopo, para não virar oráculo de tokens; excedido → 429 com a mensagem genérica do E4.2). Turnstile (`verificarHumano`) no POST de envio como no E4.2; em adaptador simulado passa. Sem limite por telefone.
- RN-13 Isolamento: toda leitura/escrita escopada ao `salaoId` resolvido pelo slug; o hash do token é procurado com `salao_id` e o HMAC inclui o `salaoId`; token de S2 em `/s1/avaliar/…` = RN-4.
- RN-14 Gerador injetado em `criarWhatsappReserva` por `gerarLink` (uma linha em `whatsapp-reserva.ts`); sem `AVALIACAO_SEGREDO` em produção o `check-env` falha (como `RATE_LIMIT_SEGREDO`); em dev/teste há padrão derivado explícito apenas fora de produção (fica D-2).
- RN-15 Comparação do hash com `timingSafeEqual` / igualdade por índice sobre hash (nunca sobre o token); log só com ids/códigos, nunca token, comentário ou nome.

## 5. Critérios de aceitação
- CA-1 Dado reserva `concluido` com consentimento `convite_avaliacao`, quando o worker envia o convite, então o parâmetro `link` do adaptador simulado é `…/{slug}/avaliar/<token>`, existe uma linha em `avaliacao_convite` com apenas o hash, e `mensagem.parametros`, tentativas e logs não contêm o token (§7.4 "Convite enviado").
- CA-2 Dado reenvio/retentativa do mesmo convite, então o link é idêntico e há uma só linha de convite.
- CA-3 Dado link válido, quando a cliente envia nota 4, comentário e aceite, então há 1 `avaliacao` (nome "Primeiro nome + inicial", `versao_termos` vigente), o convite fica `usado_em` e a `/{slug}` mostra a avaliação, média e contagem atualizadas (§7.4 "Link válido").
- CA-4 Dado link já usado, vencido (agora ≥ expira_em, relógio injetado), com token alterado, malformado ou inexistente, quando aberto ou enviado, então a resposta é idêntica ("Link inválido ou expirado.") e nada é gravado (§7.4).
- CA-5 Dado token de S2 aberto em `/s1/avaliar/…`, então inválido; e não existe rota que receba reserva+telefone (teste estático das rotas + 404).
- CA-6 Dado nota fora de 1–5/não inteira, comentário > 1000, ou sem aceite, então erro de campo em pt-BR, nada gravado e o link segue válido.
- CA-7 Dado reserva corrigida para `nao_compareceu`, então o link é recusado e a avaliação some da página e dos agregados; ao voltar a `concluido`, reaparece (link não usado volta a valer) e nenhum convite novo é criado (§7.4).
- CA-8 Dado anonimização da cliente, então a avaliação some da página e dos agregados, `nome_exibicao`/`comentario` ficam nulos e o link é recusado (§7.4); a anonimização desfaz-se por inteiro se o gancho falhar (transação).
- CA-9 Dado salão suspenso, então a seção de avaliações aparece e o envio por link válido é aceito (§7.4).
- CA-10 Dado duas submissões simultâneas (≥ 10, com e sem barreira) do mesmo link, então exatamente 1 `avaliacao`, 1 resposta de sucesso, as demais RN-4, sem 5xx/`23505` visível/impasse; dado submissão × anonimização/mudança para `nao_compareceu`, sem impasse e estado final coerente.
- CA-11 Dado 2 salões, avaliações de um nunca aparecem, nem entram nos agregados, do outro.
- CA-12 Dado excesso do limite `avaliacao` por IP, então 429 genérico sem consultar o token; escopo `reserva` não é afetado.
- CA-13 Dado falha do Turnstile (adaptador simulado em falha), então recusa sem gravar nem consumir o link.
- CA-14 Dado comentário com HTML/`<script>`, então é exibido como texto escapado.
- CA-15 Dado salão sem avaliações, então "Ainda sem avaliações" e sem nota; dado várias, média com 1 casa e contagem corretas (arredondamento definido e testado).
- CA-16 UI em 375×812, por teclado, axe 4.14.0 sem violações, formulário funciona sem JS (E2E sem banco via `/dev/avaliacao` na vitrine, como as demais) e `Referrer-Policy: strict-origin` na rota com token (token no caminho: também `Cache-Control: no-store` e `noindex`).
- CA-17 Migração aplica do zero e sobre a anterior; `drift.test.ts` lista tabelas, CHECKs (`nota BETWEEN 1 AND 5`, `char_length(comentario) <= 1000`) e índices; cobertura ≥ 90%; fuso do processo irrelevante (`TZ=UTC` e `America/Sao_Paulo`).

## 6. Casos limite
Mês/ano da avaliação no fuso do salão; reserva concluída em uma data e link aberto no 30º dia exato (fronteira `<`); convite enviado com `resultado_incerto` e depois reenviado (mesmo link); cliente que muda de nome após avaliar (nome gravado no envio); cliente sem sobrenome; nome com acento/emoji (inicial por code point); profissional/serviço desativados não afetam a avaliação; encaixe concluído vale igual; dois convites de reservas diferentes da mesma cliente → duas avaliações; slug trocado depois do envio do convite; telefone não brasileiro não se aplica (nenhuma entrada de telefone); gestor/profissional não têm ação nesta demanda (sem `*.acao.ts` de equipe); salão com 10k avaliações: lista limitada (paginação ou top N por `criado_em DESC, id`).

## 7. Dependências
D-024 (pipeline, `gerarLink`), D-030 (status), D-031 (gancho), D-026/E4.1 (página, rotas, slug histórico), D-027 (`limitarPorIp`, `verificarHumano`, IP), D-023 (termos/consentimento), adaptadores WhatsApp/Turnstile simulados. E7.2 mapeia `link` no template (fora). Alimenta E8.4, E9.2 (seed com avaliações), E4.4 (E2E).

## 8. Impactos
- Migração aditiva (DBA obrigatório): `avaliacao` (`id`, `salao_id`, `reserva_id UNIQUE`, `cliente_id` para o filtro de anonimização, `nota`, `comentario`, `nome_exibicao`, `publicacao_aceita_em`, `versao_termos`, `retirada_em`, `retirada_por`, `criado_em`; FKs compostas por salão como o restante do esquema; índice `(salao_id, criado_em DESC, id)`), `avaliacao_convite` (`salao_id`, `reserva_id UNIQUE`, `token_hash UNIQUE`, `expira_em`, `usado_em`, `invalidado_em`, `criado_em`), CHECKs, drift/template. Trava: ... → reserva → cliente → `avaliacao_convite`/`avaliacao` (últimas, atualizar cabeçalho de `repos/servico.ts`). Tabela `avaliacao_denuncia` NÃO entra (E8.4).
- Env: `AVALIACAO_SEGREDO` (≥ 32 chars, obrigatório em produção, `env.ts`, `check-env`, `.env.example`, README, docker-compose; DevOps leve). Sem nova dependência.
- Rotas/ações: `src/app/(publico)/[slug]/avaliar/[token]/`, shell `acoes.ts`; `SEGMENTOS_RESERVADOS` inalterado (sub-rota de slug); `ROTAS.avaliar`. Atualizar `termos.ts` (novo texto/versão) e `E4.1` (seção). CLAUDE.md e README.
- Worker: `whatsapp-reserva.ts` passa `gerarLink` (`D-024` previu a posse da E4.5).

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição):
- D-1 Slug antigo em `/{slugAntigo}/avaliar/<token>`: assumo que a resolução por histórico do E4.1 (308) cobre; se não cobrir, a rota responde RN-4.
- D-2 Fora de produção `AVALIACAO_SEGREDO` ausente usa um valor de dev fixo explícito (padrão do `RATE_LIMIT_SEGREDO`); em produção é obrigatório.
- D-3 Lista na página: últimas 10 mais recentes + média/contagem totais (sem paginação na v1).
- D-4 Nota sem comentário é publicável; comentário não passa por filtro de palavras (moderação reativa na E8.4).
- D-5 Não há texto de aceite alternativo para "não publicar": sem aceite, não se grava avaliação (DT-8 publica ao enviar).
