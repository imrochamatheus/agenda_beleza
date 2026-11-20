# D-017 — Especificação: configurar fuso, regras de horário e troca de slug com histórico (issue #26, E2.5)

Fontes, por precedência: `docs/demandas/D-017/issue-26.md` (RN-1..RN-6 e CA-1..CA-4 decididos, não reabertos), `PLAN.md` ("Perfis e acesso" `:22`; "Agenda e atendimento" `:35`, `:41`; "Assinatura" `:69`; "Interface" `:106`; "Fora da primeira versão"), `CLAUDE.md` (invariantes "Tenant isolation" e "Time"; "UI conventions"), `docs/demandas/D-001/spec.md` (G-1..G-4 em `:10-13`; E2.5 em `:714-745`; E8.2 RN-4 em `:1561`), `docs/demandas/D-011/spec.md` (RN-8..RN-11, D-13), `docs/demandas/D-015/spec.md` (RN-10), `docs/demandas/D-016/spec.md` (RN-16, CA-17), memória do projeto ("E1.1/E2.5 devem recusar slugs de `SEGMENTOS_RESERVADOS`") e o código citado.

Adições desta especificação à issue: RNs complementares (RN-7 em diante) que tornam a issue verificável, CAs complementares (CA-5 em diante) e decisões não bloqueantes D-n (§9) para o arquiteto confirmar.

## 1. Problema

Hoje a funcionalidade é **inexistente**. Evidências:

- `ROTAS.configuracoes = '/painel/configuracoes'` (`src/config/navegacao.ts:34`) e o item "Configurações" da navegação do gestor (`:74`) existem, mas não há `src/app/painel/configuracoes/` (só `bloqueios`, `profissionais`, `servicos`, `_componentes`, `page.tsx` e `acoes.ts` em `src/app/painel/`). O link leva a 404.
- Não existe `src/server/salao/`, nem ação que altere `salao` ou `salao_slug` depois do cadastro. Só o cadastro (D-011, `src/server/repos/cadastro.ts`) grava `salao_slug`.
- Esquema (`prisma/schema.prisma:125-171`): `salao.nome`, `fuso` (padrão `America/Sao_Paulo`), `grade_min` (15), `antecedencia_min` (**120, em minutos**), `janela_dias` (60) e `intervalo_min` (0). **Não há CHECK** nessas colunas (`prisma/migrations/*/migration.sql`: só os defaults do init `:41-45`). `salao_slug(slug PK, salao_id, atual, criado_em)`: a PK dá unicidade global entre atuais e históricos; `salao_slug_formato_chk` (`^[a-z0-9]+(-[a-z0-9]+)*$`) e `salao_slug_atual_uniq` (um atual por salão) em `20261118000200_restricoes_sql/migration.sql:67-71`. Não há coluna que registre quando um slug virou histórico.
- Matriz de permissões: `'salao.configurar': linha('salao', 'negado', 'negado')` (`src/server/auth/permissoes.ts`); capacidade `configurar` existe (`src/server/tenant/context.ts:17-24`).
- `src/lib/slug.ts`: `FORMATO_SLUG`, `slugBase`, `escolherSlugLivre` (este trata reservado como colisão e acrescenta sufixo, regra **do cadastro**). `SEGMENTOS_RESERVADOS` (`src/config/navegacao.ts:127-137`) = primeiros segmentos de `ROTAS` (exceto `/[slug]`) + `api` + `_next`.
- `resolverSalaoPorSlug` (`src/server/repos/publico.ts:20`) já resolve slug atual ou histórico e devolve `historico` e `slugAtual`; o redirecionamento HTTP é da E4.1 (a página pública ainda não existe em `src/app`).
- `validarFuso` (`src/server/tempo/fuso.ts:52`) aceita tudo o que o `Intl` aceita. Verificado em Node 24.21.0 (`node -e` com `new Intl.DateTimeFormat('en-US', { timeZone })`): **aceita** `+03:00`, `-0300`, `UTC`, `Etc/GMT+3`, `Brazil/East`, `US/Eastern`, `EST5EDT` e `america/sao_paulo` (normaliza a caixa), e recusa `America/Inexistente` e ` America/Sao_Paulo` (com espaço). `Intl.supportedValuesOf('timeZone')` devolve 418 nomes canônicos, inclui `America/Sao_Paulo`, `America/Manaus`, `America/Noronha` e `America/Buenos_Aires`, e **não** inclui `UTC`, offsets nem aliases como `Brazil/East`. Logo, `validarFuso` sozinho não garante "IANA válido" no sentido desta demanda (RN-2, RN-9).

