# Alinhamento à Trinks (D-019)

Data de referência: 20/11/2026. Responsável: líder técnico (demanda D-019).

Este documento usa a Trinks como **referência de funcionalidades e fluxos** para o Agenda Beleza. Ele registra as decisões de produto desta etapa, compara a Trinks com o produto atual, reorganiza o backlog do [GitHub Project #3](https://github.com/users/imrochamatheus/projects/3) e define a ordem de implementação.

O Agenda Beleza mantém marca, identidade visual, textos, dados e código próprios. Não há integração com a API da Trinks, e nenhum texto, imagem ou dado da Trinks é copiado para o produto.

## 1. Decisões e precedência

### 1.1 Decisões de produto (tomadas pelo usuário em 20/11/2026)

| ID | Decisão |
|---|---|
| DT-1 | A Trinks é referência de funcionalidades e fluxos. O Agenda Beleza mantém marca, textos, dados e código próprios. Não haverá integração com a API da Trinks. |
| DT-2 | A assinatura SaaS do salão continua em **R$ 79/mês, com 30 dias grátis, pelo Mercado Pago**. Não adotamos os preços, as faixas por número de profissionais nem o teste de 5 dias da Trinks. |
| DT-3 | A cliente continua agendando **sem conta**, com **pagamento no salão**. Conta da cliente, pagamento antecipado (sinal), Clubes e Pacotes são evolução posterior (§6). |
| DT-4 | A página pública entra nesta etapa com: descrição, endereço, contato, horário de funcionamento, meios de pagamento, comodidades, fotos, serviços, equipe e avaliações. |
| DT-5 | O gestor envia as fotos pelo painel. Armazenamento real: **compatível com S3**. Em desenvolvimento e testes, um adaptador simulado grava em disco. |
| DT-6 | O horário público de funcionamento limita a disponibilidade **em conjunto** com a jornada do profissional. Um horário só é oferecido se o atendimento inteiro couber nos dois. O encaixe manual da equipe continua permitido fora desses horários, com o aviso explícito já previsto (E3.4). |
| DT-7 | A cliente só pode avaliar uma **reserva concluída**, uma única vez, por **link individual**, sem criar conta. O convite é enviado automaticamente por WhatsApp após a conclusão, apenas com consentimento específico. Informar um telefone não prova a identidade da cliente; só o link prova. |
| DT-8 | Nota e comentário são publicados assim que a cliente envia. Qualquer pessoa pode denunciar uma avaliação, e a moderação da plataforma (super admin) pode retirá-la. A avaliação some da página pública se a reserva passar a "não compareceu" ou se a cliente for anonimizada. |
| DT-9 | ~~Continuam valendo o fluxo de vários serviços consecutivos com um profissional e a proteção contra reservas sobrepostas no banco (constraint `reserva_sem_sobreposicao`).~~ **Revisado pela D-050 (E3.6, issue #111), por decisão do usuário:** cada serviço da reserva tem profissional, horário e status próprios, todos na mesma data local e sem sobreposição entre si; a proteção contra sobreposição por profissional continua no banco, agora sobre os itens (constraint `reserva_item_sem_sobreposicao`). |
| DT-10 | Os pré-requisitos ainda não implementados entram na cadeia desta etapa, cada um como demanda e PR próprios, na ordem das dependências (§8). |

### 1.2 Precedência

Quando houver conflito, a ordem de precedência é:

1. Este documento.
2. `PLAN.md` revisado.
3. O corpo das issues, incluindo a seção "Revisão D-019".
4. `docs/demandas/D-001/spec.md`.
5. As especificações de demandas anteriores.

Os trechos antigos do `PLAN.md` e das issues que conflitam com §1.1 deixam de valer. Os conflitos conhecidos são:
- "três modelos" de WhatsApp: agora são quatro;
- a página pública se limita ao fluxo de reserva: agora ela também tem um perfil do salão;
- a disponibilidade depende só da jornada: agora ela também depende do funcionamento do salão.

As issues já concluídas ficam como histórico e não são editadas.

## 2. Fontes consultadas

Todas as fontes foram acessadas em 20/11/2026. Classificação usada neste documento:
- **[Observado]**: visto na página pública indicada.
- **[Ajuda]**: descrito na central de ajuda oficial ou no site comercial.
- **[Proposta]**: comportamento proposto para o Agenda Beleza.

| Fonte | Situação da leitura |
|---|---|
| [Trinks Negócios](https://negocios.trinks.com/) | Lida por completo (site comercial) |
| [Planos](https://negocios.trinks.com/planos/) | Lida. Não ficou claro qual tabela de preço é a anual e qual é a mensal. Os preços exibidos podem ser promocionais. |
| [Esmalteria Nacional Pituba](https://www.trinks.com/esmalterianacionalpituba) | **Parcial.** As seções de serviços, equipe, textos de avaliações, pacotes e clubes carregam por script e não foram vistas. |
| [Cadastro de unidade](https://ajuda.trinks.com/como-cadastrar-uma-nova-unidade) | Lida |
| [Site de divulgação](https://ajuda.trinks.com/site-de-divulgacao) | Lida. As capturas de tela datam de 2021. |
| [Menu Agenda](https://ajuda.trinks.com/menu-agenda) | Lida. "Dias especiais e liberação de agenda" aparece só como link. |
| [Pesquisa de satisfação](https://ajuda.trinks.com/como-funciona-a-pesquisa-de-satisfacao-na-trinks) | Lida. Não descreve elegibilidade, prazo nem moderação. |
| [Feriados e horários especiais](https://ajuda.trinks.com/agenda/feriados-horarios-especiais) | Lida por completo |
| [Project #3](https://github.com/users/imrochamatheus/projects/3), `PLAN.md`, `CLAUDE.md`, `docs/demandas/D-001/spec.md` | Lidos. Em 20/11/2026, o Project tem 55 itens (#2–#56): 16 Closed/Done e 39 Open/Backlog. |

### 2.1 O que foi visto em cada fonte

**Página da Esmalteria Nacional Pituba [Observado]:**
- Nome do salão e uma nota agregada com a contagem de avaliações.
- Descrição em texto livre.
- Lista de formas de pagamento (cartões, PIX, dinheiro, vale-presente, entre outras).
- Idioma de atendimento.
- "Facilidades": Wi-Fi, estacionamento, bar e lanchonete, TV, atendimento a adultos e crianças.
- Endereço com mapa, telefones, links de redes sociais e site externo.
- Horário de funcionamento por dia da semana.
- Títulos de seção sem conteúdo visível: "Repetir último serviço", "Mais agendados", "Clubes de assinatura", "Pacotes", "Todos os serviços", "Nossa equipe" e "Avaliações dos nossos clientes".

Este documento **não** atribui à Pituba preços, profissionais, serviços nem textos de avaliação, porque nada disso foi visto. Também não foi vista uma galeria de fotos nem a grade de horários de agendamento.

**Site de divulgação [Ajuda]:**
- O site é gratuito e é gerado no cadastro.
- O salão sobe as fotos no painel. O tamanho sugerido é 800×500 px e não há limite de quantidade.
- O salão configura localização, horário de funcionamento e redes sociais em "Dados do estabelecimento".
- Em "+ Informações", o site mostra formas de pagamento, facilidades e políticas.
- As avaliações aparecem no site.
- A troca da URL é feita pelo suporte.

**Agenda [Ajuda]:**
- A agenda tem uma coluna por profissional.
- Um agendamento pode ter vários serviços.
- O sistema valida sobreposição, ausências e horários fora do expediente.
- Status disponíveis: aguardando confirmação, confirmado, em atendimento, finalizado, cancelado e "cliente não compareceu".
- Também há ausências, recorrência, etiquetas e fila de espera.
- O sistema avisa o cliente sobre novo agendamento, alteração, cancelamento e lembrete.

**Pesquisa de satisfação [Ajuda]:**
- A pesquisa é enviada automaticamente por SMS ou WhatsApp após o atendimento, pela "Rotina de Mensagens".
- O cliente responde com uma nota.
- O salão escolhe quais serviços disparam a pesquisa.
- Um relatório mostra média e lista, com filtros.
- Também existe a avaliação feita pelo app ou pelo perfil do cliente na Trinks.

**Feriados e horários especiais [Ajuda]:**
- Para cada data, o salão define "Fechado" (agendamento online bloqueado) ou "Horário especial", que substitui o horário regular do dia.
- Os feriados locais são cadastrados à mão.

**Cadastro de unidade [Ajuda]:**
- O mesmo login dá acesso a várias unidades.
- O cadastro tem o campo "Tamanho do negócio".
- A unidade escolhe o plano e os adicionais em "Meu Plano".

**Planos [Ajuda]:**
- Os preços variam por faixa de número de profissionais.
- O teste grátis é de 5 dias.
- Módulos como Clube de assinaturas, rotina de WhatsApp, fidelidade, lembretes e autoatendimento são vendidos como adicionais.

## 3. Jornadas

### 3.1 Contratação do salão (gestor)

| Passo | Trinks [Ajuda] | Agenda Beleza atual | Agenda Beleza proposto |
|---|---|---|---|
| 1. Cadastro | "Teste grátis" com dados do negócio e "Tamanho do negócio" | `/cadastro`: nome do salão, gestor, e-mail, senha. Slug gerado. Confirmação de e-mail (E1.1, D-011). | Sem alteração |
| 2. Plano | Faixas por profissionais, 5 dias grátis, adicionais | Previsto: R$ 79/mês, 30 dias grátis, MP (E6.1–E6.6, backlog) | Sem alteração (DT-2) |
| 3. Configuração | Dados do estabelecimento, serviços, profissionais, horários | Serviços (E2.1), profissionais (E2.2), jornada (E2.3), bloqueios (E2.4), regras e slug (E2.5) | **+ Perfil e funcionamento (E2.6), + fotos (E2.7)** |
| 4. Divulgação | Site gratuito com fotos, informações e avaliações | Inexistente | **Página pública com perfil completo e reserva (E4.1 revisada)** |
| 5. Operação | Agenda, status, notificações, pesquisa de satisfação | Previsto (E3.x, E7.x) | + Convite de avaliação após a conclusão (E4.5), + moderação (E8.4) |

### 3.2 Agendamento da cliente

| Passo | Trinks | Agenda Beleza proposto |
|---|---|---|
| 1. Chegada | [Observado] Página do salão com nota, descrição, pagamento, facilidades, endereço, horário e seções de serviços, equipe e avaliações | [Proposta] `/{slug}`: nome, nota média e quantidade de avaliações, descrição, fotos, endereço, contato, funcionamento, meios de pagamento, comodidades, serviços com preço e duração, equipe e avaliações. Um slug antigo redireciona com 308. |
| 2. Serviços | [Ajuda] Um agendamento pode ter vários serviços | [Proposta] A cliente escolhe um ou mais serviços. O total de duração e preço aparece na hora. |
| 3. Profissional | [Ajuda] A agenda é organizada por profissional | [Proposta, revisada pela D-050] Depois do dia, a cliente escolhe profissional e horário **para cada serviço**; só aparecem os profissionais que executam aquele serviço (a regra anterior, "profissionais que executam todos os serviços", RN-1 de E3.1, foi revogada) |
| 4. Horário | [Ajuda] Validação de sobreposição, ausências e expediente. Horários especiais substituem o horário regular. | [Proposta] Cada serviço precisa caber em funcionamento ∩ jornada do seu profissional, sem cruzar os serviços já escolhidos, fora de bloqueios e ocupações, respeitando grade, antecedência e janela. Fechamentos usam bloqueio de salão (E2.4). |
| 5. Dados | Conta Trinks ou dados do cliente | [Proposta] A cliente informa nome e WhatsApp. Há duas caixas de consentimento: **(a)** mensagens da reserva, obrigatória; **(b)** convite para avaliar após o atendimento, opcional e desmarcada por padrão. Turnstile. |
| 6. Confirmação | Notificação de novo agendamento | [Proposta] A tela confirma a reserva, que fica `confirmado`. O WhatsApp de confirmação é enviado depois do commit. O pagamento é feito no salão. |
| 7. Após o atendimento | [Ajuda] A pesquisa de satisfação é enviada automaticamente por SMS/WhatsApp e o cliente responde com uma nota | [Proposta] A equipe marca `concluido`. Se houver consentimento (b), um WhatsApp `convite_avaliacao` leva um link individual. A cliente dá nota de 1 a 5, comentário opcional e consentimento para publicar. A avaliação é publicada na hora. |
| 8. Moderação | Não descrita na ajuda | [Proposta] Botão "Denunciar" em cada avaliação. O super admin retira ou restaura a avaliação, com auditoria. |

## 4. Comparação de funcionalidades

| Área | Trinks | Agenda Beleza hoje | Proposto nesta etapa | Fonte (Trinks) |
|---|---|---|---|---|
| Assinatura do salão | Faixas por profissionais, 5 dias grátis, adicionais pagos | R$ 79/mês, 30 dias, MP (backlog E6) | Sem alteração (DT-2) | [Ajuda] planos |
| Perfil público | Descrição, endereço, mapa, telefones, redes, horário, pagamento, facilidades | Inexistente | E2.6 + E4.1 (sem mapa embutido; link "Como chegar" para mapas externos) | [Observado] Pituba; [Ajuda] site |
| Fotos | Logo e fotos do estabelecimento; fotos de profissionais | Inexistente | E2.7: fotos do salão, até 12, reprocessadas sem EXIF. Fotos de profissionais ficam para depois. | [Ajuda] site |
| Funcionamento | Horário por dia + horários especiais e feriados | Inexistente (só a jornada do profissional) | E2.6: funcionamento semanal com até 6 intervalos/dia. Fechamentos pelo bloqueio de salão. Horário especial: roteiro posterior (§6). | [Observado], [Ajuda] feriados |
| Serviços e equipe na página | Seções "Todos os serviços" e "Nossa equipe" | Leitura `listarServicosPublicos` pronta | E4.1 lista os serviços ofertáveis e os profissionais ativos (nome apenas) | [Observado] títulos de seção |
| Reserva online | Vários canais (hotsite, Google, Instagram, app, API) | Backlog E3.1/E3.2/E4.1 | Só a página pública própria | [Ajuda] agenda |
| Status | Aguardando, confirmado, em atendimento, finalizado, cancelado, não compareceu | 4 status (`confirmado`, `cancelado`, `concluido`, `nao_compareceu`) | Sem alteração; correção `concluido` ↔ `nao_compareceu` (S2) com efeito na avaliação | [Ajuda] agenda |
| Encaixe | Validação de expediente; liberação de horário | E3.4 com aviso explícito | Preservado. O aviso cobre também "fora do funcionamento do salão". | [Ajuda] agenda, feriados |
| Notificações | Novo, alteração, cancelamento, lembrete | Confirmação, remarcação, cancelamento (E7) | + `convite_avaliacao`. Lembretes continuam fora da v1. | [Ajuda] agenda |
| Avaliações | Pesquisa por SMS/WhatsApp após o atendimento; avaliação no app; nota no perfil | Inexistente | E4.5: avaliação verificada por link individual, nota de 1 a 5, comentário, publicação imediata | [Ajuda] pesquisa; [Observado] nota agregada |
| Moderação | Não documentada | Inexistente | E8.4: denúncia pública + retirada pelo super admin, auditada | — |
| Conta de cliente, sinal, Clubes, Pacotes, fidelidade, caixa, comissões | Existem, vários como adicionais | Fora da v1 | Roteiro posterior (§6) | [Ajuda] negócios, planos |
| Multiunidade | Mesmo login para várias unidades | Um gestor por salão | Sem alteração (fora da v1) | [Ajuda] cadastro de unidade |
| IA de atendimento, SMS, e-mail marketing, NF | Existem | Fora da v1 | Sem alteração | [Ajuda] negócios |

## 5. Matriz do Project #3 (55 itens + 4 novos)

Legenda:
- **Estado:** o estado no Project em 20/11/2026.
- **Ação:** "sem alteração", "revisar" (adicionar a seção "Revisão D-019" à issue) ou "nova".
- **Fase:** H = histórico (concluída); A = cadeia desta etapa (§8, com a posição na ordem); B = backlog da v1 depois desta etapa; R = roteiro posterior.
- **Critérios de aceite:** os da própria issue continuam valendo. A coluna lista só os **acréscimos** desta revisão.

| # | Chave | Título (resumido) | Estado | Lacuna frente às decisões | Ação | Fase | Dependências | Critérios de aceite acrescentados |
|---|---|---|---|---|---|---|---|---|
| [#2](https://github.com/imrochamatheus/agenda_beleza/issues/2) | E0 | Fundação técnica | Open/Backlog | Nenhuma (sub-issues concluídas) | sem alteração | H/B (fechar o épico) | E0.1–E0.8 | — |
| [#3](https://github.com/imrochamatheus/agenda_beleza/issues/3) | E0.1 | Projeto Next.js + ferramentas | Done | — | sem alteração | H | — | — |
| [#4](https://github.com/imrochamatheus/agenda_beleza/issues/4) | E0.2 | docker-compose e .env | Done | O volume das fotos é tratado em E2.7 | sem alteração | H | — | — |
| [#5](https://github.com/imrochamatheus/agenda_beleza/issues/5) | E0.3 | CI | Done | — | sem alteração | H | — | — |
| [#6](https://github.com/imrochamatheus/agenda_beleza/issues/6) | E0.4 | Esquema e constraint | Done | As tabelas novas entram por migrações aditivas em E2.6/E2.7/E4.5/E8.4 | sem alteração | H | — | — |
| [#7](https://github.com/imrochamatheus/agenda_beleza/issues/7) | E0.5 | Escopo de salão | Done | — | sem alteração | H | — | — |
| [#8](https://github.com/imrochamatheus/agenda_beleza/issues/8) | E0.6 | Portas e adaptadores | Done | A porta de armazenamento é tratada em E2.7 | sem alteração | H | — | — |
| [#9](https://github.com/imrochamatheus/agenda_beleza/issues/9) | E0.7 | Fila pg-boss | Done | — | sem alteração | H | — | — |
| [#10](https://github.com/imrochamatheus/agenda_beleza/issues/10) | E0.8 | Base visual | Done | — | sem alteração | H | — | — |
| [#11](https://github.com/imrochamatheus/agenda_beleza/issues/11) | E1 | Autenticação | Open/Backlog | — | sem alteração | B | E1.4, E1.5 | — |
| [#12](https://github.com/imrochamatheus/agenda_beleza/issues/12) | E1.2 | Login e sessão | Done | — | sem alteração | H | — | — |
| [#13](https://github.com/imrochamatheus/agenda_beleza/issues/13) | E1.1 | Cadastro do gestor | Done | — | sem alteração | H | — | — |
| [#14](https://github.com/imrochamatheus/agenda_beleza/issues/14) | E1.3 | Recuperar senha | Done | — | sem alteração | H | — | — |
| [#15](https://github.com/imrochamatheus/agenda_beleza/issues/15) | E2 | Configuração do salão | Open/Backlog | O escopo não inclui perfil e fotos | revisar | A | + E2.6, E2.7 | CA: E2.6 e E2.7 aprovadas antes de fechar o épico |
| [#16](https://github.com/imrochamatheus/agenda_beleza/issues/16) | E2.2 | Profissionais | Done | Foto de profissional fica no roteiro | sem alteração | H | — | — |
| [#17](https://github.com/imrochamatheus/agenda_beleza/issues/17) | E3 | Agenda e reservas | Open/Backlog | Funcionamento e correção de status com efeito na avaliação | revisar | A | E3.1–E3.5 | CA: CA 3 do PLAN inclui "fora do funcionamento" |
| [#18](https://github.com/imrochamatheus/agenda_beleza/issues/18) | E2.3 | Jornada | Done | O validador é reaproveitado no funcionamento | sem alteração | H | — | — |
| [#19](https://github.com/imrochamatheus/agenda_beleza/issues/19) | E2.4 | Bloqueios | Done | O bloqueio de salão de dia inteiro é o "fechado" (feriado) | sem alteração | H | — | — |
| [#20](https://github.com/imrochamatheus/agenda_beleza/issues/20) | E3.3 | Agenda da equipe | Open/Backlog | Mostrar o funcionamento do salão como faixa de fundo | revisar | A10 | E2.3, E2.4, E2.6 | CA: horários fora do funcionamento aparecem visualmente distintos |
| [#21](https://github.com/imrochamatheus/agenda_beleza/issues/21) | E1.4 | Convite de profissional | Open/Backlog | Não está na cadeia | sem alteração | B | E2.2, E0.6, E3.3 | — |
| [#22](https://github.com/imrochamatheus/agenda_beleza/issues/22) | E8 | Painel do administrador | Open/Backlog | O escopo não inclui moderação | revisar | A/B | + E8.4 | CA: E8.4 aprovada |
| [#23](https://github.com/imrochamatheus/agenda_beleza/issues/23) | E8.1 | Log de auditoria | Open/Backlog | A moderação audita retirada e restauração | revisar | A15 | E0.5 | CA: retirar/restaurar avaliação gera linha com valor anterior e novo |
| [#24](https://github.com/imrochamatheus/agenda_beleza/issues/24) | E1.5 | Super admin + TOTP | Open/Backlog | Pré-requisito da moderação | revisar (só dependência) | A16 | E1.2, E8.1 | — |
| [#25](https://github.com/imrochamatheus/agenda_beleza/issues/25) | E2.1 | Serviços | Done | — | sem alteração | H | — | — |
| [#26](https://github.com/imrochamatheus/agenda_beleza/issues/26) | E2.5 | Fuso, regras e slug | Done | — | sem alteração | H | — | — |
| [#27](https://github.com/imrochamatheus/agenda_beleza/issues/27) | E3.1 | Horários disponíveis | Open/Backlog | Considera só a jornada | revisar | A3 | E2.1, E2.3, E2.4, **E2.6** | CA: dado funcionamento 10:00–18:00 e jornada 09:00–19:00, o primeiro início é 10:00 e um serviço de 60 min não começa depois de 17:00; dia sem funcionamento não tem horários; a jornada fora do funcionamento não cria horários |
| [#28](https://github.com/imrochamatheus/agenda_beleza/issues/28) | E5 | Clientes e LGPD | Open/Backlog | A anonimização retira avaliações | revisar | A | E5.1, E5.2 | — |
| [#29](https://github.com/imrochamatheus/agenda_beleza/issues/29) | E5.1 | Clientes por salão | Open/Backlog | — | sem alteração | A4 | E1.2 | — |
| [#30](https://github.com/imrochamatheus/agenda_beleza/issues/30) | E7 | Mensagens WhatsApp | Open/Backlog | Quatro tipos | revisar | A | E7.1–E7.3 | — |
| [#31](https://github.com/imrochamatheus/agenda_beleza/issues/31) | E7.1 | Fila e envio | Open/Backlog | Sem o tipo `convite_avaliacao` | revisar | A6 | E0.6, E0.7 | CA: o tipo `convite_avaliacao` (revisão 0) passa pelo mesmo pipeline. Envio repetido não duplica. Falha não altera a reserva. Cliente anonimizada antes do envio resulta em `cancelada_anonimizacao`. |
| [#32](https://github.com/imrochamatheus/agenda_beleza/issues/32) | E4 | Página pública | Open/Backlog | Sem perfil nem avaliações | revisar | A | + E4.5 | CA: CA 2 do PLAN com a página de perfil |
| [#33](https://github.com/imrochamatheus/agenda_beleza/issues/33) | E4.3 | Termos e consentimento | Open/Backlog | Consentimento único | revisar | A5 | E0.5, E0.8 | CA: consentimento por **finalidade** (`mensagens_reserva`, obrigatório; `convite_avaliacao`, opcional e desmarcado), cada um com data e versão. A Política de Privacidade descreve as avaliações (dados publicados, retirada, denúncia). |
| [#34](https://github.com/imrochamatheus/agenda_beleza/issues/34) | E3.2 | Criar reserva | Open/Backlog | A revalidação precisa considerar o funcionamento | revisar | A7 | E3.1, E5.1, E7.1, E4.3 | CA: uma reserva pública fora do funcionamento é recusada no servidor mesmo se o horário veio de uma tela desatualizada |
| [#35](https://github.com/imrochamatheus/agenda_beleza/issues/35) | E3.4 | Reserva manual e encaixe | Open/Backlog | O aviso não cita o funcionamento | revisar | A11 | E3.2, E4.3 | CA: um encaixe fora do funcionamento do salão exige o mesmo aviso explícito e respeita a constraint |
| [#36](https://github.com/imrochamatheus/agenda_beleza/issues/36) | E3.5 | Remarcar, cancelar, status | Open/Backlog | Conclusão sem efeitos de avaliação | revisar | A12 | E3.3, E3.4 | CA: `concluido` cria o convite (se houver consentimento) na mesma transação. `concluido → nao_compareceu` invalida o link pendente e tira a avaliação da página. A volta para `concluido` não reenvia o convite. |
| [#37](https://github.com/imrochamatheus/agenda_beleza/issues/37) | E4.1 | Página pública e reserva | Open/Backlog | Só o fluxo de reserva | revisar | A8 | E3.2, E4.3, **E2.6, E2.7** | CA: a página mostra todas as seções do DT-4 e funciona em 375×812, por teclado e com axe sem violações. Um salão suspenso ou pendente mostra o perfil e "agendamento indisponível". O slug antigo responde 308. |
| [#38](https://github.com/imrochamatheus/agenda_beleza/issues/38) | E4.2 | Proteção da página | Open/Backlog | A denúncia também precisa de proteção | revisar | A9 | E4.1 | CA: o rate limit por IP também cobre o envio de avaliação e de denúncia |
| [#39](https://github.com/imrochamatheus/agenda_beleza/issues/39) | E6 | Assinatura MP | Open/Backlog | Nenhuma (DT-2) | revisar (preservação) | B | E6.1–E6.6 | — |
| [#40](https://github.com/imrochamatheus/agenda_beleza/issues/40) | E6.3 | Máquina de estados | Open/Backlog | — | sem alteração | B | E0.5, E0.7 | — |
| [#41](https://github.com/imrochamatheus/agenda_beleza/issues/41) | E6.4 | Somente leitura e página indisponível | Open/Backlog | Página "indisponível" esconderia o perfil | revisar | B | E6.3, E3.5, E2.5, E1.4, E4.1 | CA: com o salão suspenso, o perfil, as fotos e as avaliações continuam visíveis e só a reserva fica indisponível. O gestor não altera o perfil nem as fotos (capacidade `configurar`). |
| [#42](https://github.com/imrochamatheus/agenda_beleza/issues/42) | E9 | Entrega da v1 | Open/Backlog | — | revisar | B | E9.1–E9.4 | CA: os critérios do §7 deste documento fazem parte da validação final |
| [#43](https://github.com/imrochamatheus/agenda_beleza/issues/43) | E9.2 | Seed | Open/Backlog | Sem perfil, fotos e avaliações | revisar | A18 | E1.5, E3.2, (E6.3) | CA: dois salões com perfil, funcionamento, fotos de demonstração próprias e avaliações publicadas. Até a E6.3, a seed grava a assinatura `em_teste` diretamente. |
| [#44](https://github.com/imrochamatheus/agenda_beleza/issues/44) | E4.4 | E2E do fluxo público | Open/Backlog | Sem perfil, avaliação e denúncia | revisar | A18 | E4.2, E9.2, (E6.4) | CA: o E2E em 375×812 cobre perfil → reserva → (conclusão via seed) → avaliação por link → exibição → denúncia, com axe em cada tela. O cenário "salão suspenso" usa a suspensão manual até a E6.4. |
| [#45](https://github.com/imrochamatheus/agenda_beleza/issues/45) | E5.2 | Anonimizar cliente | Open/Backlog | Não trata avaliações | revisar | A13 | E5.1, E7.1 | CA: a anonimização remove a avaliação da página e o nome de exibição. O convite pendente fica `cancelada_anonimizacao`. |
| [#46](https://github.com/imrochamatheus/agenda_beleza/issues/46) | E6.1 | Teste após autorização | Open/Backlog | Nenhuma | revisar (preservação: R$ 79, 30 dias, MP) | B | E1.1, E6.3 | — |
| [#47](https://github.com/imrochamatheus/agenda_beleza/issues/47) | E6.2 | Webhooks MP | Open/Backlog | — | sem alteração | B | E6.1 | — |
| [#48](https://github.com/imrochamatheus/agenda_beleza/issues/48) | E6.5 | Assinatura no painel | Open/Backlog | Nenhuma | revisar (preservação) | B | E6.1 | — |
| [#49](https://github.com/imrochamatheus/agenda_beleza/issues/49) | E6.6 | Adaptador real MP | Open/Backlog | — | sem alteração | B | E0.6 | — |
| [#50](https://github.com/imrochamatheus/agenda_beleza/issues/50) | E7.2 | Adaptador real WhatsApp | Open/Backlog | Três modelos | revisar | B | E0.6 | CA: quatro modelos aprovados, incluindo `convite_avaliacao` com o link como parâmetro. README e `.env.example` com o nome do modelo. |
| [#51](https://github.com/imrochamatheus/agenda_beleza/issues/51) | E7.3 | Situação de envio | Open/Backlog | — | sem alteração | B | E7.1, E3.3 | — |
| [#52](https://github.com/imrochamatheus/agenda_beleza/issues/52) | E8.2 | Salões no painel | Open/Backlog | — | sem alteração | B | E1.5, E6.3, E2.5 | — |
| [#53](https://github.com/imrochamatheus/agenda_beleza/issues/53) | E8.3 | Assinatura, eventos e fila | Open/Backlog | — | sem alteração | B | E1.5, E6.2, E7.1, E8.2 | — |
| [#54](https://github.com/imrochamatheus/agenda_beleza/issues/54) | E9.1 | Página inicial | Open/Backlog | Sem a apresentação da página pública | revisar | A18 | E0.8, E0.6 | CA: a página inicial apresenta a página do salão (perfil, fotos, avaliações verificadas) e mantém R$ 79/mês com 30 dias grátis. Não cita a Trinks. |
| [#55](https://github.com/imrochamatheus/agenda_beleza/issues/55) | E9.3 | README | Open/Backlog | Faltam S3 e o 4º modelo | revisar | B (parcial em A18) | E9.2, E6.6, E7.2, E0.3, E4.2 | CA: o README lista as credenciais S3 e os quatro modelos de WhatsApp |
| [#56](https://github.com/imrochamatheus/agenda_beleza/issues/56) | E9.4 | Validar os critérios | Open/Backlog | Critérios novos | revisar | B | E9.3 … | CA: valida também o §7 deste documento |
| nova | **E2.6** | Perfil e funcionamento do salão | — | — | nova | A1 | E2.5, E2.3 | §7.1 |
| nova | **E2.7** | Fotos do salão | — | — | nova | A2 | E2.6, E0.6 | §7.2 |
| nova | **E4.5** | Avaliações verificadas | — | — | nova | A14 | E3.5, E7.1, E4.3, E4.1, E5.2 | §7.4 |
| nova | **E8.4** | Denúncias e moderação | — | — | nova | A17 | E4.5, E1.5, E8.1, E4.2 | §7.5 |

## 6. Alterações imediatas e roteiro posterior

### 6.1 Imediatas (esta etapa)

- E2.6, E2.7, E4.5 e E8.4 são novas.
- E3.1 é revisada para incluir o funcionamento.
- A cadeia de pré-requisitos é a do §8.

### 6.2 Roteiro posterior

As trilhas abaixo são independentes e nenhuma entra na entrega atual.

| Trilha | Escopo | Observação |
|---|---|---|
| **Assinatura SaaS** (E6.x, backlog da v1) | R$ 79/mês, 30 dias grátis, MP, carência e suspensão | Preservada (DT-2); segue no backlog B |
| **Pagamento de serviços** | Sinal ou pagamento antecipado pela cliente, reembolso, conciliação | Exige um provedor de pagamentos para a cliente (ex.: checkout do MP), política de cancelamento e revisão de LGPD/PCI. Não armazenar cartão. |
| **Conta da cliente** | Login da cliente, histórico, "repetir último serviço", avaliação vinculada à conta | Mudaria o modelo de identidade (hoje, salão + telefone) |
| **Clubes de assinatura** | Planos recorrentes da cliente com o salão | Depende de pagamento de serviços e conta da cliente |
| **Pacotes** | Venda de pacotes de sessões com saldo | Depende de pagamento de serviços |
| **Horários especiais** | Horário diferente numa data (substitui o semanal) | Hoje a alternativa é o bloqueio de salão |
| **Outros módulos** | Fila de espera, recorrência, etiquetas, lembretes, fidelidade, caixa, comissões, NF, SMS/e-mail marketing, IA de atendimento, multiunidade, fotos de profissionais, filtros do relatório de avaliações | Fora da v1 (`PLAN.md`, "Fora da primeira versão") |

## 7. Critérios verificáveis da etapa

Os critérios usam o formato Dado/Quando/Então. Cada demanda os detalha na própria `spec.md`.

### 7.1 E2.6 Perfil e funcionamento

- **Perfil e restrições.** Dado o gestor do salão S1, quando ele grava descrição (até 1.000 caracteres), endereço (logradouro, número, complemento, bairro, cidade, UF, CEP), telefone e WhatsApp de contato, Instagram, meios de pagamento e comodidades (listas fixas), então os dados ficam em S1 e aparecem na página pública. Um profissional recebe "Acesso negado". O gestor de S2 recebe 404.
- **Funcionamento semanal.** Dado o funcionamento semanal com até 6 intervalos/dia (mesma validação da jornada), quando o gestor salva a semana, então a gravação é atômica e idempotente. Um dia sem intervalos é "fechado".
- **Funcionamento ausente.** Dado um salão sem funcionamento cadastrado, quando se calcula a disponibilidade, então o funcionamento não limita (compatibilidade com salões existentes). A página pública omite a seção de horário.

### 7.2 E2.7 Fotos

- **Upload válido.** Dado um JPEG, PNG ou WebP válido de até 5 MB, quando o gestor o envia, então a imagem é reprocessada (sem EXIF, maior lado ≤ 1600 px, WebP), gravada pelo adaptador e listada com texto alternativo e ordem.
- **Upload inválido.** Dado um arquivo com extensão de imagem e conteúdo de outro tipo, maior que 5 MB, ou a 13ª foto, quando enviado, então é recusado com mensagem em pt-BR e nada é gravado.
- **Isolamento.** Dado uma foto de S2, quando o gestor de S1 tenta removê-la ou reordená-la, então recebe 404.
- **Configuração do armazenamento.** Dado `STORAGE_ADAPTER=real` sem as variáveis S3, quando a app inicia, então o check-env falha nomeando a variável.

### 7.3 E3.1 Disponibilidade (revisão)

- Os critérios estão em #27 e em `docs/demandas/D-018/`, mais os seguintes.
- **Funcionamento ∩ jornada.** Dado funcionamento 10:00–18:00 e jornada 09:00–19:00, quando se consulta um serviço de 60 min, então os inícios ficam entre 10:00 e 17:00.
- **Dia fechado.** Dado um dia fechado no funcionamento, quando se consulta esse dia, então não há horários.
- **Intervalos parciais.** Dado funcionamento 09:00–12:00 e 13:00–18:00 e jornada 08:00–18:00, quando se consulta 90 min, então 11:00 não é oferecido e 13:00 é.
- **Encaixe preservado.** Dado um encaixe da equipe fora do funcionamento, quando ele é criado com o aviso confirmado, então é aceito (E3.4).

### 7.4 E4.5 Avaliações

- **Convite enviado.** Dado uma reserva concluída de uma cliente com consentimento `convite_avaliacao`, quando o status muda para `concluido`, então é criada uma única mensagem `convite_avaliacao` (revisão 0) e enfileirada após o commit.
- **Convite não enviado.** Dado uma cliente sem esse consentimento, quando o status muda para `concluido`, então nenhum convite é criado.
- **Link válido.** Dado o link válido, quando a cliente envia nota 4, comentário e o aceite de publicação, então a avaliação aparece na página com o nome "Primeiro nome + inicial". A média e a contagem são atualizadas.
- **Link reutilizado ou vencido.** Dado o mesmo link usado de novo, vencido (30 dias) ou alterado, quando aberto ou enviado, então a resposta é uniforme ("link inválido ou expirado") e nada é gravado.
- **Link de outro salão.** Dado um link de outro salão, quando aberto em `/{slug}` de S1, então a resposta é inválido. Não existe rota que aceite reserva + telefone.
- **Correção para "não compareceu".** Dado a correção para `nao_compareceu`, quando a página é recarregada, então a avaliação não aparece e o link pendente é recusado. A volta para `concluido` mostra a avaliação de novo e não reenvia o convite.
- **Anonimização.** Dado a anonimização da cliente, quando a página é recarregada, então a avaliação não aparece.
- **Falha do WhatsApp.** Dado uma falha do WhatsApp, quando o worker tenta enviar, então a reserva não muda e as tentativas ficam registradas com backoff.
- **Salão suspenso.** Dado um salão suspenso, quando a página é aberta, então as avaliações continuam visíveis. Enviar avaliação por um link válido continua permitido.

### 7.5 E8.4 Denúncias e moderação

- **Denúncia.** Dado uma avaliação publicada, quando um visitante a denuncia (motivo de uma lista + texto opcional, Turnstile, rate limit), então a denúncia fica registrada e a avaliação continua visível.
- **Retirada e restauração.** Dado o super admin com TOTP, quando ele retira a avaliação, então ela some da página e a auditoria registra quem, quando, o quê e os valores anterior e novo. A restauração também é auditada.
- **Acesso negado.** Dado um gestor ou profissional, quando ele acessa a fila de moderação, então recebe 404 ou "Acesso negado". O gestor não pode apagar nem editar avaliações do próprio salão.

## 8. Impactos

### 8.1 Dados (somente migrações aditivas, revisadas pelo DBA)

- **`salao`:** colunas de perfil anuláveis.
- **`salao_funcionamento`:** mesma forma da `jornada`, com `CHECK 0 ≤ inicio < fim ≤ 1440` e sem sobreposição. Meios de pagamento e comodidades em `text[]` com valores validados na aplicação.
- **`salao_foto`:**
  - colunas: `salao_id`, `chave` do armazenamento, `alt`, `ordem`, largura, altura, bytes, `criado_em`;
  - limite de 12 por salão aplicado com `FOR NO KEY UPDATE` no salão.
- **`consentimento.finalidade`:** novo enum, com o padrão `mensagens_reserva` para as linhas existentes.
- **`tipo_mensagem`:** `ALTER TYPE … ADD VALUE 'convite_avaliacao'` numa migração própria.
- **`avaliacao_convite`:**
  - colunas: `salao_id`, `reserva_id` único, `token_hash` (SHA-256), `expira_em`, `usado_em`, `invalidado_em`;
  - o token em claro nunca é gravado.
- **`avaliacao`:**
  - colunas: `salao_id`, `reserva_id` único, `nota` 1–5 (CHECK), `comentario` (≤ 1.000), `nome_exibicao`, `publicacao_aceita_em`, `versao_termos`, `retirada_em`, `retirada_por`, `criado_em`;
  - visibilidade derivada: `retirada_em IS NULL` + reserva `concluido` + cliente não anonimizada.
- **`avaliacao_denuncia`:** `salao_id`, `avaliacao_id`, `motivo` (enum), `texto`, `ip_hash`, `criado_em`, `resolvida_em`.
- **Ordem de travas:** o cabeçalho de `src/server/repos/servico.ts` estende a ordem canônica (salao → profissional → servico → reserva → avaliacao).

### 8.2 Segurança e privacidade (LGPD)

- **Identidade por link.** A identidade da avaliadora é provada só pelo token de 256 bits, de uso único, com validade de 30 dias e invalidado quando a reserva deixa `concluido`. As respostas são uniformes, e a página do link envia `Referrer-Policy: strict-origin`.
- **Dados exibidos.** A página mostra só o primeiro nome + inicial. Telefone, e-mail e IDs nunca aparecem. O nome de exibição é recalculado, e some quando a cliente é anonimizada.
- **Consentimento separado.** O convite tem consentimento próprio e opcional. A publicação tem aceite no próprio formulário de avaliação. A Política de Privacidade passa a descrever avaliações e denúncias.
- **Fotos.**
  - O servidor reprocessa a imagem: remove o EXIF (inclusive GPS) e limita o tamanho.
  - O tipo é validado pelos bytes iniciais, nunca pelo nome ou pelo `Content-Type`.
  - O nome de arquivo do usuário não é usado como chave.
  - As fotos são servidas por uma rota própria ou URL pública do bucket, sem listagem.
- **Denúncias.** Turnstile + rate limit. O IP é guardado só como hash com sal.
- **Isolamento.** Toda leitura e escrita passa pelos repositórios escopados, com testes de isolamento entre dois salões em cada demanda.

### 8.3 Infraestrutura

- **Dependências:** `sharp` (dependência de runtime, no Dockerfile) e `@aws-sdk/client-s3` (versões exatas).
- **Armazenamento simulado:** `STORAGE_ADAPTER=simulado` grava em `ARMAZENAMENTO_DIR`, com um volume no compose.
- **Armazenamento real:** `STORAGE_ADAPTER=real` exige `S3_ENDPOINT`, `S3_REGIAO`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` e `S3_URL_PUBLICA` (opcional).
- **Upload:** por route handler, com limite de corpo de 5 MB.
- **WhatsApp:** variável do nome do 4º modelo (E7.2).
- **Documentação e CI:** README, `.env.example`, check-env e o smoke do Docker são atualizados.

### 8.4 Testes

- **Unidade:** validação de perfil e funcionamento; detecção de tipo por bytes iniciais; domínio da disponibilidade com o funcionamento; regras de visibilidade da avaliação.
- **Integração (PostgreSQL real):**
  - isolamento entre salões;
  - limite de fotos concorrente;
  - conflito concorrente de reserva (23P01);
  - idempotência do convite;
  - link reutilizado ou vencido;
  - correção de status;
  - anonimização;
  - moderação com auditoria.
- **E2E (375×812, axe 4.14.0):**
  - perfil público;
  - upload no painel;
  - reserva;
  - avaliação por link;
  - denúncia;
  - salão suspenso;
  - fluxos sem JavaScript, quando o padrão do projeto exigir.
- **Cobertura:** ≥ 90% de linhas no comando oficial.

### 8.5 Riscos

- **Categoria do modelo na Meta.** A Meta decide, na aprovação, se o modelo `convite_avaliacao` é "utilidade" ou "marketing". Isso muda o custo por mensagem, já registrado como risco no `PLAN.md`.
- **Prova de autoria.** Avaliações por link são verificáveis, mas só comprovam a posse do WhatsApp que recebeu o convite.

## 9. Ordem de execução para o Claude Code

Cada linha é uma demanda própria (`docs/demandas/D-NNN/`), percorrendo analista → arquiteto → (DBA/DevOps) → desenvolvedor → tester. Cada demanda tem uma PR e é mesclada somente com os 6 checks da CI verdes. A ordem respeita as dependências registradas nas issues: E3.2 depende de E7.1, E3.5 depende de E3.4, e E4.2 depende de E4.1.

| Ordem | Demanda | Chave | Issue | Depende de |
|---|---|---|---|---|
| 0 | D-019 | — | este documento, PLAN, issues e Project | — |
| 1 | D-020 | E2.6 Perfil e funcionamento | nova | — |
| 2 | D-021 | E2.7 Fotos | nova | D-020 |
| 3 | D-018 | E3.1 Disponibilidade (revisada) | #27 | D-020 |
| 4 | D-022 | E5.1 Clientes | #29 | — |
| 5 | D-023 | E4.3 Termos e consentimento por finalidade | #33 | — |
| 6 | D-024 | E7.1 Fila e envio (4 tipos) | #31 | — |
| 7 | D-025 | E3.2 Criar reserva | #34 | D-018, D-022, D-023, D-024 |
| 8 | D-026 | E4.1 Página pública e reserva | #37 | D-021, D-025 |
| 9 | D-027 | E4.2 Proteção | #38 | D-026 |
| 10 | D-028 | E3.3 Agenda da equipe | #20 | D-020 |
| 11 | D-029 | E3.4 Reserva manual e encaixe | #35 | D-025 |
| 12 | D-030 | E3.5 Remarcar, cancelar, status | #36 | D-028, D-029 |
| 13 | D-031 | E5.2 Anonimização | #45 | D-022, D-024 |
| 14 | D-032 | E4.5 Avaliações verificadas | nova | D-026, D-030, D-031 |
| 15 | D-033 | E8.1 Auditoria | #23 | — |
| 16 | D-034 | E1.5 Super admin + TOTP | #24 | D-033 |
| 17 | D-035 | E8.4 Denúncias e moderação | nova | D-032, D-034, D-027 |
| 18 | D-036 | E9.2 + E9.1 + E4.4 Seed, página inicial e E2E | #43, #54, #44 | D-035 |

Até a E6.4, o estado "salão aceita reserva pública" vem de um predicado único de leitura (`suspenso_manual_em` e o estado da assinatura). Nesse período, as fábricas de teste e a seed criam a assinatura em `em_teste`. A E6.4 (#41) depois substitui `permitirTudo` em `src/server/tenant/politica.ts` pela política completa.

Se uma demanda da cadeia revelar outra dependência fora da lista, o líder a acrescenta aqui, registra o motivo e atualiza o Project.
