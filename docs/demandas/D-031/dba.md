# D-031 (E5.2) — Parecer do DBA (T-1)

**Conclusão: sem migração.** Nenhum arquivo em `prisma/` foi criado ou alterado.

## 1. Impacto e compatibilidade
Só `UPDATE` de dados em linhas da própria cliente; sem DDL, sem lock de tabela, sem reescrita. Dados existentes inalterados em reservas, itens e consentimentos.

## 2. Verificação (PostgreSQL 17 local, banco descartável, apagado ao final)
Migrações todas aplicadas num banco limpo (zero falhas). Carga: 2 salões, 125 mil `reserva`, 130 mil `mensagem`, 130 mil `mensagem_tentativa`; a cliente-alvo tem 5.000 reservas e 10.000 mensagens (confirmação + cancelamento), cada uma com 1 tentativa com `erro_detalhe`. `ANALYZE` feito.

- UPDATE 1 (`mensagem` FROM `reserva`), 10.000 linhas: **130 ms** (rollback). `reserva` por `reserva_salao_id_cliente_id_inicio_idx` (Bitmap Index Scan, 5.000 linhas, 0,3 ms); `mensagem` por **Seq Scan** filtrando `salao_id` (70 mil do salão, 11 ms) + Hash Join. O planner escolhe seq scan porque as 5.000 reservas são ~7% da tabela; custo aceitável.
- UPDATE 2 (`mensagem_tentativa`), 10.000 linhas: **113 ms**; tentativas por `mensagem_tentativa_mensagem_id_numero_key` (Index Scan, 10.000 loops). Sem índice novo.
- Cliente com 300 reservas: Nested Loop com `reserva_salao_id_cliente_id_inicio_idx` + `mensagem_reserva_id_tipo_revisao_key`, **7,6 ms**. Para o caso comum o plano é por índice.
- Índice novo em `mensagem(reserva_id)` não é necessário: `mensagem_reserva_id_tipo_revisao_key` já o cobre (prefixo `reserva_id`), e `mensagem_salao_id_reserva_id_idx` também existe. Sem otimização prematura: o pior caso medido (5 mil reservas) fica em ~0,25 s no total.

## 3. Locks
Linhas atualizadas ficam travadas (row-level) até o commit; nenhuma trava de tabela. Ordem `salao` (FOR NO KEY UPDATE) → cliente `FOR UPDATE` → `mensagem` → `mensagem_tentativa`, igual à de `concluirEnvio` (mensagem → tentativa): sem inversão. `reconciliar-mensagens` usa `SKIP LOCKED`. As ~0,25 s de linhas travadas só bloqueiam T2 de envio das mensagens desta cliente (espera curta, sem impasse). Os UPDATEs não tocam `reserva`, logo a exclusion constraint não participa.

## 4. CHECK e UNIQUE com telefone nulo
Testado: `cliente_anonimizacao_chk` aceita `nome NULL, telefone_e164 NULL, anonimizada_em NOT NULL` e rejeita (23514) anular só nome ou só telefone, ou anonimizada_em sem anular ambos. `UNIQUE (salao_id, telefone_e164)` é `NULLS DISTINCT`: duas anonimizadas no mesmo salão coexistem (2 linhas com telefone nulo no teste); o telefone liberado pode ser reutilizado por nova cliente. O dev deve anular os três campos no MESMO UPDATE. `mensagem.destinatario_e164` nulo e estado `cancelada_anonimizacao` são aceitos (nenhum CHECK além de `mensagem_revisao_chk >= 0` e do formato do destinatário, que admite nulo).

## 5. Reversão
Não se aplica (sem migração). A anonimização é irreversível por desenho (CHECK exige o par de nulos).

## 6. Testes sugeridos
Integração: após anonimizar, `SELECT` por telefone (com e sem +55) em `cliente`, `mensagem.destinatario_e164/parametros` e `mensagem_tentativa.erro_detalhe` retorna 0 linhas; contagem de `reserva`/`reserva_item` inalterada; duas anonimizadas no mesmo salão; reanonimizar não escreve; outro salão intacto (mesmo cliente_id de outro salão = `NaoEncontrado`).

## 7. Orientação ao desenvolvedor
Manter `salao_id` em ambos os UPDATEs (usa o índice composto). Não capturar 23514/23505 aqui: o serviço já trava e valida. Não criar índice.
