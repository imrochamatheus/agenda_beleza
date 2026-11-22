import { NaoEncontrado } from '@/server/tenant/erros';
import { exigirEscopo, exigirLeituraDeAgenda } from '@/server/tenant/context';
import type { ContextoDeLeituraDeAgenda, ContextoEscopado } from '@/server/tenant/context';

import { obterPrisma } from './db';
import { ehUuid } from './ids';
import type { Executor } from './transacao';

// Repositório da assinatura (D-037 §3.1). O salao_id vem só do contexto e entra em todo predicado.
// TRAVA: `SELECT … FROM assinatura … FOR NO KEY UPDATE [SKIP LOCKED]`. Nunca FOR UPDATE: bloquearia o
// FOR KEY SHARE tomado pelos INSERT filhos (assinatura_pagamento, assinatura_transicao). Ordem canônica
// (cabeçalho de repos/servico.ts): salao → assinatura → assinatura_pagamento → assinatura_transicao;
// aplicarEventoAssinatura nunca toma salao nem profissional. Literais de estado na SQL (nunca
// parâmetro), para a varredura do job; todo UPDATE grava `atualizado_em` do relógio injetado.

export type EstadoAssinaturaDTO = 'pendente' | 'em_teste' | 'ativa' | 'em_carencia' | 'suspensa' | 'cancelada' | 'encerrada';

export type AssinaturaTravada = {
  id: string;
  estado: string;
  testeFimEm: Date | null;
  periodoPagoAte: Date | null;
  primeiraFalhaEm: Date | null;
  carenciaAte: Date | null;
  canceladaEm: Date | null;
  acessoAte: Date | null;
};

export type AssinaturaVigente = {
  id: string;
  estado: string;
  provedorAssinaturaId: string | null;
  emailGestor: string | null;
};

export type CamposDoPasso = Partial<Omit<AssinaturaTravada, 'id' | 'estado'>>;

export type EstadoBrutoDaAssinatura = {
  suspensoManualEm: Date | null;
  assinatura: { estado: string; carenciaAte: Date | null; acessoAte: Date | null } | null;
};

export interface RepoAssinatura {
  /**
   * Trava a assinatura alvo. `assinaturaId`: essa (do salão do contexto); sem ele, a vigente
   * (`estado <> 'encerrada'`) e, se `recenteSeNaoHouver`, a mais recente. `null` = não existe;
   * `'ocupada'` = com `pularTravada`, existe mas está travada por outra transação. Só em emTransacao.
   */
  travar(
    ctx: ContextoEscopado,
    o: { assinaturaId?: string; pularTravada?: boolean; recenteSeNaoHouver?: boolean },
  ): Promise<AssinaturaTravada | 'ocupada' | null>;
  /** INSERT … ON CONFLICT (pagamento_id) DO NOTHING; devolve o id da linha criada ou null se já existia. */
  inserirPagamento(
    ctx: ContextoEscopado,
    d: { assinaturaId: string; pagamentoId: string; status: 'aprovado' | 'recusado'; valorCentavos: number },
  ): Promise<string | null>;
  /** UPDATE condicional ao estado de origem; `false` = 0 linhas. */
  aplicarPasso(
    ctx: ContextoEscopado,
    d: { id: string; de: string; para: string; campos: CamposDoPasso; agora: Date },
  ): Promise<boolean>;
  /** Só `periodo_pago_ate` (ativa + aprovada, sem mudança de estado). */
  atualizarPeriodoPago(ctx: ContextoEscopado, d: { id: string; periodoPagoAte: Date; agora: Date }): Promise<void>;
  inserirTransicao(
    ctx: ContextoEscopado,
    d: { assinaturaId: string; de: string; para: string; causa: string; eventoId: string | null; agora: Date },
  ): Promise<void>;
  marcarAplicado(ctx: ContextoEscopado, pagamentoLinhaId: string, agora: Date): Promise<void>;
  /**
   * D-040: cria a `pendente` do salão se não houver vigente (`INSERT … ON CONFLICT … DO NOTHING`, nunca
   * captura 23505). Devolve se criou. Sem linha em `assinatura_transicao` (estado inicial não é transição).
   */
  criarPendenteSeNaoHouver(ctx: ContextoEscopado, agora: Date): Promise<boolean>;
  /** Vigente (`estado <> 'encerrada'`) do salão, sem trava, com o e-mail do usuário da sessão (null em contexto de sistema). */
  lerVigente(ctx: ContextoEscopado): Promise<AssinaturaVigente | null>;
  /** CAS: grava o vínculo só se a linha ainda é `pendente` com o vínculo `de`. `false` = perdeu a corrida. */
  trocarProvedor(ctx: ContextoEscopado, d: { id: string; de: string | null; para: string; agora: Date }): Promise<boolean>;
  /** Trava a linha (`FOR NO KEY UPDATE`) e confere que o vínculo ainda é `provedorId`. Só em emTransacao. */
  confirmarProvedor(ctx: ContextoEscopado, d: { id: string; provedorId: string }): Promise<boolean>;
  /** Salão suspenso manualmente + assinatura mais recente (um comando). Recusa admin. */
  lerEstadoBruto(ctx: ContextoDeLeituraDeAgenda): Promise<EstadoBrutoDaAssinatura>;
}

