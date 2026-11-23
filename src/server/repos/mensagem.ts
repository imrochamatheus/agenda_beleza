import { Prisma } from '@/generated/prisma/client';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type {
  ConferirVigenciaFn,
  ContextoDeRegistroDTO,
  EstadoMensagemDTO,
  MensagemDaReservaRepoDTO,
  MensagemLinhaDTO,
  NovaMensagem,
  ResultadoReenvioRepo,
  StatusReserva,
  TipoMensagemDTO,
} from './tipos';
import type { Executor } from './transacao';

// Repositório de mensagens de WhatsApp do salão (D-024 §3.4). Toda operação filtra `salao_id`; id que
// não é UUID → NaoEncontrado sem consultar. Roda no executor do chamador (a transação do evento).
//
// Posição na ordem canônica de travas (ver repos/servico.ts): `mensagem` é SEMPRE a última.
// - contextoDeRegistro: SELECT … FOR KEY SHARE OF c (só a cliente; a reserva é lida sem trava).
// - inserir: INSERT … ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING (nunca 23505).
// - substituirNaoVigentes (D-050): UM comando; seleciona as `pendente` da reserva cujo PREDICADO_VIGENTE é
//   falso por id (ORDER BY id) FOR UPDATE OF m e então atualiza, para que chamadas concorrentes percorram
//   as mesmas linhas na mesma ordem. Quem chama já travou a reserva (FOR UPDATE) e gravou os itens.
// - reenviar: a linha de `mensagem` FOR UPDATE primeiro; reserva e cliente são lidas sem trava.
// `atualizado_em` é gravado explicitamente em toda transição (o @updatedAt do Prisma não vale em SQL
// bruto) com o relógio do chamador. As consultas escrevem 'pendente'/'enviando' como LITERAIS (nunca
// parâmetro) para o índice parcial mensagem_reconciliacao_idx valer (D-024 dba.md).

/**
 * Vigência em SQL (D-050 §3.7; dba.md M-4), aliases FIXOS `m` (mensagem) e `r` (reserva). Fonte ÚNICA:
 * `substituirNaoVigentes` e o EXISTS da falha da agenda (repos/agenda.ts, D-043) importam este fragmento,
 * nunca o copiam. Paridade com `conferirVigencia` (src/server/mensagens/elegibilidade.ts) provada em
 * tests/integration/mensagens/vigencia.test.ts. Tipos, estados e status são LITERAIS (nunca parâmetros);
 * não usa `reserva_item_id`: olha só `revisao`/`status` dos itens; `confirmacao` não compara revisão.
 */
export const PREDICADO_VIGENTE: Prisma.Sql = Prisma.sql`((m.tipo = 'confirmacao' AND r.status = 'confirmado')
   OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido')
   OR (m.tipo = 'remarcacao' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'confirmado'))
   OR (m.tipo = 'cancelamento' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'cancelado')))`;

type LinhaMensagem = {
  id: string;
  reserva_id: string;
  reserva_item_id: string | null;
  tipo: TipoMensagemDTO;
  revisao: number;
  estado: EstadoMensagemDTO;
  erro_codigo: string | null;
};

const paraLinha = (l: LinhaMensagem): MensagemLinhaDTO => ({
  id: l.id,
  reservaId: l.reserva_id,
  reservaItemId: l.reserva_item_id,
  tipo: l.tipo,
  revisao: l.revisao,
  estado: l.estado,
  erroCodigo: l.erro_codigo,
});

