import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import type { SimMpOperacao } from '@/generated/prisma/enums';

import { obterPrisma } from './db';
import { ehUuid } from './ids';

// Repositório de PLATAFORMA do Mercado Pago simulado (D-007 §3.10; contrato e SQL aprovados em
// docs/demandas/D-007/dba.md §3 e §4). As tabelas sim_mp_* não pertencem a um salão: sem
// ContextoEscopado (exceção documentada, como sessao.ts). Recebe só um CLIENTE, nunca a transação
// do chamador: o simulado grava fora dela, como um provedor real (RN-15). Sem cliente, usa
// `obterPrisma()` resolvido em cada chamada.
// - Um ID que não é UUID é tratado como inexistente ANTES do SQL (senão o cast daria 22P02).
// - Todo UPDATE bruto grava `atualizado_em = now()` (o @updatedAt só vale pelo cliente tipado).
// - Um 23514 de CHECK sim_* é bug de implementação e propaga sem tradução (dba.md §8, item 4).

export type EstadoSimAssinatura = 'pendente' | 'autorizada' | 'cancelada';
export type StatusSimPagamento = 'aprovado' | 'recusado';

export type LinhaAssinatura = {
  id: string;
  referenciaExterna: string;
  emailPagador: string;
  urlRetorno: string;
  estado: EstadoSimAssinatura;
  valorCentavos: number;
  autorizadaEm: Date | null;
  proximaCobrancaEm: Date | null;
  canceladaEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

export type LinhaPagamento = {
  id: string;
  assinaturaId: string;
  status: StatusSimPagamento;
  valorCentavos: number;
  /** Instante do disparo; a porta o expõe como `ocorridoEm` (A-1). */
  cobradoEm: Date;
  criadoEm: Date;
};

export type LinhaAdiamento = {
  id: string;
  assinaturaId: string;
  dataAnterior: Date | null;
  novaData: Date;
  criadoEm: Date;
};

export type NovaAssinatura = {
  referenciaExterna: string;
  emailPagador: string;
  urlRetorno: string;
  valorCentavos: number;
};

export interface RepoSimMercadoPago {
  criarAssinatura(e: NovaAssinatura): Promise<LinhaAssinatura>;
  buscarAssinatura(id: string): Promise<LinhaAssinatura | null>;
  /** `pendente → autorizada`, gravando `autorizada_em` e `proxima_cobranca_em` juntos. */
  autorizar(id: string, em: Date, proximaCobrancaEm: Date): Promise<'ok' | 'nao_encontrada' | 'estado_invalido'>;
  /**
   * Só em `autorizada`, numa transação com a assinatura travada: insere o pagamento e, se
   * `avancarProxima` for informado, grava `proxima_cobranca_em = avancarProxima(<valor lido sob trava>)`.
   */
  registrarCobranca(
    id: string,
    status: StatusSimPagamento,
    valorCentavos: number,
    em: Date,
    avancarProxima?: (proximaLida: Date) => Date,
  ): Promise<{ pagamentoId: string } | 'nao_encontrada' | 'estado_invalido'>;
  /** `pendente|autorizada → cancelada`. */
  cancelar(id: string, em: Date): Promise<'ok' | 'ja_cancelada' | 'nao_encontrada'>;
  /** Só em `autorizada` e com `novaData > agora`; grava o adiamento e a nova data numa transação. */
  adiar(id: string, novaData: Date, agora: Date): Promise<'ok' | 'nao_encontrada' | 'estado_invalido' | 'data_invalida'>;
  buscarPagamento(id: string): Promise<LinhaPagamento | null>;
  /** Do mais antigo ao mais recente. */
  listarAdiamentos(assinaturaId: string): Promise<LinhaAdiamento[]>;
  forcarErro(operacao: SimMpOperacao): Promise<void>;
  /** Consome atomicamente (SKIP LOCKED) o erro forçado mais antigo da operação; true se havia um. */
  consumirErroForcado(operacao: SimMpOperacao): Promise<boolean>;
}

const CAMPOS_ASSINATURA = {
  id: true,
  referenciaExterna: true,
  emailPagador: true,
  urlRetorno: true,
  estado: true,
  valorCentavos: true,
  autorizadaEm: true,
  proximaCobrancaEm: true,
  canceladaEm: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

const CAMPOS_PAGAMENTO = {
  id: true,
  assinaturaId: true,
  status: true,
  valorCentavos: true,
  cobradoEm: true,
  criadoEm: true,
} as const;

const NIVEL = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

type Travada = { estado: EstadoSimAssinatura; proxima_cobranca_em: Date | null };

/** `SELECT … FOR UPDATE` da assinatura (a única trava de linha das transações do MP: sem deadlock). */
async function travar(tx: Prisma.TransactionClient, id: string): Promise<Travada | null> {
  const linhas = await tx.$queryRaw<Travada[]>`
    SELECT estado::text AS estado, proxima_cobranca_em
    FROM sim_mp_assinatura WHERE id = ${id}::uuid FOR UPDATE`;
  return linhas[0] ?? null;
}

export function repoSimMercadoPago(db?: PrismaClient): RepoSimMercadoPago {
  const cliente = () => db ?? obterPrisma();

  async function lerEstado(id: string): Promise<EstadoSimAssinatura | null> {
    const linhas = await cliente().$queryRaw<{ estado: EstadoSimAssinatura }[]>`
      SELECT estado::text AS estado FROM sim_mp_assinatura WHERE id = ${id}::uuid`;
    return linhas[0]?.estado ?? null;
  }

  return {
    async criarAssinatura(e) {
      return cliente().simMpAssinatura.create({
        data: {
          referenciaExterna: e.referenciaExterna,
          emailPagador: e.emailPagador,
          urlRetorno: e.urlRetorno,
          valorCentavos: e.valorCentavos,
        },
        select: CAMPOS_ASSINATURA,
      });
    },

    async buscarAssinatura(id) {
      if (!ehUuid(id)) return null;
      return cliente().simMpAssinatura.findUnique({ where: { id }, select: CAMPOS_ASSINATURA });
    },

    async autorizar(id, em, proximaCobrancaEm) {
      if (!ehUuid(id)) return 'nao_encontrada';
      const n = await cliente().$executeRaw`
        UPDATE sim_mp_assinatura
        SET estado = 'autorizada', autorizada_em = ${em}::timestamptz,
            proxima_cobranca_em = ${proximaCobrancaEm}::timestamptz, atualizado_em = now()
        WHERE id = ${id}::uuid AND estado = 'pendente'`;
      if (n === 1) return 'ok';
      return (await lerEstado(id)) === null ? 'nao_encontrada' : 'estado_invalido';
    },

    async registrarCobranca(id, status, valorCentavos, em, avancarProxima) {
      if (!ehUuid(id)) return 'nao_encontrada';
      return cliente().$transaction(async (tx) => {
        const lida = await travar(tx, id);
        if (!lida) return 'nao_encontrada' as const;
        if (lida.estado !== 'autorizada') return 'estado_invalido' as const;
        const [pagamento] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO sim_mp_pagamento (assinatura_id, status, valor_centavos, cobrado_em)
          VALUES (${id}::uuid, ${status}::sim_mp_status_pagamento, ${valorCentavos}::int, ${em}::timestamptz)
          RETURNING id::text AS id`;
        if (avancarProxima) {
          // `autorizada` ⇒ proxima_cobranca_em preenchida (CHECK sim_mp_assinatura_estado_chk).
          const nova = avancarProxima(lida.proxima_cobranca_em as Date);
          await tx.$executeRaw`
            UPDATE sim_mp_assinatura
            SET proxima_cobranca_em = ${nova}::timestamptz, atualizado_em = now()
            WHERE id = ${id}::uuid`;
        }
        return { pagamentoId: pagamento.id };
      }, NIVEL);
    },

    async cancelar(id, em) {
      if (!ehUuid(id)) return 'nao_encontrada';
      const n = await cliente().$executeRaw`
        UPDATE sim_mp_assinatura
        SET estado = 'cancelada', cancelada_em = ${em}::timestamptz, atualizado_em = now()
        WHERE id = ${id}::uuid AND estado IN ('pendente', 'autorizada')`;
      if (n === 1) return 'ok';
      return (await lerEstado(id)) === null ? 'nao_encontrada' : 'ja_cancelada';
    },

    async adiar(id, novaData, agora) {
      if (!ehUuid(id)) return 'nao_encontrada';
      return cliente().$transaction(async (tx) => {
        const lida = await travar(tx, id);
        if (!lida) return 'nao_encontrada' as const;
        if (lida.estado !== 'autorizada') return 'estado_invalido' as const;
        // NaN (data inválida) também cai aqui: a comparação `>` com NaN é falsa.
        if (!(novaData.getTime() > agora.getTime())) return 'data_invalida' as const;
        await tx.$executeRaw`
          INSERT INTO sim_mp_adiamento (assinatura_id, data_anterior, nova_data)
          VALUES (${id}::uuid, ${lida.proxima_cobranca_em}::timestamptz, ${novaData}::timestamptz)`;
        await tx.$executeRaw`
          UPDATE sim_mp_assinatura
          SET proxima_cobranca_em = ${novaData}::timestamptz, atualizado_em = now()
          WHERE id = ${id}::uuid`;
        return 'ok' as const;
      }, NIVEL);
    },

    async buscarPagamento(id) {
      if (!ehUuid(id)) return null;
      return cliente().simMpPagamento.findUnique({ where: { id }, select: CAMPOS_PAGAMENTO });
    },

    async listarAdiamentos(assinaturaId) {
      if (!ehUuid(assinaturaId)) return [];
      return cliente().simMpAdiamento.findMany({
        where: { assinaturaId },
        select: { id: true, assinaturaId: true, dataAnterior: true, novaData: true, criadoEm: true },
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      });
    },

    async forcarErro(operacao) {
      await cliente().simMpErroForcado.create({ data: { operacao }, select: { id: true } });
    },

    async consumirErroForcado(operacao) {
      const linhas = await cliente().$queryRaw<{ id: string }[]>`
        DELETE FROM sim_mp_erro_forcado
        WHERE id = (SELECT id FROM sim_mp_erro_forcado
                    WHERE operacao = ${operacao}::sim_mp_operacao
                    ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text AS id`;
      return linhas.length > 0;
    },
  };
}