## 2. Objetivo

O gestor ajusta, numa tela do painel, o nome do salão, o fuso horário e as regras de horário (grade, antecedência mínima, janela máxima e intervalo entre atendimentos), e troca o slug público. O slug anterior fica registrado como histórico do próprio salão, para que a E4.1 o redirecione ao atual e nenhum outro salão possa usá-lo.

## 3. Escopo

Entra:
- Página `/painel/configuracoes` (só gestor), com dois formulários independentes (D-10): "Dados e regras de horário" (nome, fuso, grade, antecedência, janela e intervalo) e "Endereço público" (slug, com a lista dos slugs anteriores só para leitura).
- Validação pura e reutilizável (também pela E8.2, D-001 `:1561`) e serviço `src/server/salao/configuracoes.ts`, com as ações `defineAcao` correspondentes.
- Troca de slug em `salao_slug` (atual + histórico, unicidade global, recusa de reservados) numa transação.
- Testes unitários, de integração com PostgreSQL real e E2E (teclado, axe e sem JS).

Fica fora:
- Resposta HTTP de redirecionamento do slug antigo e a própria página pública (E4.1).
- Efeito das regras no cálculo da disponibilidade (E3.1); antecedência e janela valem só para a página pública (D-001 S5, E3.4).
- Bloqueio por estado do salão (suspenso, assinatura): só a capacidade é declarada; o comportamento é da E6.4.
- Edição pelo super admin (E8.2), que reutiliza as validações daqui.
- Dados do gestor (nome, e-mail, senha) e dados de assinatura.

Conferido contra "Fora da primeira versão" do `PLAN.md`: nada aqui cria caixa, estoque, comissões, relatórios, fidelidade, pagamentos de clientes, lembretes, contas de cliente, múltiplos gestores nem preço/duração por profissional.

## 4. Regras de negócio

Decididas pela issue (não reabrir):
- **RN-1** (issue RN-1; `PLAN.md:35`): os padrões (grade 15 min, antecedência 2 h, janela 60 dias, intervalo 0 min, fuso `America/Sao_Paulo`) valem na criação do salão. Já são os defaults do banco e o cadastro da D-011 não os altera; esta demanda não muda o cadastro.
- **RN-2** (issue RN-2; `PLAN.md:41`): o fuso deve ser IANA válido. Detalhada em RN-9.
- **RN-3** (issue RN-3; D-011 RN-8, RN-9): o slug segue o formato de E1.1 e é único entre os slugs atuais e históricos de todos os salões (PK de `salao_slug`). Detalhada em RN-11..RN-14.
- **RN-4** (issue RN-4; `PLAN.md:22`): ao trocar o slug, o anterior vira histórico (`atual = false`) do mesmo salão e o novo passa a ser o atual, **na mesma transação**. O redirecionamento permanente (301/308) é da E4.1.
- **RN-5** (issue RN-5): as mudanças valem para disponibilidades futuras; reservas existentes não mudam (`inicio`, `ocupado_ate` e os itens gravados são mantidos).
- **RN-6** (issue RN-6; G-2): as ações declaram a capacidade `configurar`; o bloqueio por estado do salão é verificado na E6.4 (`PLAN.md:69`: com o salão suspenso, "alterar configurações operacionais" fica bloqueado).