export interface RepoMensagem {
  /**
   * Anonimização da cliente (D-031), na transação que já travou salão e cliente: em 2 comandos, nesta
   * ordem (mensagem → tentativa), limpa destinatário e parâmetros de TODAS as mensagens das reservas da
   * cliente e o `erro_detalhe` das tentativas; `pendente`/`falhou` viram `cancelada_anonimizacao`
   * (`enviando` mantém o estado: o T2 fecha o resultado). Não toca `erro_codigo` nem o id do provedor.
   */
  anonimizarDaCliente(
    ctx: ContextoEscopado,
    clienteId: string,
    agora: Date,
  ): Promise<{ canceladas: number; limpas: number }>;
  /**
   * Cliente FOR KEY SHARE OF c + consentimentos por finalidade + reserva (sem trava), num comando.
   * NaoEncontrado se a reserva não for do salão ou o id não for UUID.
   */
  contextoDeRegistro(ctx: ContextoEscopado, reservaId: string): Promise<ContextoDeRegistroDTO>;
  /**
   * INSERT … ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING RETURNING; se vazio, SELECT da existente.
   * `reservaItemId` (D-050): item da MESMA reserva (FK composta); id que não é UUID → NaoEncontrado.
   */
  inserir(
    ctx: ContextoEscopado,
    d: NovaMensagem,
    agora: Date,
  ): Promise<{ criada: boolean; mensagem: MensagemLinhaDTO }>;
  /**
   * D-050 RN-31: UM comando; as `pendente` da reserva cujo `PREDICADO_VIGENTE` é falso → `substituida`
   * (`erro_codigo = 'substituida'`, destinatário e parâmetros anulados). Devolve quantas. Chamado pela
   * operação DEPOIS de gravar itens, derivados e a mensagem nova, na mesma transação.
   */
  substituirNaoVigentes(ctx: ContextoEscopado, reservaId: string, agora: Date): Promise<number>;
  /**
   * Reenvio (RN-18): linha FOR UPDATE do salão; só `falhou` e vigente volta a `pendente`. Cliente
   * anonimizada → a linha vira `cancelada_anonimizacao`. Não enfileira (é do serviço, pós-commit).
   * D-050: `conferir` recebe o status derivado e os itens (revisão/status), lidos sem trava num comando.
   */
  reenviar(
    ctx: ContextoEscopado,
    mensagemId: string,
    agora: Date,
    conferir: ConferirVigenciaFn,
  ): Promise<ResultadoReenvioRepo>;
  /** Por `criado_em`; nunca lê destinatário, parâmetros nem provedor (RN-23). Reserva de outro salão → NaoEncontrado. */
  listarDaReserva(ctx: ContextoEscopado, reservaId: string): Promise<MensagemDaReservaRepoDTO[]>;
  /**
   * Mensagens da reserva para a equipe (D-043), em UM comando: `reserva LEFT JOIN mensagem` valida salão e,
   * se `profissionalId` vier, que ele tem item na reserva (D-050 RN-37) e filtra as mensagens às sem item e
   * às dos itens dele. Reserva inexistente, malformada, de outro salão ou sem item do profissional →
   * NaoEncontrado (igual em todos os casos). Sem trava; sem destinatário, parâmetros,
   * id do provedor nem `erro_detalhe`.
   */
  listarDaReservaDaEquipe(
    ctx: ContextoEscopado,
    reservaId: string,
    profissionalId: string | null,
  ): Promise<MensagemDaReservaRepoDTO[]>;
}

