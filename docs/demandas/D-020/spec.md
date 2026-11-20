# D-020 — Especificação: perfil público e horário de funcionamento do salão (issue #75, E2.6)

Fontes, por precedência (`docs/trinks-alinhamento.md` §1.2): `docs/trinks-alinhamento.md` (DT-4, DT-6 em `:18-20`; §7.1 em `:253-257`; §8.1–8.4 em `:294-354`), `PLAN.md` revisado ("Perfil público do salão" `:30-34`; "Agenda e atendimento" `:39`, `:46`; "Assinatura" `:79-81`; "Interface" `:122`; critérios de aceite 3 e 11 em `:154`, `:162`; "Fora da primeira versão" `:146`), corpo da issue #75 (CA-1..CA-5, mantidos e refinados abaixo), `CLAUDE.md` (invariantes "Tenant isolation" e "Time", "UI conventions", padrões D-013..D-017), `docs/demandas/D-015/spec.md` (jornada: RN-2..RN-10, RN-15) e `docs/demandas/D-017/spec.md` (configurações, trava do salão) e o código citado.

Adições desta especificação à issue: RNs que tornam os campos verificáveis (formatos, listas, normalização), a distinção "funcionamento não informado" × "todos os dias fechados", CAs complementares (CA-6 em diante) e decisões não bloqueantes D-n (§9) para o arquiteto confirmar.

## 1. Problema

Hoje a funcionalidade é **inexistente**. Evidências:

- Esquema: `model Salao` (`prisma/schema.prisma:125-157`) só tem `nome`, `fuso`, as quatro regras de horário, `suspenso_manual_em` e carimbos. Não há descrição, endereço, contato, Instagram, meios de pagamento nem comodidades. Não há tabela de funcionamento (lista de `model`/`enum` em `prisma/schema.prisma`; migrações em `prisma/migrations/`: só `init`, `reserva_exclusion`, `restricoes_sql` e `simuladores_integracao`).
- O que existe e esta demanda reaproveita:
  - **Jornada** (D-015): tabela `jornada(salao_id, profissional_id, dia_semana smallint, inicio_min, fim_min)` (`prisma/schema.prisma:302-316`) com `jornada_dia_semana_chk`, `jornada_faixa_chk` e a exclusion `jornada_sem_sobreposicao` (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:94-108`).
  - **Validação canônica da semana**: `validarSemana` (`src/server/jornadas/validacao.ts:135-156`) com `converterHorario` (`:19-32`), `validarDia` (limite de 6, sobreposição, `:87-112`) e `unirContiguos` (`:115-123`). O esquema de entrada é estrito e **exige `profissionalId`** (`:35-47`), então a função não serve como está para o salão: o núcleo (os 7 dias) precisa ser extraído sem mudar o comportamento da jornada (§8). As mensagens (`MENSAGENS_JORNADA`, `src/server/jornadas/tipos.ts:291-314`) misturam textos genéricos de intervalo (`formato`, `granularidade`, `ordem`, `sobreposicao`, `limite`) com textos próprios da jornada (`resumoErros`, `salva`, `semIntervalos`, `inativo`).
  - **Montagem e diferença**: `montarSemana`, `pausasDe` e `diferenca` (`src/server/jornadas/semana.ts`) são puros e dependem só de `(diaSemana, inicioMin, fimMin)` e, em `diferenca`, de `id`.
  - **Gravação como diferença sob trava**: `salvar` (`src/server/jornadas/servico.ts:46-66`) e `RepoJornada.aplicarDiferenca` (`src/server/repos/jornada.ts:165-187`), que não escrevem nada quando a semana é igual.
  - **Leitura sem papel**: `lerSemana` (`src/server/jornadas/leitura.ts`), consumida pela E3.1.
  - **Configurações do salão** (D-017): `RepoSalao` (`src/server/repos/salao.ts:34-47`) com a trava `SELECT … FROM salao … FOR NO KEY UPDATE` (`:86-95`; comentário `:13-17`: nunca `FOR UPDATE`, para não bloquear inserções com FK para `salao`). Página `/painel/configuracoes` (`src/app/painel/configuracoes/page.tsx:24-50`) com dois formulários e `exigirAcessoAoPainel(ROTAS.configuracoes, ['gestor'], 'salao.configurar')`. Ações em `src/server/salao/configuracoes.acao.ts` com `{ papeis: ['gestor'], capacidade: 'configurar' }`.
  - **Permissão**: `'salao.configurar': linha('salao', 'negado', 'negado')` (`src/server/auth/permissoes.ts:49`).
  - **Leitura pública**: `src/server/repos/publico.ts` (`resolverSalaoPorSlug`, `listarServicosPublicos`, `listarProfissionaisPublicos`) com `PublicoContext` e `select` explícito. Não há leitura de perfil.
  - **Rotas**: `ROTAS.configuracoes = '/painel/configuracoes'` (`src/config/navegacao.ts:34`); não há rota de perfil nem de funcionamento. `SEGMENTOS_RESERVADOS` deriva do primeiro segmento (`:128-138`), então rotas novas sob `/painel` e `/dev` não o alteram.
  - **Texto**: `normalizarNome` (`src/lib/texto.ts:10-16`) recusa caracteres de controle, inclusive quebra de linha, e não serve para a descrição multilinha.
  - **Telefone**: não há normalizador de telefone brasileiro em `src/` (`src/lib/` só tem `format`, `site`, `slug` e `texto`). `cliente.telefone_e164` existe no esquema (`prisma/schema.prisma:345`), mas a normalização é da E5.1.
  - **Política por estado**: `politicaDeOperacao = permitirTudo` (`src/server/tenant/politica.ts:14-17`), real só na E6.4.

## 2. Objetivo

O gestor mantém, pelo painel, as informações públicas do salão (descrição, endereço, contato, Instagram, meios de pagamento e comodidades) e o horário de funcionamento semanal. A página pública (E4.1) passa a ter o que exibir, e a disponibilidade (E3.1) passa a ter o funcionamento para limitar os horários junto com a jornada (DT-6).

## 3. Escopo

**Entra:**
- Colunas de perfil em `salao`, a tabela `salao_funcionamento` e o estado "funcionamento informado" (migração aditiva).
- Validação pura do perfil (`src/server/salao/`) e da semana de funcionamento (reaproveitando o núcleo da jornada).
- Serviço e ações `defineAcao` para salvar o perfil e salvar o funcionamento, com repositório escopado.
- Duas páginas do gestor (D-1): `/painel/configuracoes/perfil` e `/painel/configuracoes/funcionamento`, com acesso a partir de `/painel/configuracoes`.
- Leitura pública com projeção mínima do perfil e do funcionamento, para a E4.1.
- Leitura do funcionamento sem checagem de papel, para a E3.1 (análoga a `lerSemana`).
- Normalizador de telefone brasileiro e formatadores de exibição (telefone, CEP) em `src/lib/`.
- Vitrines `/dev/perfil` e `/dev/funcionamento` para os E2E sem banco.
- Testes de unidade, de integração com PostgreSQL real (isolamento, permissões, concorrência) e E2E (teclado, axe, sem JS).

**Fica fora (com dono):**
- Fotos: E2.7 (#76).
- A página pública que exibe o perfil, o link "Como chegar" e o redirecionamento do slug: E4.1 (#37).
- O efeito do funcionamento na disponibilidade: E3.1 (#27); na revalidação da reserva: E3.2 (#34); no aviso de encaixe: E3.4 (#35); na faixa de fundo da agenda: E3.3 (#20).
- Horários especiais por data: roteiro posterior (`PLAN.md:146`). Feriados e fechamentos usam o bloqueio de salão (E2.4).
- Mapa embutido e geocodificação (issue #75, "Fora do escopo"); busca de CEP em serviço externo (D-9).
- Bloqueio por estado do salão (suspenso): E6.4. Aqui só se declara a capacidade.
- Edição pelo super admin: E8.2.
- Seed com perfil e funcionamento: E9.2 (#43).

Conferido contra "Fora da primeira versão" (`PLAN.md:146`): meios de pagamento são **informativos** (como a cliente paga no salão), sem nenhum pagamento de serviço pela cliente, caixa ou conciliação. Nada aqui cria horários especiais por data, conta de cliente nem preço por profissional.

## 4. Regras de negócio

### Acesso e escopo

- **RN-1 — Permissão** (issue CA-1; `permissoes.ts:49`): só o gestor lê as duas páginas e executa as duas ações, com operação `salao.configurar` e `papeis: ['gestor']`. Profissional: a página exibe "Acesso negado" (403) e a ação devolve `AcessoNegado`, sem escrita. Sem sessão: redireciona para `/entrar?proximo=<rota>` (D-010). Super admin: sem acesso ao painel. O gestor com perfil de profissional tem o mesmo acesso.
- **RN-2 — Escopo do salão** (`CLAUDE.md`, "Tenant isolation"; issue CA-1): as ações e as páginas operam sempre sobre `ctx.salaoId`; não há id de salão na rota nem na entrada. Um campo `salaoId` forjado na entrada é ignorado. Um contexto cujo salão não existe resulta em `NaoEncontrado` (404). Esta é a forma do "gestor de S2 no recurso de S1 → 404" da issue (D-2).
- **RN-3 — Capacidade** (G-2; `PLAN.md:79-81`): as duas ações declaram `capacidade: 'configurar'`. O bloqueio com o salão suspenso é da E6.4 (#41: "o gestor não altera o perfil nem as fotos"). As leituras não são escrita e continuam liberadas.

### Perfil

- **RN-4 — Campos opcionais e vazio = ausente** (D-3): todos os campos do perfil são opcionais. Texto vazio ou só com espaços é gravado como `NULL`, nunca como `''`. Listas vazias são gravadas como lista vazia. Um salão recém-criado tem o perfil todo vazio.
- **RN-5 — Descrição** (issue CA-2; §7.1): texto livre multilinha. Normalização: `\r\n` e `\r` viram `\n`; as pontas são aparadas. Depois de normalizada, tem no máximo **1.000** caracteres, contados em unidades UTF-16 (`String#length`, a mesma contagem do `maxlength` do navegador) (D-4). Caracteres de controle são recusados, exceto `\n` e `\t` (`\t` vira um espaço). Não há HTML nem Markdown: o texto é exibido como texto, preservando as quebras de linha. Mensagem: "Use no máximo 1.000 caracteres na descrição.".
- **RN-6 — Endereço** (issue CA-2; §7.1; D-5): campos logradouro, número, complemento, bairro, cidade, UF e CEP. O endereço é um bloco: ou fica todo vazio (sem endereço), ou logradouro, número, bairro, cidade, UF e CEP são obrigatórios (complemento é sempre opcional). Preencher só alguns dá erro em cada obrigatório faltante: "Preencha este campo ou deixe o endereço todo em branco.".
  - Logradouro (até 120), número (até 10), complemento (até 60), bairro (até 80) e cidade (até 80): aparados, espaços internos colapsados, sem caracteres de controle (mesma regra de `normalizarNome`). Número aceita texto (`123`, `123A`, `s/n`, `S/N`); `s/n` em qualquer caixa é gravado como `s/n`.
  - **UF**: uma das 27 siglas (AC, AL, AP, AM, BA, CE, DF, ES, GO, MA, MT, MS, MG, PA, PB, PR, PE, PI, RJ, RN, RS, RO, RR, SC, SP, SE, TO), aparada e convertida para maiúsculas. Fora da lista: "Escolha uma UF da lista.".
  - **CEP**: aceita `NNNNN-NNN` ou `NNNNNNNN` (aparado, no máximo um hífen nessa posição); é gravado com 8 dígitos e exibido como `NNNNN-NNN`. `00000000` é recusado. Outros formatos: "Informe o CEP com 8 dígitos (ex.: 01310-100).". Não se consulta a existência do CEP (D-9).
- **RN-7 — Telefone e WhatsApp de contato** (§7.1; D-6): dois campos opcionais e independentes (podem ser o mesmo número). Só números brasileiros:
  - entrada: dígitos com espaços, parênteses, hífens e pontos opcionais; prefixo opcional `+55` ou `55` (este só quando sobram 10 ou 11 dígitos); o `+` só é aceito no início e seguido de `55`;
  - depois do prefixo, 10 dígitos (DDD + fixo começando por 2 a 5) ou 11 dígitos (DDD + celular começando por 9). O DDD deve pertencer à lista de DDDs brasileiros válidos (constante única, sem cópia);
  - gravado em E.164 (`+55DDNNNNNNNN` ou `+55DDNNNNNNNNN`) e exibido como `(DD) NNNN-NNNN` ou `(DD) NNNNN-NNNN`;
  - recusados: outro código de país, 0800/0300/4004 e números de serviço, DDD inexistente, quantidade errada de dígitos, letras. Mensagem: "Informe um telefone brasileiro com DDD (ex.: (11) 3456-7890 ou (11) 98765-4321).";
  - o WhatsApp aceita fixo também (o WhatsApp Business funciona com número fixo).
- **RN-8 — Instagram** (issue CA-2; D-7): opcional. Aceita `perfil`, `@perfil` ou um endereço `instagram.com/perfil` (com ou sem `https://`, `www.`, barra final ou parâmetros de consulta, que são descartados). Grava só o nome de usuário, em minúsculas, sem `@`. O nome tem de 1 a 30 caracteres de `[a-z0-9._]`, não começa nem termina com ponto e não tem dois pontos seguidos. Endereço de outro domínio ou com mais de um segmento de caminho (`instagram.com/p/abc`) é recusado. Mensagem: "Informe o perfil do Instagram (ex.: @meusalao).". A exibição monta o link `https://www.instagram.com/<perfil>/` (E4.1).
- **RN-9 — Meios de pagamento e comodidades** (issue CA-2; §8.1; D-8): listas fixas, client-safe, em `src/server/salao/` (arquivo sem imports de servidor). Cada item tem uma **chave estável** (gravada) e um rótulo pt-BR (exibido):

  | Meios de pagamento (chave → rótulo) | Comodidades (chave → rótulo) |
  |---|---|
  | `dinheiro` → Dinheiro | `wifi` → Wi-Fi para clientes |
  | `pix` → Pix | `estacionamento` → Estacionamento |
  | `cartao_credito` → Cartão de crédito | `acessibilidade` → Acesso para cadeira de rodas |
  | `cartao_debito` → Cartão de débito | `bebidas` → Café e bebidas |
  | `carteira_digital` → Carteira digital por aproximação | `criancas` → Atende crianças |
  | `vale_presente` → Vale-presente do salão | `ar_condicionado` → Ar-condicionado |
  | | `animais` → Aceita animais de estimação |

  A entrada é um conjunto de chaves. Uma chave fora da lista é recusada ("Escolha opções da lista.") e nada é gravado. Repetições são ignoradas. A gravação segue a ordem da lista (forma canônica), então a mesma escolha sempre grava o mesmo valor. Uma chave gravada que depois saia da lista é ignorada na leitura e não quebra a página. As chaves nunca são renomeadas.
- **RN-10 — Gravação do perfil** (G-3): toda a validação é feita no servidor. Num envio inválido, todos os erros de campo voltam juntos, os valores digitados são devolvidos para reexibição e nada é gravado. Num envio válido, todos os campos do perfil são gravados de uma vez, numa única instrução, sem tocar outras colunas de `salao` (nome, fuso e regras ficam com a D-017). Entre gravações concorrentes do perfil, prevalece a última. O nome do salão não faz parte deste formulário (D-017).

### Funcionamento

- **RN-11 — Forma** (decisão do líder; §8.1): o funcionamento é semanal, por dia (`dia_semana` 0 = domingo … 6 = sábado), em minutos de parede do fuso do salão, com intervalos semiabertos `[início, fim)`. É guardado em `salao_funcionamento`, com a mesma forma da `jornada` (sem `profissional_id`).
- **RN-12 — Validação canônica** (issue CA-3; D-015 RN-2..RN-7): exatamente as regras da jornada: horários `H:MM`/`HH:MM`; múltiplos de 5; `0 ≤ início < fim ≤ 1440` (24:00 só como fim); sem cruzar a meia-noite (22:00–02:00 é recusado; usa-se 22:00–24:00 e 00:00–02:00 no dia seguinte); no máximo 6 intervalos por dia; sobreposição recusada; contíguos unidos; linhas vazias ignoradas; 7 dias explícitos na entrada. As mensagens por intervalo são as mesmas da jornada. Um envio inválido não grava nada e devolve os erros por dia e por intervalo, preservando o que foi digitado.
- **RN-13 — Informado × não informado** (decisão do líder; §7.1 "Funcionamento ausente"; D-10): o salão tem um estado explícito `funcionamento_definido` (booleano, padrão `false`):
  - **não informado** (`false`): o funcionamento não limita a disponibilidade, e a página pública omite a seção de horário. É o estado de todo salão existente e de todo salão novo (compatibilidade);
  - **informado** (`true`): a semana gravada vale. Um dia sem intervalos é **fechado**. Uma semana inteira fechada é válida e significa "sem horários públicos"; a tela avisa isso, como a jornada sem intervalos (D-015 RN-8).
  - Invariante: com `funcionamento_definido = false`, não há linhas em `salao_funcionamento` do salão. A leitura (RN-17) trata o estado `false` como "não informado" mesmo que existam linhas (defesa).
- **RN-14 — Gravação do funcionamento** (issue CA-4; D-015 RN-6, D-13): o formulário tem uma escolha explícita entre "Não informar (a disponibilidade segue só a jornada de cada profissional)" e "Informar o horário abaixo". A gravação é uma transação:
  - "informar": substitui a semana como diferença (intervalos mantidos conservam o id) e põe `funcionamento_definido = true`;
  - "não informar": remove todas as linhas do salão e põe `funcionamento_definido = false`; as linhas digitadas são ignoradas, sem validação;
  - **idempotência**: gravar o mesmo estado e a mesma semana não escreve nada, nem em `salao_funcionamento` nem em `salao` (`atualizado_em` e a versão da linha ficam iguais);
  - a semana gravada é sempre a forma canônica: o salão nunca fica com uma semana mista de duas gravações.
- **RN-15 — Efeito em outros dados** (D-015 RN-9; DT-6): gravar o funcionamento não altera, não cancela e não avisa sobre reservas, jornadas nem bloqueios, mesmo que fiquem fora do novo horário. Nenhuma mensagem é enfileirada. A jornada pode ultrapassar o funcionamento: o limite é aplicado pela E3.1 como interseção, e o encaixe da equipe fora dele continua permitido com aviso (E3.4).
- **RN-16 — Hora de parede** (`CLAUDE.md`, "Time"; D-015 RN-10; D-017 RN-16): sem conversão para UTC ao gravar nem ao exibir. Trocar o fuso do salão não recalcula o funcionamento. A interpretação em instantes, inclusive horas inexistentes ou repetidas em fusos com horário de verão, é da E3.1 com `src/server/tempo/fuso.ts`.

### Leituras para outras demandas

- **RN-17 — Leitura do funcionamento sem papel** (E3.1; análoga a `lerSemana`): uma função que recebe o contexto do salão (de tenant, de sistema ou público, D-11), não confere papel e devolve `{ definido: false }` ou `{ definido: true, semana }`, com 7 dias (índice = `diaSemana`), intervalos canônicos ordenados e as pausas. Só lê o salão do contexto.
- **RN-18 — Leitura pública do perfil** (E4.1; DT-4; `PLAN.md:81`): uma função em `src/server/repos/publico.ts` com `PublicoContext` e `select` explícito, que devolve só: nome, descrição, endereço (ou `null` se vazio), telefone e WhatsApp (E.164), Instagram, meios de pagamento e comodidades (só chaves conhecidas, na ordem da lista) e o funcionamento (RN-17, `null` quando não informado). Não devolve `suspenso_manual_em`, regras de horário, ids de usuário, e-mails, `atualizado_em` nem dados de assinatura. Não filtra por suspensão ou estado da assinatura: o perfil continua visível com o salão suspenso (`PLAN.md:81`); a decisão de aceitar reserva é da E4.1/E6.4.

### Interface

- **RN-19 — Telas** (`CLAUDE.md`, "UI conventions"; D-009; padrão D-013..D-017; D-1):
  - `/painel/configuracoes` ganha links para "Perfil público" e "Horário de funcionamento"; o item "Configurações" da navegação continua ativo nas subpáginas (prefixo, `itemAtivo`);
  - perfil: descrição em `<textarea maxlength="1000">` com contador apenas informativo; UF em `<select>` nativo; CEP com `inputmode="numeric"`; telefones com `type="tel"`; meios de pagamento e comodidades como `<fieldset>` de caixas de seleção; texto de ajuda avisando que tudo o que for preenchido fica público;
  - funcionamento: o mesmo formulário de semana da jornada (segunda a domingo, linhas fixas por dia, campo de texto `HH:MM`), com a escolha da RN-14 por botões de opção, o resumo de pausas, "Fechado" para dia sem intervalos e um texto de ajuda que remete feriados e fechamentos ao bloqueio de salão (`ROTAS.bloqueios`);
  - formulários por ação de servidor que funcionam sem JavaScript; erros associados aos campos (`aria-describedby`); resumo de erros ou sucesso anunciado e focado; utilizável só com o teclado; zero violações axe 4.14.0; cores só por tokens; caminhos só via `ROTAS`; formatação de telefone e CEP só em `src/lib/format.ts`.

## 5. Critérios de aceitação

Integração = Vitest com PostgreSQL real e as fábricas de dois salões (`tests/support/`). "Recusado" segue a G-3: resultado `invalido` com mensagem pt-BR por campo, e nenhuma linha de `salao` ou `salao_funcionamento` alterada (nem `atualizado_em`). Correspondência no `PLAN.md`: critérios 1 (isolamento) e 11 (perfil completo na página pública, parte de dados); o critério 3 (fora do funcionamento) é verificado na E3.1.

- **CA-1** (issue CA-1; RN-1, RN-2, RN-18): Dado o gestor do salão S1, quando grava um perfil válido completo, então as colunas de S1 têm os valores normalizados, e a leitura pública de S1 (`resolverSalaoPorSlug` + leitura do perfil) os devolve, enquanto a de S2 continua vazia. Dado um profissional de S1, então a página `/painel/configuracoes/perfil` mostra "Acesso negado" e a ação devolve `AcessoNegado`, sem escrita. Dado o gestor de S2 com `salaoId` de S1 forjado na entrada, então só S2 muda e a linha de S1 (perfil, `funcionamento_definido`, `atualizado_em`) e as linhas de funcionamento de S1 ficam idênticas. Dado um contexto de salão inexistente, então `NaoEncontrado`. O mesmo para o funcionamento (página `/painel/configuracoes/funcionamento` e sua ação). Integração.
- **CA-2** (issue CA-2; RN-5..RN-10): Dado cada um dos casos abaixo, quando o gestor grava, então a resposta é `invalido` com mensagem pt-BR no campo indicado e nada é gravado; e um envio com vários campos inválidos devolve todos os erros juntos e os valores digitados:
  - descrição com 1.001 caracteres (e 1.000 aceita; uma descrição com quebras `\r\n` que, normalizada, tem 1.000 caracteres é aceita);
  - UF `XX`, `S`, `São Paulo` (e `sp` aceita, gravada `SP`);
  - CEP `1234-567`, `123456789`, `01310 100`, `abcde-fgh`, `00000-000` (e `01310-100` e `01310100` aceitos, gravados `01310100`);
  - endereço incompleto (só cidade preenchida): erro em logradouro, número, bairro, UF e CEP;
  - meio de pagamento `cheque` ou comodidade `sauna` (fora da lista);
  - Instagram `insta gram`, `.perfil`, `perfil.`, `pe..rfil`, 31 caracteres, `https://facebook.com/perfil`, `instagram.com/p/abc` (e `@Meu.Salao`, `https://www.instagram.com/meu.salao/?igsh=x` aceitos, gravados `meu.salao`);
  - telefone `+1 212 555 0100`, `(00) 3456-7890`, `0800 123 4567`, `(11) 8765-432`, `(11) 88765-4321` (11 dígitos sem 9), letras (e `(11) 3456-7890`, `11987654321`, `+55 11 98765-4321` aceitos, gravados `+551134567890`/`+5511987654321`).
  Unidade (todos os casos) + integração (um recusado e um aceito por campo, e o envio com vários erros).
- **CA-3** (issue CA-3; RN-12): Dado um funcionamento com intervalos sobrepostos (segunda 09:00–12:00 e 11:00–14:00), fora da grade de 5 min (09:07), cruzando a meia-noite (22:00–02:00), com fim igual ao início, com início 24:00 ou com 7 intervalos num dia, quando o gestor grava "informar", então é recusado com o erro no dia/intervalo e as linhas e o estado anteriores ficam idênticos. Dado 09:00–12:00 e 12:00–13:00 na mesma terça, então fica uma única linha `(2, 540, 780)`. Dado 22:00–24:00, então `(…, 1320, 1440)` exibido como `22:00–24:00`. Unidade (validação, reaproveitando os casos da jornada) + integração.
- **CA-4** (issue CA-4; RN-14): Dado o salão com uma semana informada, quando o gestor grava a mesma semana de novo, então nada é escrito: os ids de `salao_funcionamento` são os mesmos, e `salao.atualizado_em` e `xmin` da linha do salão não mudam. Dado duas gravações concorrentes de semanas diferentes do mesmo salão (`Promise.all`, laço ×10), então nenhuma termina com 5xx, impasse ou 23P01, e a semana final é exatamente uma das duas, sem mistura. Integração.
- **CA-5** (issue CA-5; RN-19; E2E Playwright, viewport 375×812): nas vitrines `/dev/perfil` e `/dev/funcionamento`, só com o teclado (Tab, Shift+Tab, Enter, Espaço; foco visível), o usuário preenche e envia os formulários, vê os erros associados aos campos com o resumo focado e vê o sucesso anunciado; as telas inicial, com erro e com sucesso têm zero violações axe 4.14.0 e nenhuma rolagem horizontal. Com JavaScript desligado, os dois formulários enviam, mostram os erros do servidor com os valores preservados (inclusive as caixas marcadas) e mostram o sucesso; o funcionamento aceita até 6 intervalos num dia.
- **CA-6** (RN-13, RN-17): Dado um salão recém-criado (fábrica ou cadastro D-011), então `funcionamento_definido = false`, não há linhas em `salao_funcionamento`, a leitura sem papel devolve `{ definido: false }` e a leitura pública devolve funcionamento `null`; e a página do funcionamento abre com "Não informar" selecionado. Integração.
- **CA-7** (RN-13, RN-14): Dado o salão não informado, quando o gestor grava "informar" com todos os dias vazios, então `funcionamento_definido = true`, não há linhas, a leitura devolve `{ definido: true }` com 7 dias fechados e a página mostra "Fechado" em todos os dias e o aviso de que não haverá horários públicos. Integração.
- **CA-8** (RN-14): Dado o salão informado com segunda a sábado 09:00–18:00, quando o gestor grava "não informar" (inclusive com linhas digitadas inválidas no formulário), então o resultado é sucesso, todas as linhas do salão são removidas, `funcionamento_definido = false` e a leitura devolve `{ definido: false }`. Gravar "não informar" de novo não escreve nada. Integração.
- **CA-9** (RN-14, D-015 CA-8): Dado segunda a sábado 09:00–18:00 informado, quando o gestor grava uma semana com só quarta 10:00–16:00, então restam só as linhas de quarta; e quando um único dia da semana enviada é inválido, nenhum dia é alterado. Uma semana alterada só em um dia preserva os ids dos intervalos não alterados. Integração.
- **CA-10** (RN-15): Dado uma reserva confirmada na quinta 15:00–16:00 local, uma jornada de quinta 09:00–18:00 e um bloqueio de salão, quando o gestor grava a quinta como fechada, então a reserva (status, instantes, itens, revisão), a jornada e o bloqueio ficam idênticos e nenhuma linha nova aparece em `mensagem`. Integração.
- **CA-11** (RN-16): Dado o salão em `America/Manaus`, quando o gestor grava 09:00–12:00, então `inicio_min = 540` e a página exibe `09:00`; trocar o fuso para `America/Sao_Paulo` (D-017) não altera as linhas. Integração.
- **CA-12** (RN-10, concorrência entre formulários): Dado o mesmo salão, quando em paralelo (`Promise.all`, laço ×10) se gravam (a) o perfil e o funcionamento, (b) o perfil e as regras da D-017, (c) o funcionamento e a troca de slug da D-017, então nenhuma termina com 5xx ou impasse e cada gravação aparece no estado final (as colunas de uma não são sobrescritas pela outra). Dado duas gravações concorrentes do perfil com valores diferentes, então o estado final é exatamente um dos dois. Integração.
- **CA-13** (RN-1, RN-3): as ações exportadas pelo novo `*.acao.ts` são produtos de `defineAcao` com `papeis: ['gestor']` e `capacidade: 'configurar'` (teste de registro de ações ou equivalente). Sem sessão, as duas páginas redirecionam para `/entrar?proximo=` com a rota codificada; o gestor com perfil de profissional tem acesso. Unidade/integração.
- **CA-14** (RN-4, RN-10): Dado um perfil preenchido, quando o gestor apaga a descrição, o Instagram e todos os campos do endereço e desmarca todas as opções, então as colunas de texto ficam `NULL` (não `''`), as listas ficam vazias e a leitura pública devolve endereço `null`. Dado só espaços na descrição, então `NULL`. Gravar o perfil não altera `nome`, `fuso` nem as regras de horário. Integração.
- **CA-15** (RN-9): Dado a entrada `['pix', 'dinheiro', 'pix']`, então a coluna grava `{dinheiro,pix}` (ordem da lista, sem repetição) e a página mostra as duas caixas marcadas. Dado uma chave desconhecida gravada direto no banco (`'cheque'`), então a página do gestor e a leitura pública a ignoram, sem erro, e a próxima gravação a remove. Unidade + integração.
- **CA-16** (RN-18): a leitura pública devolve exatamente as chaves da projeção da RN-18 (teste que compara o conjunto de chaves), sem `suspenso_manual_em`, regras, ids de usuário nem e-mails; com `suspenso_manual_em` preenchido, o perfil continua sendo devolvido. Integração.
- **CA-17** (RN-17): a leitura do funcionamento sem papel aceita contexto de sistema e público, devolve só o salão do contexto (S1 informado e S2 não informado dão resultados distintos) e devolve sempre 7 dias ordenados com intervalos canônicos e pausas. Integração.
- **CA-18** (RN-7, RN-19; formatação): `src/lib/format.ts` exporta formatadores de telefone (`+551134567890` → `(11) 3456-7890`; `+5511987654321` → `(11) 98765-4321`) e de CEP (`01310100` → `01310-100`), que lançam erro para entradas fora do formato gravado; o normalizador de telefone é puro, sem imports de servidor, e tem testes de unidade para a lista de DDDs; `format.fonte-unica.test.ts` continua verde. Unidade.
- **CA-19** (RN-12; regressão da jornada): depois da extração do núcleo de validação, todos os testes existentes da jornada (`src/server/jornadas/*.test.ts`, `tests/integration/jornadas/**`) continuam verdes sem mudar suas asserções, e as mensagens da jornada continuam as mesmas. Unidade + integração.
- **CA-20** (RN-19): Dado o gestor em `/painel/configuracoes`, então há links para as duas subpáginas; em `/painel/configuracoes/perfil` e `/painel/configuracoes/funcionamento`, o item "Configurações" da navegação está marcado como atual. Os caminhos vêm de `ROTAS` e `SEGMENTOS_RESERVADOS` não muda. Unidade (navegação) + integração (página).

## 6. Casos limite

- **Fuso e virada de dia:** o funcionamento é hora de parede (RN-16). 24:00 é fim válido e 00:00 é início válido; um salão que abre de madrugada cadastra 22:00–24:00 num dia e 00:00–02:00 no seguinte. A interseção com a jornada e o horário de verão são da E3.1.
- **Funcionamento × jornada:** uma jornada fora do funcionamento é aceita e não gera aviso nesta demanda; ela simplesmente não gera horários públicos depois da E3.1. Avisar o gestor na tela da jornada fica para a E3.3 (D-12).
- **Feriados:** não há horário por data; a tela remete ao bloqueio de salão (E2.4).
- **Concorrência:** CA-4 e CA-12. As gravações do perfil, do funcionamento, das regras e do slug serializam na linha de `salao` (trava `FOR NO KEY UPDATE`), sem impedir inserções de reserva ou bloqueio (que tomam só `FOR KEY SHARE`). Duas abas do mesmo gestor gravando: prevalece a última, sem mistura.
- **Duplo envio sem JS:** gravar o mesmo perfil duas vezes dá o mesmo estado; gravar o mesmo funcionamento duas vezes não escreve nada na segunda (RN-14).
- **Isolamento entre salões:** CA-1, CA-17. A exclusion de `salao_funcionamento` é por salão, então semanas iguais em salões distintos não colidem.
- **Salão suspenso:** capacidade `configurar` declarada (RN-3); nesta demanda a política permite. As leituras pública e sem papel não dependem da suspensão (RN-18).
- **Cliente anonimizada:** não se aplica, porque a demanda não lê nem altera clientes.
- **Entradas inválidas:** tipos errados (número, `null`, array no lugar de texto, texto no lugar de lista), chaves ausentes, campos extras, textos enormes (10.000 caracteres em qualquer campo), listas com centenas de itens e mais de 20 linhas por dia no funcionamento são recusados sem 5xx (unidade). Telefone não brasileiro: RN-7.
- **Privacidade (LGPD):** o telefone e o WhatsApp de contato podem ser números pessoais do gestor; a tela avisa que serão públicos (RN-19). Os logs registram só ids e contagens, nunca telefone, endereço ou descrição.
- **Conteúdo da descrição:** é texto puro; tentativas de HTML (`<script>`) são gravadas como texto e a E4.1 as exibe escapadas (o React escapa por padrão). Links na descrição não viram âncoras.
- **Chave de lista removida no futuro:** RN-9 e CA-15.
- **Permissões:** CA-1 e CA-13; profissional com perfil inativo cai no 401 de `resolverTenant` (D-010).
- **Dados legados:** salões existentes ficam com perfil vazio e funcionamento não informado (CA-6), sem efeito na disponibilidade.

## 7. Dependências

- **Demandas:** E2.5/D-017 (configurações, trava do salão) e E2.3/D-015 (validação e gravação da semana), ambas concluídas em `main`. D-019 (alinhamento) em revisão na PR #79. Bloqueia E2.7 (#76), E3.1 (#27, D-018, cuja especificação ainda não considera o funcionamento), E4.1 (#37) e E3.3 (#20).
- **Obrigações para a E3.1:** ler o funcionamento pela função da RN-17; com `definido: false`, não limitar; com `definido: true`, intersectar com a jornada (dia sem intervalos = sem horários); interpretar os minutos no fuso do salão como na jornada.
- **Obrigações para a E3.2/E3.4:** revalidar o funcionamento no servidor; decidir a trava compatível com a ordem `salao → profissional → …` (§8).
- **Obrigações para a E5.1:** reaproveitar ou estender o normalizador de telefone desta demanda, sem duplicar a lista de DDDs.
- **Integrações:** nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não são usados; não há consulta de CEP).