Complementares:
- **RN-7 — Permissão** (`permissoes.ts`, `'salao.configurar'`): só o gestor lê a página e executa as ações (`papeis: ['gestor']`, operação `salao.configurar`). Profissional: a página exibe "Acesso negado" (403) e a ação devolve `AcessoNegado`. Sem sessão: redireciona para `/entrar?proximo=/painel/configuracoes` (D-010). Super admin não tem acesso ao painel (`painel.acessar` negado).
- **RN-8 — Escopo do salão** (invariante "Tenant isolation"): as ações e a página operam sempre sobre `ctx.salaoId`. Nenhuma entrada do formulário escolhe o salão: um campo `salaoId` forjado é ignorado. A verificação de unicidade do slug lê `salao_slug` de todos os salões (tabela global), mas só responde "em uso" ou "livre", sem revelar a qual salão o slug pertence.
- **RN-9 — Fuso** (RN-2; D-6): o valor, sem aparar, deve pertencer **exatamente** (com a mesma caixa) a `Intl.supportedValuesOf('timeZone')` do runtime. Offsets (`+03:00`), `UTC`, aliases (`Brazil/East`, `US/Eastern`), caixa diferente (`america/sao_paulo`), espaços, vazio e inexistentes são recusados com "Escolha um fuso horário da lista.". Exceção: o valor igual ao fuso gravado hoje no salão é aceito, mesmo fora da lista (proteção contra uma atualização do tzdata que remova o nome; a tela o mostra como opção).
- **RN-10 — Regras de horário** (D-1..D-5): todos os valores são inteiros em base 10, sem casas decimais, sem sinal `+` e sem espaços internos (o texto é aparado nas pontas):
  - grade (min) ∈ {5, 10, 15, 20, 30, 60};
  - antecedência mínima em **horas**, de 0 a 72, gravada em `antecedencia_min` como horas × 60 e exibida como `antecedencia_min / 60`;
  - janela máxima em dias, de 1 a 365;
  - intervalo entre atendimentos em minutos, de 0 a 120;
  - coerência: antecedência (h) < janela (dias) × 24. Com a antecedência igual ou maior que a janela nenhum horário seria oferecido. Mensagem no campo antecedência: "A antecedência mínima precisa ser menor que a janela máxima.".
- **RN-11 — Nome do salão** (D-011 RN-7, D-13; D-14): as mesmas regras do cadastro: aparado e com espaços internos colapsados, de 2 a 80 caracteres, sem caracteres de controle. Mensagem: "Informe o nome do salão (de 2 a 80 caracteres)." (`src/server/auth/cadastro.ts:18`). Trocar o nome **não** altera o slug. O cabeçalho do painel passa a mostrar o novo nome.
- **RN-12 — Formato do slug na troca manual** (RN-3; D-7): a entrada é aparada nas pontas e convertida para minúsculas. Nada mais é convertido: acentos, espaços internos, `_` e outros caracteres são recusados, não transformados. O resultado deve casar `FORMATO_SLUG` (`src/lib/slug.ts`) e ter de 3 a 60 caracteres. Mensagem: "Use de 3 a 60 caracteres: letras minúsculas sem acento, números e hífens entre eles.".
- **RN-13 — Slug reservado** (memória do projeto; D-011 RN-9): um slug que pertença a `SEGMENTOS_RESERVADOS` (fonte única, sem cópia) é **recusado**, sem sufixo automático (diferente do cadastro): "Este endereço é reservado pelo sistema. Escolha outro.". Variações como `painel-2` são aceitas.
- **RN-14 — Unicidade e histórico** (RN-3, RN-4; D-8, D-9):
  - um slug atual ou histórico de **outro** salão é recusado: "Este endereço já está em uso. Escolha outro.". Um slug histórico nunca é liberado para outro salão na v1;
  - um slug **histórico do próprio salão** pode voltar a ser o atual: a linha existente passa a `atual = true` e a atual passa a `atual = false`, sem linha nova;
  - um slug igual ao atual é uma operação sem efeito: sucesso sem nenhuma alteração no banco e sem validar o formato, o que preserva slugs antigos curtos como `x`;
  - em qualquer recusa, `salao_slug` fica inalterado (G-3).
- **RN-15 — Atomicidade e concorrência** (RN-4; D-11):
  - a troca de slug (atual → histórico e novo → atual) é uma transação: o salão termina sempre com exatamente um slug atual;
  - duas trocas concorrentes do **mesmo** salão são serializadas: as duas podem terminar com sucesso, uma depois da outra (prevalece a última), e todo slug que foi atual fica como histórico;
  - dois salões pedindo o **mesmo** slug ao mesmo tempo: exatamente um vence, e o outro recebe a recusa da RN-14, sem 5xx e sem violação de constraint vazada;
  - o formulário de dados e regras grava os seis campos de uma vez ou nenhum. Entre edições concorrentes, prevalece a última gravação, sem 5xx.
- **RN-16 — Efeito da troca de fuso** (RN-5; D-015 RN-10; D-016 RN-16): nada é recalculado.
  - **Jornada**: hora de parede. Mantém os mesmos `inicio_min`/`fim_min` e passa a valer no novo fuso.
  - **Bloqueios** e **reservas**: guardam instantes UTC, que não mudam. Passam a ser exibidos no novo fuso.
  - A tela explica isso num texto de ajuda junto do campo (D-15).
