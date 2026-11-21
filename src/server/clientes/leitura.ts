import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import type { TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import type { ContatoCliente } from './tipos';

/**
 * Contato da cliente para a agenda (RN-16; E3.3/E3.5). Gestor: qualquer cliente do salão, inclusive
 * anonimizada (nome/telefone nulos). Profissional: só quem tem reserva (qualquer status) com ele.
 * NaoEncontrado não distingue "outro profissional", "outro salão" e "inexistente".
 */
export async function lerContatoDaCliente(ctx: TenantContext, clienteId: unknown): Promise<ContatoCliente> {
  exigirPermissao(ctx, 'cliente.contato');
  if (!ehUuid(clienteId)) {
    throw new NaoEncontrado();
  }
  let so: { profissionalId: string } | undefined;
  if (ctx.papel === 'profissional') {
    if (ctx.profissionalId === null) throw new AcessoNegado('escopo próprio sem perfil de profissional');
    so = { profissionalId: ctx.profissionalId };
  }
  const c = await repos().clientes.buscarContato(ctx, clienteId, so);
  const anonimizada = c.anonimizadaEm !== null;
  return {
    id: c.id,
    nome: anonimizada ? null : c.nome,
    telefoneE164: anonimizada ? null : c.telefoneE164,
    anonimizada,
  };
}
