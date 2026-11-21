# D-035 — E8.4 Denúncias e moderação de avaliações (spec)

Fontes: `docs/trinks-alinhamento.md` §7.5, §8.1 (`avaliacao_denuncia`: `salao_id`, `avaliacao_id`, `motivo` enum, `texto`, `ip_hash`, `criado_em`, `resolvida_em`); `prisma/schema.prisma` (`Avaliacao.retiradaEm/retiradaPor`, sem FK; "a moderação decide"); `src/server/protecao/tipos.ts:3` (escopo `denuncia` já existe); `src/server/auditoria/tipos.ts:5-6` (`avaliacao.retirar`/`restaurar` já existem); `src/server/avaliacoes/leitura.ts` (`lerAvaliacoesPublicas`); `src/app/admin/` (só `entrar` e `page.tsx`; fila inexistente).

## 1. Problema
Hoje não há denúncia nem moderação: não existe `avaliacao_denuncia`, rota de denúncia nem `/admin/avaliacoes`. `retirada_em`/`retirada_por` existem, mas nada os grava.

## 2. Objetivo
Visitante denuncia avaliação publicada; super admin (TOTP) retira/restaura avaliações com auditoria; gestor/profissional nunca alteram avaliações.

## 3. Escopo
Entra: migração aditiva `avaliacao_denuncia`; formulário público (sem JS) na seção de avaliações de `/{slug}`; `/admin/avaliacoes`; ações retirar, restaurar, resolver/arquivar denúncia; auditoria; docs/README/.env.example se houver env.
Fora: E8.2 (gestão de salões: suspender, editar) e E8.3 (consulta/listagem da auditoria); notificar cliente, gestor ou denunciante; edição de nota/comentário; apagar avaliação; revogação de denúncias; denúncia de outros tipos de conteúdo; moderação automática; contas de denunciante. Não conflita com "Fora da primeira versão" do PLAN.md.

## 4. Regras de negócio
- RN-1 Só se denuncia avaliação visível (publicada: `retirada_em IS NULL`, reserva `concluido`, cliente não anonimizada, mesmo critério da leitura pública), do salão do `/{slug}`; qualquer outro caso recebe a MESMA resposta uniforme, sem gravar (não revela existência).
- RN-2 Motivo de lista fechada (enum `motivo_denuncia_avaliacao`; proposta: `ofensivo`, `falso`, `spam`, `dados_pessoais`, `outro`) + texto opcional (≤ 500, trim, sem HTML interpretado). Texto é só do admin, nunca público.
- RN-3 Denunciante não é identificado: guarda-se apenas `ip_hash` (HMAC/SHA-256 com segredo, nunca IP em claro; mesma função de `protecao`). Sem nome/e-mail/telefone.
- RN-4 Proteção: Turnstile (porta, `integracoes().turnstile`) + `limitarPorIp(ip,'denuncia',agora)`; excedido → resposta de limite genérica, nada gravado. Escopo não compartilha contador com os demais.
- RN-5 Dedupe: no máximo 1 denúncia PENDENTE por (`avaliacao_id`, `ip_hash`) (índice único parcial `WHERE resolvida_em IS NULL`; `ON CONFLICT DO NOTHING`, nunca capturar 23505). Teto de denúncias pendentes por avaliação (proposta 20; acima disso aceita-se com resposta uniforme sem gravar nova linha).
- RN-6 Resposta uniforme "Recebemos sua denúncia" em sucesso, duplicada, teto e avaliação inexistente/retirada; só falha de validação/Turnstile/limite difere. A avaliação continua visível; denunciar nunca a oculta.
- RN-7 Fila `/admin/avaliacoes` (somente super admin com sessão admin válida + TOTP, `exigirAcessoAoAdmin`): lista avaliações com denúncias pendentes (contagem, motivos, textos) e avaliações em geral; filtros por salão e estado (`visível`/`retirada`/`com denúncia pendente`); paginação; ordem determinística. Exibe nome de exibição e comentário (já públicos); nunca telefone/e-mail da cliente.
- RN-8 Retirar: define `retirada_em = agora`, `retirada_por = id do admin`; exige motivo de moderação (obrigatório, 3–300, sem PII: aviso na UI; validação rejeita e-mail/telefone óbvios); restaurar: zera as duas colunas. Ambas idempotentes por estado (retirar já retirada / restaurar visível → resultado `recusado/estado_atual`, sem auditoria nem escrita).
- RN-9 Auditoria `avaliacao.retirar`/`avaliacao.restaurar` na MESMA transação (`registrarAuditoria` com `r`), com valores antes/depois (`retirada_em`, `retirada_por`) e o motivo; falha na auditoria desfaz a ação. Auditoria não contém comentário nem nome da cliente.
- RN-10 Ao retirar, denúncias pendentes dessa avaliação são resolvidas (`resolvida_em`, `resolvida_por`, `resolucao='retirada'`) na mesma transação; restaurar não reabre denúncias. Também é possível "arquivar" (resolver sem retirar, `resolucao='mantida'`) cada denúncia ou todas de uma avaliação. Arquivar também é auditado (ação nova de vocabulário `avaliacao.denuncia_resolver`, entidade `avaliacao_denuncia`; confirmar com D-033 se o enum aceita, senão ampliar via migração).
- RN-11 Autorização: ações de moderação por `defineAcao` de admin (`exigirAdmin`), 401 sem sessão, 403 para gestor/profissional/qualquer sessão de salão, verificado no servidor, mesmo com POST direto. Página para gestor/profissional: "Acesso negado"; sem sessão: redireciona a `/admin/entrar`. Gestor não tem rota para editar/apagar avaliação (nem existe `*.acao.ts` de avaliação para salão).
- RN-12 Retirada afeta somente a leitura pública (`lerAvaliacoesPublicas` já filtra `retirada_em IS NULL`; agregados/média também devem excluir retiradas; confirmar). Reserva e cliente não mudam. Anonimização da cliente e correção de status continuam valendo (retirada ≠ visibilidade final).
- RN-13 Trava: ordem canônica salao → … → avaliacao; moderação trava a linha da avaliação `FOR UPDATE` (nunca o salão); denúncia só insere (FK `FOR KEY SHARE`). Não notifica ninguém.
- RN-14 Salão suspenso: denúncia pública e moderação continuam funcionando.