- **RN-17 — Efeito das regras**: grade, antecedência, janela e intervalo não alteram reservas, jornadas nem bloqueios existentes (RN-5). O consumo das regras é da E3.1/E3.4.
- **RN-18 — Validação no servidor e mensagens** (`PLAN.md`, "Direção técnica"; G-3): toda validação é feita no servidor, com mensagens em pt-BR e erro por campo. Num envio inválido, todos os erros de campo são devolvidos juntos e nada é gravado. Os valores digitados são devolvidos para reexibição.
- **RN-19 — UI** (`CLAUDE.md`, "UI conventions"; D-009; padrão D-013..D-016):
  - fuso num `<select>` nativo com os fusos do Brasil num `<optgroup>` "Brasil" primeiro e os demais em "Outros" (D-6); grade num `<select>`; antecedência, janela e intervalo em `<input inputmode="numeric">` com a unidade no rótulo;
  - o formulário de slug mostra o endereço público atual (caminho `/<slug>`, como texto, D-16) e a lista dos slugs anteriores;
  - formulários por ação de servidor que funcionam sem JavaScript; erros associados aos campos (`aria-describedby`); resumo de erros ou mensagem de sucesso anunciados e focados;
  - utilizável só com o teclado, sem violações axe 4.14.0, cores só por tokens e caminhos só via `ROTAS`.

## 5. Critérios de aceitação

Integração = Vitest com PostgreSQL real e as fábricas de dois salões (`tests/support/`). "Recusado" segue a G-3: erro tipado com mensagem pt-BR e nenhuma linha de `salao`/`salao_slug` alterada, nem mesmo `atualizado_em`.

- **CA-1** (issue CA-1; RN-4, RN-14): Dado o salão A com slug atual `studio-bela`, quando o gestor de A troca para `bela-studio`, então `salao_slug` tem `('studio-bela', A, atual = false)` e `('bela-studio', A, atual = true)`, A tem exatamente 1 slug atual, e `resolverSalaoPorSlug('studio-bela')` devolve `{ historico: true, slugAtual: 'bela-studio' }` com o contexto de A (ponte para a E4.1). Integração (`tests/integration/salao/slug-historico.test.ts`).
- **CA-2** (issue CA-2; RN-8, RN-14): Dado o salão B com slug atual `b-atual` e histórico `b-antigo`, quando o gestor de A tenta trocar para `b-atual` e depois para `b-antigo`, então as duas tentativas são recusadas com "Este endereço já está em uso. Escolha outro." no campo slug, a mensagem não contém dados de B, e `salao_slug` de A e de B fica inalterado. Integração.
- **CA-3** (issue CA-3; RN-9): Dado o fuso `America/Inexistente`, quando o gestor salva, então o servidor recusa com erro no campo fuso. O mesmo para `+03:00`, `UTC`, `Brazil/East`, `america/sao_paulo`, ` America/Sao_Paulo` e vazio. Dado `America/Manaus`, então `salao.fuso = 'America/Manaus'` e a tela o mostra selecionado. Unidade (validação) + integração.
- **CA-4** (issue CA-4; RN-10): Dado uma grade de 7 (também 0, 25, 120, `15.0`, `abc` e vazio), quando o gestor salva, então o servidor recusa. Dado 30, então `grade_min = 30` é persistido e a tela, ao recarregar, mostra 30 selecionado. Unidade + integração.
- **CA-5** (RN-10, RN-18): limites, em unidade com todos os casos e em integração com amostra (um recusado e um aceito por campo):
  - antecedência: -1, 73, `2,5`, `2.5`, `+2` e vazio recusados; 0 e 72 aceitos (gravados como `antecedencia_min` 0 e 4320); 2 é exibido para o valor padrão 120;
  - janela: 0, 366 e `1e2` recusados; 1 e 365 aceitos;
  - intervalo: -1, 121 e `5.5` recusados; 0 e 120 aceitos.
  Um envio com dois campos inválidos devolve os dois erros e não grava nenhum dos seis campos.
