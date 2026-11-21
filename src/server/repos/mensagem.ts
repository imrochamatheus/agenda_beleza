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
// - substituirPendentes: só depois do INSERT criado; seleciona por id (ORDER BY id) FOR UPDATE e então
//   atualiza, para que registros concorrentes percorram as mesmas linhas na mesma ordem.
// - reenviar: a linha de `mensagem` FOR UPDATE primeiro; reserva e cliente são lidas sem trava.
// `atualizado_em` é gravado explicitamente em toda transição (o @updatedAt do Prisma não vale em SQL
// bruto) com o relógio do chamador. As consultas escrevem 'pendente'/'enviando' como LITERAIS (nunca
// parâmetro) para o índice parcial mensagem_reconciliacao_idx valer (D-024 dba.md).

type LinhaMensagem = {
  id: string;
  reserva_id: string;
  tipo: TipoMensagemDTO;
  revisao: number;
  estado: EstadoMensagemDTO;
  erro_codigo: string | null;
};

const paraLinha = (l: LinhaMensagem): MensagemLinhaDTO => ({
  id: l.id,
  reservaId: l.reserva_id,
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
  /** INSERT … ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING RETURNING; se vazio, SELECT da existente. */
  inserir(
    ctx: ContextoEscopado,
    d: NovaMensagem,
    agora: Date,
  ): Promise<{ criada: boolean; mensagem: MensagemLinhaDTO }>;
  /** `pendente` da reserva dos `tipos` (e com revisão < `revisaoMenorQue`, se informada) → `substituida`. */
  substituirPendentes(
    ctx: ContextoEscopado,
    d: { reservaId: string; tipos: TipoMensagemDTO[]; revisaoMenorQue: number | null },
    agora: Date,
  ): Promise<number>;
  /**
   * Reenvio (RN-18): linha FOR UPDATE do salão; só `falhou` e vigente volta a `pendente`. Cliente
   * anonimizada → a linha vira `cancelada_anonimizacao`. Não enfileira (é do serviço, pós-commit).
   */
  reenviar(
    ctx: ContextoEscopado,
    mensagemId: string,
    agora: Date,
    conferir: ConferirVigenciaFn,
  ): Promise<ResultadoReenvioRepo>;
  /** Por `criado_em`; nunca lê destinatário, parâmetros nem provedor (RN-23). Reserva de outro salão → NaoEncontrado. */
  listarDaReserva(ctx: ContextoEscopado, reservaId: string): Promise<MensagemDaReservaRepoDTO[]>;
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
      if (!ehUuid(d.reservaId)) {
        throw new NaoEncontrado();
      }
      const criadas = await db.$queryRaw<LinhaMensagem[]>`
        INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, erro_codigo, destinatario_e164, criado_em, atualizado_em)
        VALUES (${salaoId}::uuid, ${d.reservaId}::uuid, ${d.tipo}::tipo_mensagem, ${d.revisao}::int,
                ${d.estado}::estado_mensagem, ${d.erroCodigo}::text, ${d.destinatarioE164}::text,
                ${agora}::timestamptz, ${agora}::timestamptz)
        ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING
        RETURNING id::text AS id, reserva_id::text AS reserva_id, tipo::text AS tipo, revisao,
                  estado::text AS estado, erro_codigo`;
      if (criadas.length > 0) {
        return { criada: true, mensagem: paraLinha(criadas[0]) };
      }
      const existentes = await db.$queryRaw<LinhaMensagem[]>`
        SELECT id::text AS id, reserva_id::text AS reserva_id, tipo::text AS tipo, revisao,
               estado::text AS estado, erro_codigo
          FROM mensagem
         WHERE reserva_id = ${d.reservaId}::uuid AND tipo = ${d.tipo}::tipo_mensagem
           AND revisao = ${d.revisao}::int AND salao_id = ${salaoId}::uuid`;
      if (existentes.length === 0) {
        // A chave pertence a outro salão: nada é revelado.
        throw new NaoEncontrado();
      }
      return { criada: false, mensagem: paraLinha(existentes[0]) };
    },

    async substituirPendentes(ctx, d, agora) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(d.reservaId)) {
        throw new NaoEncontrado();
      }
      if (d.tipos.length === 0) {
        return 0;
      }
      const atualizadas = await db.$queryRaw<{ id: string }[]>`
        WITH alvo AS (
          SELECT id FROM mensagem
           WHERE salao_id = ${salaoId}::uuid AND reserva_id = ${d.reservaId}::uuid
             AND estado = 'pendente' AND tipo = ANY(${d.tipos}::tipo_mensagem[])
             AND (${d.revisaoMenorQue}::int IS NULL OR revisao < ${d.revisaoMenorQue}::int)
           ORDER BY id
           FOR UPDATE
        )
        UPDATE mensagem m
           SET estado = 'substituida', erro_codigo = 'substituida', destinatario_e164 = NULL,
               parametros = NULL, atualizado_em = ${agora}::timestamptz
          FROM alvo
         WHERE m.id = alvo.id
        RETURNING m.id::text AS id`;
      return atualizadas.length;
    },

    async reenviar(ctx, mensagemId, agora, conferir) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(mensagemId)) {
        throw new NaoEncontrado();
      }
      const travadas = await db.$queryRaw<LinhaMensagem[]>`
        SELECT id::text AS id, reserva_id::text AS reserva_id, tipo::text AS tipo, revisao,
               estado::text AS estado, erro_codigo
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
      const [r] = await db.$queryRaw<{ revisao: number; status: StatusReserva; anonimizada_em: Date | null; telefone_e164: string | null }[]>`
        SELECT r.revisao, r.status::text AS status, c.anonimizada_em, c.telefone_e164
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
      if (conferir(m.tipo, { revisao: m.revisao }, { revisao: r.revisao, status: r.status }) === 'obsoleta') {
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
          tipo: TipoMensagemDTO;
          revisao: number;
          estado: EstadoMensagemDTO;
          enviada_em: Date | null;
          erro_codigo: string | null;
          tentativas: number;
          ultima_tentativa_em: Date | null;
        }[]
      >`
        SELECT m.id::text AS id, m.tipo::text AS tipo, m.revisao, m.estado::text AS estado,
               m.enviada_em, m.erro_codigo,
               (SELECT count(*)::int FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS tentativas,
               (SELECT max(t.iniciada_em) FROM mensagem_tentativa t WHERE t.mensagem_id = m.id) AS ultima_tentativa_em
          FROM mensagem m
         WHERE m.salao_id = ${salaoId}::uuid AND m.reserva_id = ${reservaId}::uuid
         ORDER BY m.criado_em, m.id`;
      return linhas.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        revisao: l.revisao,
        estado: l.estado,
        enviadaEm: l.enviada_em,
        erroCodigo: l.erro_codigo,
        tentativas: l.tentativas,
        ultimaTentativaEm: l.ultima_tentativa_em,
      }));
    },
  };
}