## 8. Impactos prováveis

- **Dados (DBA):** migração aditiva, revisada pelo DBA:
  - `salao`: colunas anuláveis `descricao`, `endereco_logradouro`, `endereco_numero`, `endereco_complemento`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep`, `telefone_e164`, `whatsapp_e164`, `instagram`; `meios_pagamento text[] NOT NULL DEFAULT '{}'`, `comodidades text[] NOT NULL DEFAULT '{}'`, `funcionamento_definido boolean NOT NULL DEFAULT false` (os defaults constantes não reescrevem a tabela);
  - `salao_funcionamento(id, salao_id, dia_semana smallint, inicio_min, fim_min, criado_em)` com FK para `salao` (`ON DELETE RESTRICT`), índice `(salao_id, dia_semana)`, CHECKs de dia (0..6) e de faixa (`0 ≤ inicio_min < fim_min ≤ 1440`) e a exclusion por `(salao_id =, dia_semana =, int4range &&)` com `btree_gist`, em SQL bruto, como na jornada;
  - a decidir pelo arquiteto/DBA: CHECKs de defesa em profundidade no perfil (`endereco_cep ~ '^[0-9]{8}$'`, UF na lista, E.164 `^\+55[0-9]{10,11}$`, `char_length(descricao) <= 1000`) e se as listas ganham CHECK (o §8.1 diz "validadas na aplicação"; um CHECK exigiria migração a cada opção nova).
- **Ordem de travas:** o cabeçalho de `src/server/repos/servico.ts` ganha `salao` no topo (§8.1: salao → profissional → servico → …). Gravar o funcionamento: `salao FOR NO KEY UPDATE` → leitura e diferença de `salao_funcionamento`. A E3.2 deve evitar `FOR SHARE` em `salao` (que conflitaria com essas gravações) ou assumir a serialização; é decisão dela.
- **Código compartilhado:** extrair de `validarSemana` o núcleo dos 7 dias (sem `profissionalId`) e separar as mensagens genéricas de intervalo das mensagens próprias, sem mudar o comportamento nem os textos da jornada (CA-19). `montarSemana`/`diferenca` podem ser reaproveitados como estão. Os componentes de semana da jornada (`src/app/painel/profissionais/[id]/jornada/FormularioJornada.tsx`, `VisaoJornada.tsx`) podem ser generalizados ou reaproveitados (decisão do arquiteto).
- **Permissões:** nenhuma operação nova (usa `salao.configurar`).
- **Navegação:** novas chaves em `ROTAS` (ex.: `configuracoesPerfil`, `configuracoesFuncionamento`, `devPerfil`, `devFuncionamento`), sem item novo em `NAVEGACAO_PAINEL`; `SEGMENTOS_RESERVADOS` não muda (primeiros segmentos `painel` e `dev`).
- **Infraestrutura/CI:** nenhum impacto. Os E2E novos entram no job `e2e` existente, sem banco, pelas vitrines (`VITRINE_COMPONENTES=true`). Sem variável de ambiente nova. DevOps dispensável.
- **README/CLAUDE.md:** linhas novas de comandos de estabilidade e E2E na tabela "Comandos e cobertura", seguindo o padrão das demandas anteriores.

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | Duas subpáginas, `/painel/configuracoes/perfil` e `/painel/configuracoes/funcionamento`, com links em `/painel/configuracoes`. | Os dois formulários são grandes (o funcionamento tem 7 × 6 linhas); páginas separadas mantêm um `useActionState` por página, o envio sem JS simples e erros de um formulário sem bloquear o outro. A issue cita só `/perfil`, e o líder deixou a subdivisão em aberto. |
| D-2 | O "404 para o gestor de S2" é garantido por construção: não há id de salão na rota nem na entrada, um `salaoId` forjado é ignorado e um contexto de salão inexistente dá `NaoEncontrado`. | O recurso é sempre o salão da sessão; não existe URL que aponte para S1. É o mesmo tratamento da D-017 (CA-15). |
| D-3 | Todo o perfil é opcional; vazio vira `NULL`. | O salão pode publicar aos poucos, e a E4.1 omite seções vazias. Evita `''` e `NULL` com o mesmo significado. |
| D-4 | Descrição: até 1.000 unidades UTF-16 depois de converter `\r\n` em `\n`; sem HTML. | Coincide com o `maxlength` do navegador (que conta uma quebra como 1), então o limite da tela e o do servidor concordam. |
| D-5 | Endereço "tudo ou nada": com qualquer campo preenchido, todos exceto o complemento são obrigatórios. | Um endereço parcial não serve para "Como chegar" (E4.1). Número aceita `s/n`. |
| D-6 | Telefone e WhatsApp: brasileiros, fixo (10 dígitos) ou celular (11, começando por 9), DDD da lista oficial, gravados em E.164; sem 0800/0300/4004. Normalizador puro em `src/lib/` para a E5.1 reaproveitar. | `CLAUDE.md` exige E.164 brasileiro para telefones; o WhatsApp Business funciona com fixo; números de serviço não aceitam WhatsApp e confundem a cliente. |
| D-7 | Instagram gravado como nome de usuário em minúsculas; aceita `@`, nome solto ou URL de `instagram.com`. | Evita guardar URLs arbitrárias (risco de link malicioso na página pública) e permite montar o link na exibição. |
| D-8 | Listas da RN-9: 6 meios de pagamento e 7 comodidades, com chaves estáveis e rótulos próprios. Ampliar a lista é mudança de código, sem migração. | §8.1: `text[]` validado na aplicação. Os rótulos são próprios (DT-1). |
| D-9 | Sem consulta de CEP nem geocodificação. | Exigiria uma integração externa nova, fora da issue. |
| D-10 | Estado explícito `salao.funcionamento_definido boolean NOT NULL DEFAULT false` e uma escolha "Não informar"/"Informar" no formulário. "Informar" com todos os dias vazios é válido (fechado). | Distingue "não limita" de "fechado todos os dias" sem depender de contar linhas; a coluna fica na linha de `salao`, já serializada pela trava da D-017. Alternativa descartada: proibir semana toda fechada e usar "zero linhas" como não informado, que torna impossível representar um fechamento temporário total e confunde o gestor. |
| D-11 | A leitura do funcionamento aceita contexto de tenant, de sistema e público. | A E3.1 roda tanto no painel (encaixe, E3.4) quanto na página pública (`PublicoContext`). A forma exata (uma função ou duas) fica com o arquiteto. |
| D-12 | Nenhum aviso sobre jornadas ou reservas fora do novo funcionamento. | Mesmo critério da D-015 D-7; a agenda (E3.3) mostra o funcionamento como faixa de fundo. |
| D-13 | Gravações do perfil sempre escrevem (sem comparação prévia); a idempotência estrita ("nada é escrito") vale para o funcionamento, como pede a issue. | A issue exige "nada escrito" só para a semana; o perfil é uma única instrução `UPDATE` e o resultado final é o mesmo. |
| D-14 | E2E nas vitrines `/dev/perfil` e `/dev/funcionamento` (ações que só validam, sem banco), sob `VITRINE_COMPONENTES=true`. | O job `e2e` não tem PostgreSQL; é a convenção das D-015..D-017. |
| D-15 | O funcionamento é visível e editável só pelo gestor nesta demanda. | A issue pede só o gestor; o profissional verá o funcionamento na agenda (E3.3). |