- **CA-6** (RN-10, coerência): Dado janela 2 dias, então antecedência 48 é recusada com "A antecedência mínima precisa ser menor que a janela máxima." e 47 é aceita. Unidade + integração.
- **CA-7** (RN-11): Dado o nome `"  Studio   Bela Nova "`, então `salao.nome = 'Studio Bela Nova'`, o slug não muda e o cabeçalho do painel mostra "Studio Bela Nova". Nomes com 1 caractere, com 81 caracteres ou com um caractere de controle são recusados. Unidade + integração.
- **CA-8** (RN-12): Unidade, com amostra em integração:
  - `"  Bela-Studio "` → grava `bela-studio`;
  - recusados: `bela studio`, `bela_studio`, `-bela`, `bela-`, `bela--studio`, `estúdio`, `ab`, 61 caracteres e vazio;
  - aceitos: `abc`, `123` e 60 caracteres.
- **CA-9** (RN-13): Dado cada item de `SEGMENTOS_RESERVADOS` que case `FORMATO_SLUG` (iterando o conjunto exportado, sem lista copiada), quando o gestor tenta usá-lo, então a troca é recusada com a mensagem de reservado, sem sufixo e sem gravar nada. `painel-2` é aceito. Unidade (todo o conjunto) + integração (ao menos `painel` e `admin`).
- **CA-10** (RN-14): Dado A com histórico `studio-bela` e atual `bela-studio`, quando o gestor volta para `studio-bela`, então `studio-bela` fica `atual = true`, `bela-studio` fica `atual = false`, o número de linhas de A em `salao_slug` não muda e A tem 1 atual. Integração.
- **CA-11** (RN-14): Dado o atual `x` (curto, gravado pela fábrica), quando o gestor envia `x` (ou `" X "`), então o resultado é sucesso sem alteração e `salao_slug` fica idêntico (mesmas linhas e `criado_em`). Integração.
- **CA-12** (RN-15, concorrência entre salões): Dado A e B, quando os dois gestores pedem `disputado` em paralelo (`Promise.all`), então exatamente um termina com `disputado` atual e o outro recebe a recusa da RN-14, sem exceção não tratada, e o perdedor mantém o slug atual anterior. Repetir 10 vezes sem falha intermitente. Integração.
- **CA-13** (RN-15, concorrência no mesmo salão): Dado A com atual `s0`, quando duas trocas para `s1` e `s2` são enviadas em paralelo, então nenhuma falha com 5xx, A termina com exatamente 1 atual (`s1` ou `s2`), e `s0` e o perdedor ficam como histórico de A, ou, se uma das trocas foi recusada, ela não gravou nada. Repetir 10 vezes. Integração.
- **CA-14** (RN-7): Dado o profissional do salão A, a página `/painel/configuracoes` mostra "Acesso negado" (403) sem dados do salão, e as duas ações devolvem `AcessoNegado` sem alterar nada. Sem sessão, a página redireciona para `/entrar?proximo=%2Fpainel%2Fconfiguracoes`. O gestor que também tem perfil de profissional tem acesso. Integração.
- **CA-15** (RN-8, G-4): Dado os salões A e B, quando o gestor de A salva dados, regras e slug (inclusive com um campo `salaoId` de B forjado na entrada), então só A muda, a linha de B (`nome`, `fuso`, regras, `atualizado_em`) e os slugs de B ficam inalterados, e a página de A mostra só os valores e o histórico de A. Integração.
- **CA-16** (RN-5, RN-16, RN-17): Dado o salão A em `America/Sao_Paulo`, com uma jornada 09:00–12:00, um bloqueio de 14:00–16:00 local e uma reserva confirmada, quando o gestor troca o fuso para `America/Manaus` e a grade para 30, então `jornada.inicio_min/fim_min`, `bloqueio.inicio/fim` e `reserva.inicio/ocupado_ate`, além dos itens da reserva, ficam idênticos, e a lista de bloqueios passa a exibir 13:00–15:00. Integração.
- **CA-17** (RN-1, regressão): Dado um salão recém-criado pelo cadastro (D-011), quando o gestor abre a página, então ela mostra fuso `America/Sao_Paulo`, grade 15, antecedência 2, janela 60 e intervalo 0. Integração (página).
- **CA-18** (RN-6, G-2): as ações exportadas do módulo `*.acao.ts` são produtos de `defineAcao` com `papeis: ['gestor']` e capacidade `configurar` (conferido pelo teste de registro existente ou equivalente). Unidade/integração.
- **CA-19** (RN-19; E2E Playwright, viewport 375×812): só com o teclado (Tab, Shift+Tab, Enter, Espaço e setas no `<select>`), com foco visível, o usuário preenche e envia os dois formulários, vê erros associados aos campos e o resumo de erros focado, e vê o sucesso anunciado. As telas (inicial, com erro e com sucesso) têm zero violações axe 4.14.0 e nenhuma rolagem horizontal.
- **CA-20** (RN-19; E2E com JavaScript desligado): os dois formulários enviam, mostram os erros de validação do servidor com os valores digitados preservados e mostram o sucesso.

