import { exigirPermissao } from '@/server/auth/permissoes';
import type { Repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado, TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import type { EntradaAnonimizarCliente, ResultadoAnonimizar } from './tipos';

// Anonimização da cliente (D-031, E5.2; RN-1..RN-10). Sem next/*. Uma transação READ COMMITTED:
// salão FOR NO KEY UPDATE → cliente FOR UPDATE + UPDATE → mensagens e tentativas → hook (D-032: avaliações e convites, por último).
// Nunca captura 23505/23514: o serviço já trava e valida. Log só com ids e contagens.

/** Gancho da E4.5 (RN-10): roda DENTRO da transação, depois da limpeza das mensagens. */
export type AoAnonimizar = (ctx: ContextoEscopado, d: { clienteId: string; agora: Date }, r: Repos) => Promise<void>;

/** D-032 RN-10: apaga nome e comentário das avaliações da cliente e invalida seus convites (por último). */
export const aoAnonimizarPadrao: AoAnonimizar = async (ctx, { clienteId, agora }, r) => {
  await r.avaliacoes.anonimizarDaCliente(ctx, clienteId, agora);
};

/** Pontos de injeção (testes): o gancho e uma parada entre a trava e a escrita. */
export type DepsAnonimizar = {
  aoAnonimizar?: AoAnonimizar;
  aposTravar?: () => Promise<void>;
  aposCliente?: () => Promise<void>;
  aposMensagens?: () => Promise<void>;
};

export async function anonimizarCliente(
  ctx: TenantContext,
  entrada: EntradaAnonimizarCliente,
  agora: Date,
  deps: DepsAnonimizar = {},
): Promise<ResultadoAnonimizar> {
  exigirPermissao(ctx, 'cliente.gerir');
  const clienteId = entrada?.clienteId;
  if (!ehUuid(clienteId)) {
    throw new NaoEncontrado();
  }
  const gancho = deps.aoAnonimizar ?? aoAnonimizarPadrao;
  const resultado = await emTransacao(async (r): Promise<ResultadoAnonimizar> => {
    await r.saloes.travar(ctx);
    await deps.aposTravar?.();
    const c = await r.clientes.anonimizar(ctx, clienteId, agora);
    if (c.resultado === 'ja_anonimizada') {
      return { resultado: 'recusado', motivo: 'ja_anonimizada' };
    }
    await deps.aposCliente?.();
    const m = await r.mensagens.anonimizarDaCliente(ctx, clienteId, agora);
    await deps.aposMensagens?.();
    await gancho(ctx, { clienteId, agora }, r);
    return { resultado: 'anonimizada', canceladas: m.canceladas };
  });
  console.info(
    JSON.stringify({
      evento: 'cliente.anonimizada',
      clienteId,
      salaoId: ctx.salaoId,
      resultado: resultado.resultado,
      ...(resultado.resultado === 'anonimizada' ? { canceladas: resultado.canceladas } : {}),
    }),
  );
  return resultado;
}
