import { repos } from '@/server/repos';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';

import { POR_PAGINA_FILA } from './tipos';
import type { DetalheDaAvaliacao, FilaModeracao } from './tipos';
import type { FiltrosFila } from './validacao';

// Leituras do super admin para a moderação (D-035 RN-7). Sem next/*. Só plataforma: exige AdminContext.

export async function listarFilaModeracao(ctx: AdminContext, f: FiltrosFila): Promise<FilaModeracao> {
  exigirAdmin(ctx);
  const { total, itens } = await repos().denuncias.fila(ctx, f);
  return { total, pagina: f.pagina, porPagina: POR_PAGINA_FILA, itens };
}

export async function lerDetalheDaAvaliacao(ctx: AdminContext, avaliacaoId: string): Promise<DetalheDaAvaliacao | null> {
  exigirAdmin(ctx);
  return repos().denuncias.detalhe(ctx, avaliacaoId);
}