## 6. Casos limite

- **Fuso e virada de dia / horário de verão:** a troca não converte nada (RN-16). Num fuso com horário de verão, a interpretação da jornada é da E3.1 (D-015). Um fuso exótico mas válido (`Pacific/Chatham`, `Asia/Kathmandu`) é aceito; o efeito na disponibilidade é da E3.1.
- **Fuso gravado fora da lista** (tzdata atualizado ou valor gravado direto no banco): exibido como opção selecionada e aceito sem mudança (RN-9). Um alias como `Brazil/East` só é aceito se for o valor gravado hoje.
- **Concorrência:** CA-12 e CA-13. Troca de regras concorrente com uma nova reserva (E3.2): qualquer ordem é aceitável, sem efeito nas reservas existentes (RN-5).
- **Duplo envio sem JS:** o segundo envio do mesmo slug cai na RN-14 (igual ao atual, sem efeito). No formulário de regras, grava os mesmos valores duas vezes. Os dois são aceitáveis.
- **Isolamento entre salões:** CA-2, CA-15. A unicidade global não revela o dono do slug (RN-8).
- **Salão suspenso / assinatura:** capacidade `configurar` declarada (RN-6). O bloqueio e o estado claro na tela são da E6.4. Nesta demanda a política padrão permite.
- **Cliente anonimizada:** não se aplica, porque a demanda não lê nem altera clientes.
- **Entradas inválidas:** tipos errados (número em vez de texto, `null`, array), campos ausentes e strings enormes (por exemplo, 10 000 caracteres no slug ou no nome) são recusados sem 5xx (unidade).
- **Rota nova no futuro:** um slug já gravado que depois vire segmento reservado continua atual, porque a RN-14 não valida o formato quando o slug não muda. O conflito com a rota é da E4.1. Enviar de novo esse mesmo slug é uma operação sem efeito, e qualquer outro reservado é recusado.
- **Ocupação de slugs:** cada troca deixa o slug anterior reservado para sempre ao salão, então um gestor pode "acumular" slugs. Não há limite na v1 (D-12; risco registrado).
- **Permissões:** CA-14. O gestor sem perfil de profissional e o gestor com perfil têm o mesmo acesso.
- **Slug histórico como entrada da página pública:** resolvido hoje por `resolverSalaoPorSlug` (CA-1). A resposta 301/308 é da E4.1.

## 7. Dependências

- **Demandas:** E1.2/D-010 (sessão, `exigirAcessoAoPainel`, matriz) e E1.1/D-011 (formato do slug, `salao_slug`, regras do nome), ambas concluídas em `main`. D-015/D-016 definem o efeito do fuso (RN-16). Bloqueia E6.4 (#41) e E8.2 (#52), que reutiliza a validação e a troca de slug com outro contexto (super admin com auditoria). Relacionadas: E3.1 (#27), que consome as regras, e E4.1 (#37), que redireciona o slug histórico.
- **Integrações:** nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não são usados).
- **Runtime:** a lista de fusos vem do ICU do Node 24 (`Intl.supportedValuesOf`); não há dependência nova.

## 8. Impactos prováveis

- **Dados:** nenhuma migração **obrigatória**. As colunas, a PK global, `salao_slug_formato_chk` e `salao_slug_atual_uniq` bastam. Pontos para o arquiteto e o DBA decidirem:
  - (a) CHECKs de defesa em profundidade em `salao` (`grade_min IN (5,10,15,20,30,60)` e faixas de `antecedencia_min`, `janela_dias` e `intervalo_min`), coerentes com a RN-10 e com os defaults;
  - (b) a estratégia de serialização da troca de slug: por exemplo, `SELECT … FOR UPDATE` na linha de `salao`, seguido de `INSERT … ON CONFLICT (slug) DO NOTHING RETURNING` para o slug novo, como na D-011, sem abortar a transação. A ordem de atualização das linhas precisa respeitar `salao_slug_atual_uniq` (primeiro rebaixar o atual, depois promover o novo);
  - (c) não há coluna "virou histórico em", e `criado_em` registra só a primeira inserção. A lista de anteriores fica ordenada por `criado_em` (aproximação aceitável, D-16).
  Novas funções de repositório em `src/server/repos/` (só os repositórios importam o Prisma).
