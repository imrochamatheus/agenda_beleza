import { formatarMesAno } from '@/lib/format';
import { lerPublicas } from '@/server/repos/avaliacao-publica';
import type { PublicoContext } from '@/server/tenant/context';

import { LIMITE_LISTA_PUBLICA } from './tipos';
import type { AvaliacoesPublicas } from './tipos';

/**
 * Leitura pública para a E4.1 (D-032 §3.5): total e média das visíveis e as últimas `limite`, com o mês
 * e o ano no fuso do salão. Texto cru (o componente escapa). Sem verificação de papel nem de assinatura.
 */
export async function lerAvaliacoesPublicas(ctx: PublicoContext, limite = LIMITE_LISTA_PUBLICA): Promise<AvaliacoesPublicas> {
  const l = await lerPublicas(ctx, limite);
  return {
    total: l.total,
    media: l.media,
    itens: l.itens.map((i) => ({
      nome: i.nome,
      nota: i.nota,
      comentario: i.comentario,
      mesAno: formatarMesAno(i.criadoEm, l.fuso),
    })),
  };
}
