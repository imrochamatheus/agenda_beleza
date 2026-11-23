// Limite de reservas futuras por número e salão (D-027 RN-2), chamado em `antesDaReserva`, DENTRO da
// transação, depois do upsert da cliente: esse upsert trava a linha da cliente até o commit, então duas
// transações do mesmo número se serializam aí (mesmo com profissionais diferentes) e a segunda enxerga a
// reserva comitada da primeira (READ COMMITTED: um snapshot por comando). Sem lock novo.
// A requisição repetida (mesma chave) nunca é recusada: o INSERT depois a responde como `repetida`.
// D-050 RN-18: conta RESERVAS, não itens: uma reserva é futura se tem ao menos um item `confirmado` com
// `inicio > agora` (regra em `RepoReserva.contarFuturasDaCliente`); a reserva nova conta como uma só,
// qualquer que seja o número de itens.
import type { DependenciasCriarReserva } from '@/server/reservas/tipos';

import { MAXIMO_FUTURAS_POR_NUMERO, MENSAGENS_PROTECAO } from './tipos';

export function criarAntesDaReserva(a: {
  chave: string | null;
  agora: Date;
}): NonNullable<DependenciasCriarReserva['antesDaReserva']> {
  return async (ctx, r, { clienteId }) => {
    if (a.chave !== null && (await r.reservas.buscarPorChave(ctx, a.chave)) !== null) return { permitido: true };
    const futuras = await r.reservas.contarFuturasDaCliente(ctx, {
      clienteId,
      agora: a.agora,
      ignorarChave: a.chave,
    });
    return futuras >= MAXIMO_FUTURAS_POR_NUMERO
      ? { permitido: false, motivo: MENSAGENS_PROTECAO.futuras }
      : { permitido: true };
  };
}