## 5. Critérios de aceitação
- CA-1 Dado avaliação visível, quando POST válido de denúncia com Turnstile OK, então 1 linha em `avaliacao_denuncia` (motivo, texto, `ip_hash` não igual ao IP) e a avaliação segue em `/{slug}`.
- CA-2 Dado o formulário sem JS, quando enviado, então mesma resposta uniforme (teste E2E sem JS, 375×812, teclado, axe zero violações).
- CA-3 Dado Turnstile reprovado, motivo fora da lista, texto > 500, ou limite K+1 por IP no escopo `denuncia`, então nada é gravado e o erro é o previsto; limites de `reserva`/`avaliacao` não afetam.
- CA-4 Dado denúncia repetida do mesmo IP à mesma avaliação pendente, 20 paralelas, então 1 linha, sem 5xx/23505/impasse (loop ×10 como as demais).
- CA-5 Dado avaliação retirada, de outro salão, inexistente ou id malformado, quando denunciada, então resposta idêntica à de sucesso e zero linhas gravadas.
- CA-6 Dado super admin com TOTP, quando retira com motivo, então some de `/{slug}` (e da média/contagem), `retirada_por` = admin, auditoria com antes/depois e motivo na mesma transação (falha forçada da auditoria desfaz a retirada), denúncias pendentes resolvidas.
- CA-7 Dado avaliação retirada, quando restaurada, então reaparece, colunas nulas, auditoria `avaliacao.restaurar` com antes/depois.
- CA-8 Dado retirar duas vezes em paralelo, então um efeito e uma auditoria; o outro `recusado`.
- CA-9 Dado gestor, profissional, cliente anônimo ou sessão de salão, quando chamam as ações de moderação, então 403/401 reais e nada muda; `/admin/avaliacoes` mostra "Acesso negado" (gestor/profissional) ou redireciona (sem sessão); gestor não consegue editar/apagar avaliação do próprio salão por nenhuma rota.
- CA-10 Dado filtros por salão e estado, então a lista retorna só o esperado, com paginação estável; nenhum dado pessoal da cliente na página.
- CA-11 Dado arquivar denúncia, então `resolvida_em` preenchida, avaliação inalterada, auditoria gravada.
- CA-12 Dado motivo de moderação com e-mail/telefone ou vazio, então rejeitado.
- CA-13 Nenhuma mensagem/e-mail/WhatsApp é enfileirado em retirar/restaurar/denunciar (assert em `mensagem` e fila).
- CA-14 Migração aditiva aplica em base com dados; `check-env`/build/lint/typecheck/cobertura ≥ 90% passam; teste estático: só `repos/` importa Prisma.

## 6. Casos limite
Salão suspenso (RN-14); cliente anonimizada ou reserva corrigida após denúncia (avaliação já invisível: denúncias ficam na fila com estado "não publicada"); isolamento: admin vê todos os salões, mas a denúncia pública só atinge avaliações do `slug` do contexto; slug antigo/redirect; IP ausente ou atrás de proxy (usar o mesmo extrator de `protecao`); texto com HTML/Unicode (escapar na exibição); concorrência retirar × restaurar × arquivar × denunciar (ordem FOR UPDATE da avaliação; denúncia insere sem travar); fuso nas datas exibidas (`format.ts`, fuso do salão ou UTC consistente na fila, definir no design); sessão admin expirada durante a ação → 401; Origin/CSRF das actions como nas demais.

## 7. Dependências
D-032 (avaliação), D-027 (limite/Turnstile), D-033 (auditoria), D-034 (admin). Turnstile simulado/real via adaptador existente.

## 8. Impactos
Dados: migração aditiva (enum motivo, tabela, índice único parcial, índice da fila por `resolvida_em IS NULL`, FK composta salão/avaliação, `resolvida_por` sem FK como `retirada_por`, CHECK do texto e da `resolucao`) revisada pelo DBA; possível ampliação do enum de ação de auditoria (D-033). Cabeçalho de `repos/servico.ts` atualizado (lock order). Env: nenhuma nova prevista (segredo do `ip_hash` reutiliza o de `protecao`; confirmar). README (seção moderação) e CLAUDE.md. Infra/CI: sem mudança; E2E sem banco em demo `/dev/...` somente se necessário (vitrine).

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição): (a) enum de motivos e teto de 20 pendentes por avaliação conforme acima; (b) arquivar denúncia exige ação de auditoria nova (suposição: acrescentar `avaliacao.denuncia_resolver`; alternativa: não auditar, mas o requisito "toda ação do admin é auditada" a exige); (c) motivo da moderação obrigatório na retirada e opcional na restauração? Suposição: obrigatório nas duas; (d) média/contagem públicas excluem retiradas (verificar `leitura.ts` no design).
