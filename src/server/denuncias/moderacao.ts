import { registrarAuditoria } from '@/server/auditoria/registrar';
import { ehUuid } from '@/server/repos/ids';
import { emTransacao } from '@/server/repos/transacao';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import type { ResultadoModeracao } from './tipos';
import { validarMotivoModeracao } from './validacao';

// Moderação de avaliações pelo super admin (D-035, RN-8 a RN-10). Sem next/*. Cada operação é UMA
// transação READ COMMITTED; ordem: `avaliacao … FOR UPDATE` (nunca o salão) → conferir o estado
// (recusa SEM escrita nem auditoria) → UPDATEs → auditoria, SEMPRE por último e na MESMA transação:
// se ela falhar, tudo desfaz. Nada é enfileirado nem notificado (CA-13). Idempotentes por estado.

export type EntradaModeracao = { avaliacaoId: string; motivo: unknown };

const iso = (d: Date): string => d.toISOString();

export async function retirarAvaliacao(ctx: AdminContext, e: EntradaModeracao, agora: Date): Promise<ResultadoModeracao> {
  const adminId = exigirAdmin(ctx);
  const m = validarMotivoModeracao(e.motivo);
  if (!m.ok) return { resultado: 'invalido', erro: m.erro };
  if (!ehUuid(e.avaliacaoId)) throw new NaoEncontrado();
  return emTransacao(async (r): Promise<ResultadoModeracao> => {
    const av = await r.avaliacoes.travarParaModerar(ctx, e.avaliacaoId);
    if (av === null) throw new NaoEncontrado();
    if (av.retiradaEm !== null) return { resultado: 'recusado', motivo: 'estado_atual' };
    await r.avaliacoes.retirar(ctx, e.avaliacaoId, agora);
    await r.denuncias.resolverPendentes(ctx, { avaliacaoId: e.avaliacaoId, resolucao: 'retirada', agora });
    await registrarAuditoria(
      ctx,
      {
        acao: 'avaliacao.retirar',
        entidade: 'avaliacao',
        entidadeId: e.avaliacaoId,
        salaoId: av.salaoId,
        antes: { retirada_em: null, retirada_por: null },
        depois: { retirada_em: iso(agora), retirada_por: adminId, motivo: m.motivo },
      },
      r,
    );
    return { resultado: 'ok' };
  });
}

export async function restaurarAvaliacao(ctx: AdminContext, e: EntradaModeracao): Promise<ResultadoModeracao> {
  exigirAdmin(ctx);
  const m = validarMotivoModeracao(e.motivo);
  if (!m.ok) return { resultado: 'invalido', erro: m.erro };
  if (!ehUuid(e.avaliacaoId)) throw new NaoEncontrado();
  return emTransacao(async (r): Promise<ResultadoModeracao> => {
    const av = await r.avaliacoes.travarParaModerar(ctx, e.avaliacaoId);
    if (av === null) throw new NaoEncontrado();
    if (av.retiradaEm === null) return { resultado: 'recusado', motivo: 'estado_atual' };
    await r.avaliacoes.restaurar(ctx, e.avaliacaoId);
    await registrarAuditoria(
      ctx,
      {
        acao: 'avaliacao.restaurar',
        entidade: 'avaliacao',
        entidadeId: e.avaliacaoId,
        salaoId: av.salaoId,
        antes: { retirada_em: iso(av.retiradaEm), retirada_por: av.retiradaPor },
        depois: { retirada_em: null, retirada_por: null, motivo: m.motivo },
      },
      r,
    );
    return { resultado: 'ok' };
  });
}

/** Arquiva (`mantida`) a denúncia indicada ou todas as pendentes da avaliação, sem retirá-la. */
export async function arquivarDenuncias(
  ctx: AdminContext,
  e: { avaliacaoId: string; denunciaId?: string },
  agora: Date,
): Promise<ResultadoModeracao> {
  exigirAdmin(ctx);
  if (!ehUuid(e.avaliacaoId)) throw new NaoEncontrado();
  if (e.denunciaId !== undefined && !ehUuid(e.denunciaId)) throw new NaoEncontrado();
  return emTransacao(async (r): Promise<ResultadoModeracao> => {
    const av = await r.avaliacoes.travarParaModerar(ctx, e.avaliacaoId);
    if (av === null) throw new NaoEncontrado();
    const quantidade = await r.denuncias.resolverPendentes(ctx, {
      avaliacaoId: e.avaliacaoId,
      denunciaId: e.denunciaId,
      resolucao: 'mantida',
      agora,
    });
    if (quantidade === 0) return { resultado: 'recusado', motivo: 'sem_pendentes' };
    await registrarAuditoria(
      ctx,
      {
        acao: 'avaliacao.denuncia_resolver',
        entidade: 'avaliacao_denuncia',
        entidadeId: e.denunciaId ?? e.avaliacaoId,
        salaoId: av.salaoId,
        depois: { resolucao: 'mantida', quantidade },
      },
      r,
    );
    return { resultado: 'ok' };
  });
}