type Linha = {
  id: string;
  estado: string;
  teste_fim_em: Date | null;
  periodo_pago_ate: Date | null;
  primeira_falha_em: Date | null;
  carencia_ate: Date | null;
  cancelada_em: Date | null;
  acesso_ate: Date | null;
};

const paraTravada = (l: Linha): AssinaturaTravada => ({
  id: l.id,
  estado: l.estado,
  testeFimEm: l.teste_fim_em,
  periodoPagoAte: l.periodo_pago_ate,
  primeiraFalhaEm: l.primeira_falha_em,
  carenciaAte: l.carencia_ate,
  canceladaEm: l.cancelada_em,
  acessoAte: l.acesso_ate,
});

export function criarRepoAssinatura(db: Executor): RepoAssinatura {
  return {
    async travar(ctx, o) {
      const salaoId = exigirEscopo(ctx);
      if (o.assinaturaId !== undefined && !ehUuid(o.assinaturaId)) {
        return null;
      }
      const id = o.assinaturaId ?? null;
      const pular = o.pularTravada === true;
      const recente = o.recenteSeNaoHouver === true;
      // Quatro comandos fixos (texto estático) para a trava ser reconhecível em pg_stat_activity.
      let linhas: Linha[];
      if (id !== null && pular) {
        linhas = await db.$queryRaw<Linha[]>`
          SELECT a.id::text AS id, a.estado::text AS estado, a.teste_fim_em, a.periodo_pago_ate, a.primeira_falha_em,
                 a.carencia_ate, a.cancelada_em, a.acesso_ate
            FROM assinatura a
           WHERE a.salao_id = ${salaoId}::uuid AND a.id = ${id}::uuid
             FOR NO KEY UPDATE OF a SKIP LOCKED`;
      } else if (id !== null) {
        linhas = await db.$queryRaw<Linha[]>`
          SELECT a.id::text AS id, a.estado::text AS estado, a.teste_fim_em, a.periodo_pago_ate, a.primeira_falha_em,
                 a.carencia_ate, a.cancelada_em, a.acesso_ate
            FROM assinatura a
           WHERE a.salao_id = ${salaoId}::uuid AND a.id = ${id}::uuid
             FOR NO KEY UPDATE OF a`;
      } else {
        // Sem id: resolve o alvo SEM trava (a vigente, ou a mais recente) e trava por id em seguida. A
        // releitura sob a trava (READ COMMITTED) vê o que a transação anterior confirmou; juntar os dois
        // passos num comando reavaliaria só a linha travada, não o predicado de "vigente".
        const alvo = await db.$queryRaw<{ id: string }[]>`
          SELECT a.id::text AS id
            FROM assinatura a
           WHERE a.salao_id = ${salaoId}::uuid
             AND (a.estado <> 'encerrada' OR ${recente}::boolean)
           ORDER BY (a.estado <> 'encerrada') DESC, a.criado_em DESC, a.id DESC
           LIMIT 1`;
        if (!alvo[0]) {
          return null;
        }
        linhas = await db.$queryRaw<Linha[]>`
          SELECT a.id::text AS id, a.estado::text AS estado, a.teste_fim_em, a.periodo_pago_ate, a.primeira_falha_em,
                 a.carencia_ate, a.cancelada_em, a.acesso_ate
            FROM assinatura a
           WHERE a.salao_id = ${salaoId}::uuid AND a.id = ${alvo[0].id}::uuid
             FOR NO KEY UPDATE OF a`;
      }
      if (linhas[0]) {
        return paraTravada(linhas[0]);
      }
      if (id !== null && pular) {
        const existe = await db.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM assinatura WHERE salao_id = ${salaoId}::uuid AND id = ${id}::uuid`;
        return existe.length > 0 ? 'ocupada' : null;
      }
      return null;
    },

    async inserirPagamento(ctx, d) {
      exigirEscopo(ctx);
      const linhas = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO assinatura_pagamento (assinatura_id, pagamento_id, status, valor_centavos)
        VALUES (${d.assinaturaId}::uuid, ${d.pagamentoId}, ${d.status}, ${d.valorCentavos}::int)
        ON CONFLICT (pagamento_id) DO NOTHING
        RETURNING id::text AS id`;
      return linhas[0]?.id ?? null;
    },

    async aplicarPasso(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      const c = d.campos;
      const tem = (k: keyof CamposDoPasso) => k in c;
      const v = (k: keyof CamposDoPasso) => c[k] ?? null;
      const linhas = await db.$queryRaw<{ id: string }[]>`
        UPDATE assinatura
           SET estado = ${d.para}::estado_assinatura,
               teste_fim_em = CASE WHEN ${tem('testeFimEm')}::boolean THEN ${v('testeFimEm')}::timestamptz ELSE teste_fim_em END,
               periodo_pago_ate = CASE WHEN ${tem('periodoPagoAte')}::boolean THEN ${v('periodoPagoAte')}::timestamptz ELSE periodo_pago_ate END,
               primeira_falha_em = CASE WHEN ${tem('primeiraFalhaEm')}::boolean THEN ${v('primeiraFalhaEm')}::timestamptz ELSE primeira_falha_em END,
               carencia_ate = CASE WHEN ${tem('carenciaAte')}::boolean THEN ${v('carenciaAte')}::timestamptz ELSE carencia_ate END,
               cancelada_em = CASE WHEN ${tem('canceladaEm')}::boolean THEN ${v('canceladaEm')}::timestamptz ELSE cancelada_em END,
               acesso_ate = CASE WHEN ${tem('acessoAte')}::boolean THEN ${v('acessoAte')}::timestamptz ELSE acesso_ate END,
               atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${d.id}::uuid AND salao_id = ${salaoId}::uuid AND estado = ${d.de}::estado_assinatura
        RETURNING id::text AS id`;
      return linhas.length === 1;
    },

    async atualizarPeriodoPago(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      await db.$executeRaw`
        UPDATE assinatura
           SET periodo_pago_ate = ${d.periodoPagoAte}::timestamptz, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${d.id}::uuid AND salao_id = ${salaoId}::uuid`;
    },

    async inserirTransicao(ctx, d) {
      exigirEscopo(ctx);
      await db.$executeRaw`
        INSERT INTO assinatura_transicao (assinatura_id, de, para, causa, evento_id, ocorrida_em)
        VALUES (${d.assinaturaId}::uuid, ${d.de}::estado_assinatura, ${d.para}::estado_assinatura, ${d.causa},
                ${d.eventoId}::uuid, ${d.agora}::timestamptz)`;
    },

    async marcarAplicado(ctx, pagamentoLinhaId, agora) {
      exigirEscopo(ctx);
      await db.$executeRaw`
        UPDATE assinatura_pagamento SET aplicado_em = ${agora}::timestamptz WHERE id = ${pagamentoLinhaId}::uuid`;
    },

    async criarPendenteSeNaoHouver(ctx, agora) {
      const salaoId = exigirEscopo(ctx);
      const n = await db.$executeRaw`
        INSERT INTO assinatura (salao_id, estado, criado_em, atualizado_em)
        VALUES (${salaoId}::uuid, 'pendente', ${agora}::timestamptz, ${agora}::timestamptz)
        ON CONFLICT (salao_id) WHERE estado <> 'encerrada' DO NOTHING`;
      return n === 1;
    },

    async lerVigente(ctx) {
      const salaoId = exigirEscopo(ctx);
      const usuarioId = ctx.tipo === 'tenant' ? ctx.usuarioId : null;
      const linhas = await db.$queryRaw<{ id: string; estado: string; provedor: string | null; email: string | null }[]>`
        SELECT a.id::text AS id, a.estado::text AS estado, a.provedor_assinatura_id AS provedor,
               (SELECT u.email FROM usuario u WHERE u.id = ${usuarioId}::uuid AND u.salao_id = a.salao_id) AS email
          FROM assinatura a
         WHERE a.salao_id = ${salaoId}::uuid AND a.estado <> 'encerrada'`;
      const l = linhas[0];
      return l ? { id: l.id, estado: l.estado, provedorAssinaturaId: l.provedor, emailGestor: l.email } : null;
    },

    async trocarProvedor(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(d.id)) return false;
      const linhas = await db.$queryRaw<{ id: string }[]>`
        UPDATE assinatura
           SET provedor_assinatura_id = ${d.para}, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${d.id}::uuid AND salao_id = ${salaoId}::uuid AND estado = 'pendente'
           AND provedor_assinatura_id IS NOT DISTINCT FROM ${d.de}::text
        RETURNING id::text AS id`;
      return linhas.length === 1;
    },

    async confirmarProvedor(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(d.id)) return false;
      const linhas = await db.$queryRaw<{ provedor: string | null }[]>`
        SELECT a.provedor_assinatura_id AS provedor
          FROM assinatura a
         WHERE a.id = ${d.id}::uuid AND a.salao_id = ${salaoId}::uuid
           FOR NO KEY UPDATE OF a`;
      return linhas[0]?.provedor === d.provedorId;
    },

    async lerEstadoBruto(ctx) {
      const salaoId = exigirLeituraDeAgenda(ctx);
      const linhas = await db.$queryRaw<
        { suspenso_manual_em: Date | null; estado: string | null; carencia_ate: Date | null; acesso_ate: Date | null }[]
      >`
        SELECT s.suspenso_manual_em, a.estado::text AS estado, a.carencia_ate, a.acesso_ate
          FROM salao s
          LEFT JOIN LATERAL (
            SELECT estado, carencia_ate, acesso_ate FROM assinatura
             WHERE salao_id = s.id
             ORDER BY criado_em DESC, id DESC
             LIMIT 1
          ) a ON true
         WHERE s.id = ${salaoId}::uuid`;
      const l = linhas[0];
      if (!l) {
        
        throw new NaoEncontrado();
      }
      return {
        suspensoManualEm: l.suspenso_manual_em,
        assinatura: l.estado === null ? null : { estado: l.estado, carenciaAte: l.carencia_ate, acessoAte: l.acesso_ate },
      };
    },
  };
}

