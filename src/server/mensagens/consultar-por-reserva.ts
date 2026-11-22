import { exigirPermissao, filtroDeProfissional } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import type { TenantContext } from '@/server/tenant/context';

import { rotuloDaMensagem } from './rotulos';
import type { MensagemSituacao } from './situacao-tipos';

export type { MensagemSituacao } from './situacao-tipos';

/**
 * Situação de envio das mensagens de uma reserva para a equipe (D-043). Quem vê a reserva (`agenda.ver`)
 * vê as mensagens; o profissional só as das reservas do próprio perfil. Reserva inexistente, malformada,
 * de outro salão ou de outro profissional → NaoEncontrado, sempre o mesmo. Somente leitura, sem checagem
 * de assinatura (RN-4). Devolve só rótulos mapeados: nunca `erroCodigo` bruto, destinatário, parâmetros,
 * id do provedor nem `erro_detalhe` (RN-5).
 */
export async function consultarMensagensDaReserva(ctx: TenantContext, id: unknown): Promise<MensagemSituacao[]> {
  exigirPermissao(ctx, 'agenda.ver');
  const escopo = filtroDeProfissional(ctx, 'agenda.ver');
  const linhas = await repos().mensagens.listarDaReservaDaEquipe(
    ctx,
    typeof id === 'string' ? id : '',
    'profissionalId' in escopo ? escopo.profissionalId : null,
  );
  return linhas.map((m) => ({
    id: m.id,
    estado: m.estado,
    ...rotuloDaMensagem(m),
    tentativas: m.tentativas,
    ultimaTentativaEm: m.ultimaTentativaEm,
  }));
}
