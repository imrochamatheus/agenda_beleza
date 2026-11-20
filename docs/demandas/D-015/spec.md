# D-015 — Definir a jornada semanal de cada profissional com pausas (issue #18, E2.3)

Fontes, por precedência: `docs/demandas/D-015/issue-18.md` (RN-1..RN-5 e CA-1..CA-4 decididos, não reabertos), `PLAN.md` ("Perfis e acesso", linhas 15-16; "Agenda e atendimento", 32, 35 e 39; "Interface", 106; critério de aceite 3, linha 137), `CLAUDE.md` (invariantes "Tenant isolation", "Time", "UI conventions"; padrão de ações da D-013), `docs/demandas/D-001/spec.md` (E2.3 em 658-685), `docs/demandas/D-013/design.md` e `docs/demandas/D-014/design.md` (padrão de ações e casca, ordem de travas) e o código citado abaixo.

## 1. Problema

Hoje a funcionalidade não existe.

- Não há página de jornada: `src/app/painel/profissionais/[id]/` só contém `page.tsx` (edição do profissional). A rota `jornada: (id) => '/painel/profissionais/<id>/jornada'` já existe em `src/config/navegacao.ts:31` e leva a 404.
- Não há `src/server/jornadas/` nem repositório de jornada em `src/server/repos/` (`ls src/server/repos`: nenhum `jornada.ts`). A única escrita na tabela é a fábrica de teste (`tests/support/factories.ts:186-199`: segunda a sábado, `dia_semana` 1..6, 540–720 e 780–1080, isto é 09:00–12:00 e 13:00–18:00, para quem atende).
- O que já existe e esta demanda reaproveita:
  - Esquema (`prisma/schema.prisma:302-316`): `jornada(id, salao_id, profissional_id, dia_semana smallint, inicio_min int, fim_min int, criado_em)`, FK composta `(salao_id, profissional_id)` → `profissional` (`ON DELETE RESTRICT`), índice `(salao_id, profissional_id, dia_semana)`. Não há `atualizado_em`. Comentário do esquema (linha 6): "A jornada é hora local em minutos".
  - Restrições SQL (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:91-108`): `jornada_dia_semana_chk` (0..6), `jornada_faixa_chk` (`0 <= inicio_min < fim_min <= 1440`) e a exclusion `jornada_sem_sobreposicao` (`profissional_id =`, `dia_semana =`, `int4range(inicio_min, fim_min) &&`). O intervalo é semiaberto `[início, fim)`: intervalos **contíguos** (09:00–12:00 e 12:00–13:00) **não** violam a exclusion. "Jornada que cruza a meia-noite local não é representável (S-3)" (linha 92).
  - Permissões (`src/server/auth/permissoes.ts:17,42`): `'jornada.editar'` vale `salao` para o gestor, `negado` para o profissional e para o super admin. **Não existe operação de leitura de jornada**, e a página do profissional exige `'profissional.gerir'` (`src/app/painel/profissionais/[id]/page.tsx`, `exigirAcessoAoPainel(…, ['gestor'], 'profissional.gerir')`), que é negada ao profissional. Hoje o profissional não tem como ver a própria jornada (contraria a RN-1 da issue).
  - Navegação do profissional: só "Agenda" e "Bloqueios" (`src/config/navegacao.ts:72`); `itemAtivo` marca "Profissionais" para `/painel/profissionais/abc/jornada` (`src/config/navegacao.test.ts:234`). `/painel` é mínimo (`src/app/painel/page.tsx:17-33`).
  - Fuso do salão: `salao.fuso` (IANA, padrão `America/Sao_Paulo`) e `grade_min` padrão 15 (`prisma/schema.prisma:128-131`); `FUSO_PADRAO` em `src/lib/format.ts:6`.
  - Formatação: `src/lib/format.ts` é a fonte única de formatação de exibição (`src/lib/format.fonte-unica.test.ts`). **Não há** formatador de "minutos do dia" (HH:MM) nem nome de dia da semana.
  - Padrão de ações (D-013 §3, D-014): `src/server/<modulo>/<modulo>.acao.ts` sem `'use server'`, só exportações de `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`, handler fino que delega a `servico.ts`; casca `src/app/**/acoes.ts` com `'use server'`. Ordem canônica de travas: `profissional → servico` (D-014 §3.2); desativação de profissional usa `FOR UPDATE` na linha do profissional (D-013 §0).
  - Política por estado do salão: `politicaDeOperacao = permitirTudo` (`src/server/tenant/politica.ts:17`), real só na E6.4.

## 2. Objetivo

O gestor define, pelo painel, em que dias e em quais intervalos cada profissional do salão trabalha, com pausas entre os intervalos, em horário local do salão. Essa jornada é a base que a E3.1 usa para oferecer horários. O profissional consegue consultar a própria jornada, sem alterá-la.

## 3. Escopo

**Entra:**
- Página `/painel/profissionais/[id]/jornada` com os 7 dias da semana; para cada dia, zero ou mais intervalos de trabalho (dia sem intervalos = folga). As pausas são as lacunas entre intervalos, exibidas como resumo.
- Salvar a semana inteira de uma vez, de forma atômica (substitui a jornada anterior do profissional).
- Validação no servidor (formato, faixa, granularidade, sobreposição, meia-noite, limite de intervalos).
- Visualização somente leitura da própria jornada pelo profissional, com acesso a partir do painel.
- Link "Jornada" a partir da página do profissional (gestor) e da lista, se o arquiteto julgar útil.
- Formatador de minutos do dia em `src/lib/format.ts` (e nome do dia, se for exibido por formatador).
- Função de leitura da jornada de um profissional, por dia, para a E3.1.
- Testes unitários (validação), de integração com PostgreSQL real (CA, isolamento G-4, permissões, concorrência) e E2E/componente (teclado, axe, sem JS).

**Fica fora (com dono):**
- Exceções por data, folgas e compromissos: bloqueios, E2.4 (#19).
- Cálculo de disponibilidade a partir da jornada (incluindo fuso e virada de horário de verão): E3.1 (#27).
- Agenda e aviso de encaixe fora da jornada: E3.3/E3.4.
- Bloqueio real por estado do salão (suspenso = somente leitura): E6.4.
- Horário de funcionamento do salão como teto da jornada: não existe no `PLAN.md`; a jornada não é limitada por ele.
- Jornadas alternadas (quinzenais), por data de vigência ou com histórico de versões: não previstas no `PLAN.md`.
- Conferido contra "Fora da primeira versão" (`PLAN.md:131`): nada desta demanda cria caixa, comissões, preço/duração por profissional ou similares.

## 4. Regras de negócio

- **RN-1** (issue RN-1; `PLAN.md:16,32`): só o gestor edita jornadas, de qualquer profissional do próprio salão, inclusive do próprio perfil de profissional (gestor que atende). O profissional apenas visualiza a **própria** jornada. O super admin não acessa (matriz).
- **RN-2** (issue RN-2): cada intervalo tem `início < fim`, em minutos do dia (`inicio_min`, `fim_min`) no fuso do salão; intervalos do mesmo dia não se sobrepõem. A validação do servidor recusa antes de gravar; a exclusion `jornada_sem_sobreposicao` é a garantia final.
- **RN-3** (issue RN-5; migração linha 92): a jornada não atravessa a meia-noite: `0 ≤ início < fim ≤ 1440` (24:00). Um intervalo cujo fim é anterior ou igual ao início (ex.: 22:00–02:00) é recusado; o servidor não o divide em dois dias. Quem trabalha de madrugada cadastra 22:00–24:00 num dia e 00:00–02:00 no seguinte.
- **RN-4** (D-1): granularidade de 5 minutos: início e fim são múltiplos de 5. A jornada não depende da grade do salão (`grade_min`), que pode mudar; o alinhamento dos horários oferecidos é da E3.1.
- **RN-5** (D-2): intervalos contíguos no mesmo dia (fim de um = início do outro) são unidos ao salvar (09:00–12:00 + 12:00–13:00 → 09:00–13:00). A jornada gravada fica em forma canônica: por dia, intervalos ordenados, sem sobreposição e sem contiguidade, e toda pausa tem duração > 0.
- **RN-6** (D-3): salvar substitui a semana inteira do profissional numa única transação. Qualquer erro de validação recusa tudo, sem gravar nada, e devolve os erros por dia e por intervalo, preservando o que foi digitado.
- **RN-7** (D-4): no máximo 6 intervalos por dia.
- **RN-8** (issue, casos limite): dia sem intervalos é folga. Um profissional sem nenhum intervalo na semana não tem disponibilidade (E3.1), e a página avisa isso.
- **RN-9** (issue RN-3; `PLAN.md:39`): alterar a jornada não altera nem cancela reservas existentes, que podem ficar fora da nova jornada. Nenhuma mensagem é enfileirada.
- **RN-10** (`CLAUDE.md`, "Time"; issue RN-2): a jornada é hora local de parede, sem conversão para UTC ao gravar nem ao exibir. Se o fuso do salão mudar, a jornada continua com os mesmos horários de parede no novo fuso.
- **RN-11** (issue RN-4): as ações de escrita declaram `capacidade: 'configurar'`; o efeito em salão suspenso é verificado na E6.4. A leitura não é escrita.
- **RN-12** (`CLAUDE.md`, "Tenant isolation"; G-4): toda leitura e escrita é filtrada pelo salão da sessão. Profissional de outro salão, inexistente ou com id malformado dá 404, sem efeito.
- **RN-13** (D-5): a jornada de profissional inativo pode ser vista e editada pelo gestor; a página informa que ela só vale quando o profissional for reativado. Desativar ou reativar não apaga nem altera a jornada.
- **RN-14** (`PLAN.md` "Interface"; `CLAUDE.md` "UI conventions"): pt-BR, horários exibidos como `HH:MM` (24 h; 1440 exibido como `24:00`), dias de segunda a domingo; utilizável só com teclado; formulário funciona sem JavaScript.
- **RN-15** (D-6): `dia_semana` segue a convenção 0 = domingo … 6 = sábado (a mesma de `Date#getDay` e de `EXTRACT(DOW)`, já usada pela fábrica). A exibição começa na segunda.

## 5. Critérios de aceitação

Todos verificáveis por teste de integração com PostgreSQL real, salvo indicação. Os CA-1..CA-4 são os da issue. Correspondência no `PLAN.md`: critério 3 (horários fora da jornada não são oferecidos; a parte da oferta é da E3.1).

- **CA-1** (issue CA-1): Dado o gestor do salão A e um profissional ativo de A, quando salva segunda 09:00–12:00 e 13:00–18:00 e os demais dias sem intervalos, então a tabela `jornada` tem exatamente duas linhas desse profissional, `dia_semana = 1`, `(540, 720)` e `(780, 1080)`, e a página exibe a segunda com a pausa 12:00–13:00 e os demais dias como folga.
- **CA-2** (issue CA-2): Dado intervalos sobrepostos na mesma segunda (09:00–12:00 e 11:00–14:00), quando o gestor salva, então o servidor recusa com erro no dia/intervalo, e a jornada anterior do profissional fica idêntica (mesmas linhas e ids).
- **CA-3** (issue CA-3): Dado um profissional autenticado, quando chama a ação de salvar a jornada (a própria ou a de outro), então recebe `acesso_negado` (403), sem escrita. O mesmo vale para o super admin.
- **CA-4** (issue CA-4): Dado um intervalo 22:00–02:00, quando o gestor salva, então o servidor recusa e nada é gravado. Fim igual ao início (10:00–10:00) também é recusado.
- **CA-5** (RN-3): Dado 22:00–24:00 num dia, quando o gestor salva, então é aceito e gravado como `(1320, 1440)` e exibido como `22:00–24:00`. Dado início `24:00` ou fim acima de `24:00` (ex.: `24:05`, `25:00`), então é recusado.
- **CA-6** (RN-4): Dado um intervalo 09:07–12:00, quando o gestor salva, então é recusado com erro de granularidade. Horários malformados (`9h`, `12:60`, vazio só num dos campos, texto) são recusados com erro de campo.
- **CA-7** (RN-5): Dado 09:00–12:00 e 12:00–13:00 na mesma terça, quando o gestor salva, então fica gravada uma única linha `(540, 780)`. Intervalos enviados fora de ordem são gravados ordenados.
- **CA-8** (RN-6): Dado uma jornada existente de segunda a sábado, quando o gestor salva uma semana com só quarta 10:00–16:00, então restam só as linhas de quarta; e quando um único dia da semana enviada é inválido, então nenhum dia é alterado.
- **CA-9** (RN-7): Dado 7 intervalos válidos num mesmo dia, quando o gestor salva, então é recusado.
- **CA-10** (RN-9): Dado uma reserva confirmada de um profissional na quinta 15:00–16:00 (local), quando o gestor salva a quinta como folga, então a reserva continua com o mesmo status, instantes, itens e revisão, e nenhuma linha nova aparece em `mensagem`.
- **CA-11** (RN-12, G-4): Dado o gestor do salão A, quando salva ou abre a jornada de um profissional do salão B, ou com id inexistente ou malformado, então recebe 404 (`nao_encontrado` / página não encontrada) e as linhas de `jornada` de B ficam idênticas. Uma entrada que traga `salaoId`/`profissionalId` extras no corpo não altera o alvo.
- **CA-12** (RN-1): Dado o gestor com perfil de profissional, quando salva a própria jornada, então é aceito. Dado um profissional autenticado, quando abre `ROTAS.jornada(<seu id>)`, então vê a própria jornada em modo somente leitura (sem campos editáveis nem botão salvar); quando abre a de outro profissional do mesmo salão, então vê "Acesso negado"; quando abre a de outro salão, então 404.
- **CA-13** (RN-12; concorrência): Dado duas gravações simultâneas da jornada do mesmo profissional com semanas diferentes (`Promise.all`, laço ×10), então nenhuma dá 5xx nem erro da exclusion, e a jornada final é exatamente uma das duas semanas, sem mistura. Dado uma gravação concorrente com a desativação do mesmo profissional (D-013), então ambas terminam sem 5xx nem impasse.
- **CA-14** (RN-13): Dado um profissional inativo, quando o gestor abre a jornada, então vê o aviso de inativo; quando salva, então é aceito. Desativar e reativar o profissional não altera as linhas de `jornada`.
- **CA-15** (RN-8): Dado um profissional sem nenhum intervalo, quando o gestor ou o próprio profissional abre a página, então todos os dias aparecem como folga e há um aviso de que ele não terá horários disponíveis.
- **CA-16** (RN-10): Dado o salão A com `fuso = 'America/Manaus'`, quando o gestor salva 09:00–12:00, então `inicio_min = 540` e a página exibe `09:00` (sem conversão por fuso); o mesmo com `America/Sao_Paulo`.
- **CA-17** (RN-14; E2E Playwright, viewport 375×812): o gestor preenche e salva uma jornada só com teclado (Tab/Shift+Tab/Enter; foco visível; erros associados aos campos por `aria-describedby` e foco levado ao resumo de erros), e a página (edição, erro e somente leitura) não tem violações do axe 4.14.0.
- **CA-18** (RN-14): Com JavaScript desligado, o gestor consegue salvar uma jornada com até o máximo de intervalos por dia (RN-7) e ver os erros de validação; o profissional consegue ver a própria.
- **CA-19** (RN-11): As ações de escrita da jornada estão registradas com metadados `{ papeis: ['gestor'], capacidade: 'configurar' }` (conferido no teste de registro de ações).
- **CA-20** (formatação, RN-14): `src/lib/format.ts` exporta um formatador de minutos do dia (unitário: 0 → `00:00`, 545 → `09:05`, 1440 → `24:00`; valores fora de 0..1440, não inteiros ou não numéricos lançam erro) e `format.fonte-unica.test.ts` continua verde.

## 6. Casos limite

- **Fuso e virada de dia:** a jornada é hora de parede (RN-10); não há conversão nesta demanda. 24:00 é fim válido, 00:00 é início válido; intervalo que cruza a meia-noite é recusado (CA-4/CA-5).
- **Horário de verão:** o Brasil não tem DST hoje, mas o fuso é configurável. Num fuso com DST, uma hora local pode não existir (salto) ou repetir (recuo). Esta demanda grava e mostra só a hora de parede; a interpretação em instantes UTC, inclusive a hora inexistente/repetida, é obrigação da E3.1 (registrar na transferência).
- **Mudança de fuso do salão** (E2.5): a jornada não é recalculada (RN-10).
- **Mudança de `grade_min`:** não invalida jornadas (RN-4).
- **Concorrência:** dois gestores não existem (um por salão), mas a mesma sessão em duas abas pode gravar ao mesmo tempo; gravação × desativação (CA-13); gravação × reserva futura (E3.2): a gravação não pode bloquear indefinidamente reservas nem causar impasse com a ordem `profissional → servico` (D-014 §3.2).
- **Isolamento:** CA-11. A exclusion não tem `salao_id`, mas `profissional_id` é globalmente único (uuid), então não há colisão entre salões.
- **Salão suspenso:** a escrita declara `configurar`; o efeito real é da E6.4. A leitura (gestor e profissional) segue liberada.
- **Cliente anonimizada:** não se aplica (a jornada não toca clientes).
- **Profissional inativo** (RN-13; CA-14); **profissional sem jornada** (RN-8; CA-15).
- **Entradas inválidas:** dia fora de 0..6 ou desconhecido, campos de dias duplicados, mais de 6 intervalos, horário com segundos, negativo, acima de 24:00, formato `HH:MM` ausente, só início ou só fim preenchido numa linha (erro na linha); linha totalmente vazia é ignorada (útil para o formulário sem JS).
- **Permissões:** gestor (salão), profissional (só ver a própria), super admin (negado), sessão ausente (redirecionar para `/entrar?proximo=`), profissional com perfil inativo (401 por `resolverTenant`, D-010).
- **Reservas fora da nova jornada:** permanecem (RN-9; CA-10). Não há aviso de reservas afetadas nesta demanda (D-7).
- **Salvar sem mudança:** idempotente; resultado igual ao anterior, sem erro.

## 7. Dependências

- **Demandas:** E2.2/D-013 (profissionais; concluída, em `main`). Bloqueia E3.1 (#27) e E3.3 (#20). E2.5 (configuração do fuso) é independente.
- **Integrações:** nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não participam).
- **Dados:** tabela `jornada` e restrições da D-004, já existentes.
- **Obrigações para a E3.1:** ler a jornada pela função desta demanda; interpretar `dia_semana` com RN-15 e os minutos no fuso do salão, tratando hora inexistente/repetida em DST; contar com a forma canônica da RN-5.

## 8. Impactos prováveis

- **Dados:** provavelmente nenhuma migração (tabela e restrições já existem). Pontos para o arquiteto/DBA: (a) modo de trava na linha do profissional para serializar gravações sem conflitar à toa com reservas (`FOR KEY SHARE`) e mantendo a ordem `profissional → …` (D-013 §0, D-014 §3.2); (b) se a CHECK de múltiplo de 5 (RN-4) e a forma canônica (RN-5) ficam só no servidor ou também no banco (sugestão: só no servidor; o banco já garante faixa e não sobreposição); (c) o DELETE + INSERT dentro da mesma transação não viola a exclusion (é verificada por linha, depois do DELETE).
- **Permissões:** acréscimo de uma operação de leitura (ex.: `'jornada.ver'`: gestor `salao`, profissional `proprio`, super admin `negado`) em `src/server/auth/permissoes.ts` e no seu teste (D-8).
- **Navegação/UI:** link para a jornada no painel do profissional (D-9) e na página do profissional (gestor); `ROTAS.jornada` já existe.
- **Infraestrutura/CI:** nenhum impacto previsto; o novo E2E entra no job `e2e` existente. DevOps dispensável.
- **README:** sem mudança obrigatória (nenhuma variável nova).

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

- **D-1** (RN-4): granularidade de 5 minutos, igual à da duração dos serviços (D-014), independente da grade do salão.
- **D-2** (RN-5): contíguos são unidos ao salvar, em vez de recusados; não perde nada do que o gestor quis e simplifica a E3.1.
- **D-3** (RN-6): uma só gravação para a semana inteira (substituição atômica), em vez de gravar dia a dia; funciona sem JS num único formulário.
- **D-4** (RN-7): teto de 6 intervalos por dia (5 pausas), suficiente para salões e limita o tamanho do formulário sem JS (linhas vazias fixas por dia; a forma exata fica com o arquiteto).
- **D-5** (RN-13): profissional inativo tem jornada editável, para preparar a volta.
- **D-6** (RN-15): 0 = domingo, como a fábrica (`tests/support/factories.ts:189`); exibição de segunda a domingo.
- **D-7** (RN-9): nenhum aviso sobre reservas que ficariam fora da nova jornada; a agenda (E3.3/E3.4) mostrará o estado de encaixe.
- **D-8** (RN-1): a visualização pelo profissional usa uma operação nova de leitura na matriz e a mesma rota `ROTAS.jornada(id)` em modo somente leitura; outro profissional do mesmo salão vê "Acesso negado" (403), outro salão 404.
- **D-9** (RN-1): o acesso do profissional à própria jornada é um link em `/painel` ("Minha jornada"), sem item novo em `NAVEGACAO_PAINEL` (que só aceita rotas sem parâmetro).
- **D-10** (RN-14): o campo de fim precisa aceitar `24:00` sem JavaScript; `<input type="time">` não aceita esse valor, então a recomendação é campo de texto com `pattern` `HH:MM` e `inputmode` adequado (decisão final do arquiteto).