- **Infraestrutura/CI:** nenhum impacto. Os E2E novos entram no job `e2e` existente, sem banco, usando uma vitrine `/dev/configuracoes` (D-13) sob o segmento `dev`, que já é reservado. Assim, `SEGMENTOS_RESERVADOS` não muda. O DevOps é dispensável.
- **Código compartilhado:** a validação do fuso deve ser mais estrita que `validarFuso` (RN-9) sem quebrar os chamadores atuais. Mudar `validarFuso` ou criar uma função nova é decisão do arquiteto. `escolherSlugLivre` não serve para a troca manual, que recusa em vez de acrescentar sufixo.

## 9. Dúvidas

**Bloqueantes:** nenhuma.

**Não bloqueantes (suposições adotadas):**

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | Grade ∈ {5, 10, 15, 20, 30, 60}. | Sugestão da issue; CA-4 da issue exige uma lista. |
| D-2 | Antecedência em horas inteiras, de 0 a 72, gravada em minutos (× 60). | A issue fala em "(h)" e a coluna é `antecedencia_min`; horas inteiras evitam a conversão de frações. |
| D-3 | Janela de 1 a 365 dias inteiros. | Sugestão da issue. |
| D-4 | Intervalo de 0 a 120 minutos inteiros, sem exigir múltiplo de 5. | Sugestão da issue. O alinhamento com a grade é da E3.1. |
| D-5 | Antecedência < janela × 24 h. | Evita uma configuração sem nenhum horário oferecido. É uma regra nova, barata e verificável. |
| D-6 | Fuso válido = membro exato de `Intl.supportedValuesOf('timeZone')`, ou o valor já gravado. `<select>` com "Brasil" primeiro. | `validarFuso` aceita offsets, `UTC` e aliases (§1). O `<select>` evita digitação e funciona sem JS e com o teclado. Fusos do Brasil: os nomes da lista que começam por `America/` e pertencem ao Brasil (a lista exata fica com o arquiteto). |
| D-7 | Slug manual: apara e põe em minúsculas, sem transliterar. Tem de 3 a 60 caracteres. | Transformar silenciosamente surpreende o gestor. O limite de 60 cobre a base de 50 caracteres mais o sufixo do cadastro, e 3 evita endereços triviais. |
| D-8 | Um slug histórico do próprio salão pode voltar a ser o atual. | Ele já pertence ao salão (PK), então não há conflito. Evita prender o gestor a um erro de digitação. |
| D-9 | Um slug igual ao atual é uma operação sem efeito, sem validar o formato. | Evita recusar slugs antigos que não seguem a RN-12. |
| D-10 | Dois formulários independentes (dados/regras e slug). | A troca de slug tem efeito permanente (reserva o anterior para sempre). Separar evita que um erro num campo bloqueie o outro e simplifica a atomicidade. |
| D-11 | Regras: prevalece a última gravação. Slug: serializado por salão, com unicidade pela PK. | Mesmo padrão das demandas anteriores (D-014 CA-15) e da D-011 (`ON CONFLICT`). |
| D-12 | Sem limite de trocas de slug na v1. | O PLAN não pede limite. Risco de ocupação registrado para a E8.2 e o pós-v1. |
| D-13 | E2E em `/dev/configuracoes` (mesmos componentes, ações que só validam, sem banco), com `ROTAS.devConfiguracoes`. | O job `e2e` não tem PostgreSQL. É a convenção da D-015/D-016 (`/dev/jornada`, `/dev/bloqueios`). |
| D-14 | Nome do salão com as regras da D-011 (2 a 80). Trocar o nome não muda o slug. | Coerência com o cadastro. `PLAN.md:22`: o slug é gerado no cadastro e editável à parte. |
| D-15 | Efeito do fuso explicado em texto de ajuda, sem confirmação extra. | Uma confirmação em duas etapas sem JS custa uma tela a mais. O efeito é reversível (basta voltar o fuso). |
| D-16 | Endereço público mostrado como texto (`/<slug>`), sem link, até a E4.1. Lista de anteriores ordenada por `criado_em`. Sem auditoria para o gestor. | A página pública ainda não existe. O log de auditoria é só para o super admin (`CLAUDE.md`). `salao_slug` já guarda o histórico. |