/** Varredura do job (sem contexto de salão): candidatas a transição por prazo, cursor por id, sem trava. */
export interface RepoAssinaturaSistema {
  listarVencidas(agora: Date, depoisDoId: string | null, limite: number): Promise<{ id: string; salaoId: string }[]>;
  /** D-041: resolve a assinatura local pelo vínculo com o provedor (sem filtro de estado). */
  buscarPorProvedor(provedorId: string): Promise<{ id: string; salaoId: string; estado: string } | null>;
}

export function criarRepoAssinaturaSistema(db?: Executor): RepoAssinaturaSistema {
  return {
    async listarVencidas(agora, depoisDoId, limite) {
      const cliente = db ?? obterPrisma();
      const cursor = depoisDoId ?? '00000000-0000-0000-0000-000000000000';
      const linhas = await cliente.$queryRaw<{ id: string; salao_id: string }[]>`
        SELECT id::text AS id, salao_id::text AS salao_id
          FROM assinatura
         WHERE id > ${cursor}::uuid
           AND ((estado = 'em_teste' AND teste_fim_em <= ${agora}::timestamptz)
             OR (estado = 'em_carencia' AND carencia_ate <= ${agora}::timestamptz)
             OR (estado = 'cancelada' AND (acesso_ate <= ${agora}::timestamptz OR acesso_ate IS NULL)))
         ORDER BY id
         LIMIT ${limite}::int`;
      return linhas.map((l) => ({ id: l.id, salaoId: l.salao_id }));
    },

    async buscarPorProvedor(provedorId) {
      const cliente = db ?? obterPrisma();
      const linhas = await cliente.$queryRaw<{ id: string; salao_id: string; estado: string }[]>`
        SELECT id::text AS id, salao_id::text AS salao_id, estado::text AS estado
          FROM assinatura
         WHERE provedor_assinatura_id = ${provedorId}::text`;
      const l = linhas[0];
      return l ? { id: l.id, salaoId: l.salao_id, estado: l.estado } : null;
    },
  };
}

export function repoAssinaturaSistema(): RepoAssinaturaSistema {
  return criarRepoAssinaturaSistema();
}