export function criarRepoMensagem(db: Executor): RepoMensagem {
  return {
    async anonimizarDaCliente(ctx, clienteId, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(clienteId)) {
        throw new NaoEncontrado();
      }
      const [n] = await db.$queryRaw<{ canceladas: number; limpas: number }[]>`
        WITH alvo AS (
          SELECT m.id, m.estado::text AS antes
            FROM mensagem m
            JOIN reserva r ON r.id = m.reserva_id
           WHERE m.salao_id = ${salaoId}::uuid AND r.salao_id = ${salaoId}::uuid
             AND r.cliente_id = ${clienteId}::uuid
             AND (m.estado IN ('pendente', 'falhou') OR m.destinatario_e164 IS NOT NULL OR m.parametros IS NOT NULL)
           ORDER BY m.id
             FOR UPDATE OF m
        ), u AS (
          UPDATE mensagem m
             SET estado = CASE WHEN alvo.antes IN ('pendente', 'falhou')
                               THEN 'cancelada_anonimizacao'::estado_mensagem ELSE m.estado END,
                 destinatario_e164 = NULL, parametros = NULL, atualizado_em = ${agora}::timestamptz
            FROM alvo
           WHERE m.id = alvo.id
          RETURNING alvo.antes
        )
        SELECT count(*) FILTER (WHERE antes IN ('pendente', 'falhou'))::int AS canceladas, count(*)::int AS limpas FROM u`;
      await db.$executeRaw`
        UPDATE mensagem_tentativa t
           SET erro_detalhe = NULL
          FROM mensagem m
          JOIN reserva r ON r.id = m.reserva_id
         WHERE t.mensagem_id = m.id AND m.salao_id = ${salaoId}::uuid AND r.salao_id = ${salaoId}::uuid
           AND r.cliente_id = ${clienteId}::uuid AND t.erro_detalhe IS NOT NULL`;
      return { canceladas: n.canceladas, limpas: n.limpas };
    },

    async contextoDeRegistro(ctx, reservaId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) {
        throw new NaoEncontrado();
      }
      const linhas = await db.$queryRaw<
        {
          revisao: number;
          status: StatusReserva;
          anonimizada_em: Date | null;
          telefone_e164: string | null;
          consentimento_mensagens: boolean;
          consentimento_convite: boolean;
        }[]
      >`
        SELECT r.revisao, r.status::text AS status, c.anonimizada_em, c.telefone_e164,
               COALESCE(k.mensagens, false) AS consentimento_mensagens,
               COALESCE(k.convite, false) AS consentimento_convite
          FROM reserva r
          JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
          LEFT JOIN LATERAL (
            SELECT bool_or(k.finalidade = 'mensagens_reserva') AS mensagens,
                   bool_or(k.finalidade = 'convite_avaliacao') AS convite
              FROM consentimento k
             WHERE k.salao_id = c.salao_id AND k.cliente_id = c.id
          ) k ON true
         WHERE r.id = ${reservaId}::uuid AND r.salao_id = ${salaoId}::uuid
           FOR KEY SHARE OF c`;
      if (linhas.length === 0) {
        throw new NaoEncontrado();
      }
      const l = linhas[0];
      return {
        reservaRevisao: l.revisao,
        reservaStatus: l.status,
        clienteAnonimizada: l.anonimizada_em !== null,
        telefone: l.telefone_e164,
        consentimentoMensagens: l.consentimento_mensagens,
        consentimentoConvite: l.consentimento_convite,
      };
    },

    async inserir(ctx, d, agora) {
      const salaoId = exigirEscopo(ctx);
      const reservaItemId = d.reservaItemId ?? null;
      if (!ehUuid(d.reservaId) || (reservaItemId !== null && !ehUuid(reservaItemId))) {
        throw new NaoEncontrado();
      }
      const criadas = await db.$queryRaw<LinhaMensagem[]>`
        INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao, estado, erro_codigo, destinatario_e164,
                              criado_em, atualizado_em)
        VALUES (${salaoId}::uuid, ${d.reservaId}::uuid, ${reservaItemId}::uuid, ${d.tipo}::tipo_mensagem, ${d.revisao}::int,
                ${d.estado}::estado_mensagem, ${d.erroCodigo}::text, ${d.destinatarioE164}::text,
                ${agora}::timestamptz, ${agora}::timestamptz)
        ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING
        RETURNING id::text AS id, reserva_id::text AS reserva_id, reserva_item_id::text AS reserva_item_id,
                  tipo::text AS tipo, revisao, estado::text AS estado, erro_codigo`;
      if (criadas.length > 0) {
        return { criada: true, mensagem: paraLinha(criadas[0]) };
      }
      const existentes = await db.$queryRaw<LinhaMensagem[]>`
        SELECT id::text AS id, reserva_id::text AS reserva_id, reserva_item_id::text AS reserva_item_id,
               tipo::text AS tipo, revisao, estado::text AS estado, erro_codigo
          FROM mensagem
         WHERE reserva_id = ${d.reservaId}::uuid AND tipo = ${d.tipo}::tipo_mensagem
           AND revisao = ${d.revisao}::int AND salao_id = ${salaoId}::uuid`;
      if (existentes.length === 0) {
        // A chave pertence a outro salão: nada é revelado.
        throw new NaoEncontrado();
      }
      return { criada: false, mensagem: paraLinha(existentes[0]) };
    },

    async substituirNaoVigentes(ctx, reservaId, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) {
        throw new NaoEncontrado();
      }
      return db.$executeRaw(Prisma.sql`
        WITH alvo AS (
          SELECT m.id
            FROM mensagem m
            JOIN reserva r ON r.salao_id = m.salao_id AND r.id = m.reserva_id
           WHERE m.salao_id = ${salaoId}::uuid AND m.reserva_id = ${reservaId}::uuid
             AND m.estado = 'pendente'
             AND NOT ${PREDICADO_VIGENTE}
           ORDER BY m.id
             FOR UPDATE OF m
        )
        UPDATE mensagem m
           SET estado = 'substituida', erro_codigo = 'substituida', destinatario_e164 = NULL,
               parametros = NULL, atualizado_em = ${agora}::timestamptz
          FROM alvo
         WHERE m.id = alvo.id`);
    },

    async reenviar(ctx, mensagemId, agora, conferir) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(mensagemId)) {
        throw new NaoEncontrado();
      }
      const travadas = await db.$queryRaw<LinhaMensagem[]>`
        SELECT id::text AS id, reserva_id::text AS reserva_id, reserva_item_id::text AS reserva_item_id,
               tipo::text AS tipo, revisao, estado::text AS estado, erro_codigo
          FROM mensagem
         WHERE id = ${mensagemId}::uuid AND salao_id = ${salaoId}::uuid
           FOR UPDATE`;
      if (travadas.length === 0) {
        throw new NaoEncontrado();
      }
      const m = travadas[0];
      if (m.estado !== 'falhou') {
        return { resultado: 'recusada', motivo: 'nao_falhou' };
      }
      const [r] = await db.$queryRaw<
        {
          status: StatusReserva;
          anonimizada_em: Date | null;
          telefone_e164: string | null;
          itens: { revisao: number; status: StatusReserva }[];
        }[]
      >`
        SELECT r.status::text AS status, c.anonimizada_em, c.telefone_e164,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('revisao', i.revisao, 'status', i.status::text) ORDER BY i.inicio, i.id)
                   FROM reserva_item i
                  WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
               ), '[]'::jsonb) AS itens
          FROM reserva r
          JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
         WHERE r.id = ${m.reserva_id}::uuid AND r.salao_id = ${salaoId}::uuid`;
      if (r.anonimizada_em !== null || r.telefone_e164 === null) {
        await db.$executeRaw`
          UPDATE mensagem
             SET estado = 'cancelada_anonimizacao', erro_codigo = NULL, destinatario_e164 = NULL,
                 parametros = NULL, atualizado_em = ${agora}::timestamptz
           WHERE id = ${m.id}::uuid AND salao_id = ${salaoId}::uuid`;
        return { resultado: 'recusada', motivo: 'cliente_anonimizada' };
      }
      if (conferir(m.tipo, { revisao: m.revisao }, { status: r.status, itens: r.itens }) === 'obsoleta') {
        return { resultado: 'recusada', motivo: 'obsoleta' };
      }
      await db.$executeRaw`
        UPDATE mensagem
           SET estado = 'pendente', erro_codigo = NULL, atualizado_em = ${agora}::timestamptz
         WHERE id = ${m.id}::uuid AND salao_id = ${salaoId}::uuid`;
      return { resultado: 'reenfileirada', mensagemId: m.id, reservaId: m.reserva_id, tipo: m.tipo, revisao: m.revisao };
    },

    async listarDaReserva(ctx, reservaId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId)) {
        throw new NaoEncontrado();
      }
      const reserva = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM reserva WHERE id = ${reservaId}::uuid AND salao_id = ${salaoId}::uuid`;
      if (reserva.length === 0) {
        throw new NaoEncontrado();
      }
      const linhas = await db.$queryRaw<
        {
          id: string;
          reserva_item_id: string | null;
          tipo: TipoMensagemDTO;
          revisao: number;
          estado: EstadoMensagemDTO;
          enviada_em: Date | null;
          erro_codigo: string | null;
          tentativas: number;
          ultima_tentativa_em: Date | null;
        }[]
      >`
        SELECT m.id::text AS id, m.reserva_item_id::text AS reserva_item_id, m.tipo::text AS tipo, m.revisao,
               m.estado::text AS estado, m.enviada_em, m.erro_codigo,
               (SELECT count(*)::int FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS tentativas,
               (SELECT max(t.iniciada_em) FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS ultima_tentativa_em
          FROM mensagem m
         WHERE m.salao_id = ${salaoId}::uuid AND m.reserva_id = ${reservaId}::uuid
         ORDER BY m.criado_em, m.id`;
      return linhas.map((l) => ({
        id: l.id,
        reservaItemId: l.reserva_item_id,
        tipo: l.tipo,
        revisao: l.revisao,
        estado: l.estado,
        enviadaEm: l.enviada_em,
        erroCodigo: l.erro_codigo,
        tentativas: l.tentativas,
        ultimaTentativaEm: l.ultima_tentativa_em,
      }));
    },

    async listarDaReservaDaEquipe(ctx, reservaId, profissionalId) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(reservaId) || (profissionalId !== null && !ehUuid(profissionalId))) {
        throw new NaoEncontrado();
      }
      // D-050 RN-37: o profissional só "tem" a reserva se tiver item nela (qualquer status) e vê as
      // mensagens sem item e as dos itens que hoje são dele.
      const reservaDoProfissional =
        profissionalId === null
          ? Prisma.empty
          : Prisma.sql`AND EXISTS (SELECT 1 FROM reserva_item pi
                                    WHERE pi.salao_id = r.salao_id AND pi.reserva_id = r.id
                                      AND pi.profissional_id = ${profissionalId}::uuid)`;
      const mensagemDoProfissional =
        profissionalId === null
          ? Prisma.empty
          : Prisma.sql`AND (m.reserva_item_id IS NULL OR EXISTS (
                         SELECT 1 FROM reserva_item mi
                          WHERE mi.salao_id = m.salao_id AND mi.reserva_id = m.reserva_id AND mi.id = m.reserva_item_id
                            AND mi.profissional_id = ${profissionalId}::uuid))`;
      const linhas = await db.$queryRaw<
        {
          id: string | null;
          reserva_item_id: string | null;
          tipo: TipoMensagemDTO | null;
          revisao: number | null;
          estado: EstadoMensagemDTO | null;
          enviada_em: Date | null;
          erro_codigo: string | null;
          tentativas: number | null;
          ultima_tentativa_em: Date | null;
        }[]
      >(Prisma.sql`
        SELECT m.id::text AS id, m.reserva_item_id::text AS reserva_item_id, m.tipo::text AS tipo, m.revisao,
               m.estado::text AS estado, m.enviada_em, m.erro_codigo,
               (SELECT count(*)::int FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS tentativas,
               (SELECT max(t.iniciada_em) FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS ultima_tentativa_em
          FROM reserva r
          LEFT JOIN mensagem m ON m.salao_id = r.salao_id AND m.reserva_id = r.id ${mensagemDoProfissional}
         WHERE r.salao_id = ${salaoId}::uuid AND r.id = ${reservaId}::uuid ${reservaDoProfissional}
         ORDER BY m.criado_em, m.id`);
      if (linhas.length === 0) {
        throw new NaoEncontrado();
      }
      const dtos: MensagemDaReservaRepoDTO[] = [];
      for (const l of linhas) {
        if (l.id === null || l.tipo === null || l.estado === null) continue;
        dtos.push({
          id: l.id,
          reservaItemId: l.reserva_item_id,
          tipo: l.tipo,
          revisao: l.revisao ?? 0,
          estado: l.estado,
          enviadaEm: l.enviada_em,
          erroCodigo: l.erro_codigo,
          tentativas: l.tentativas ?? 0,
          ultimaTentativaEm: l.ultima_tentativa_em,
        });
      }
      return dtos;
    },
  };
}
