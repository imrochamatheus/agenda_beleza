import { validarEnv } from '@/server/env';
import type { GeradorLinkAvaliacao } from '@/server/mensagens/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { SistemaContext } from '@/server/tenant/context';

import { segredoDeAvaliacao } from './config';
import { gerarToken, hashDoToken } from './token';
import { VALIDADE_CONVITE_DIAS } from './tipos';

// Gerador do link do convite (D-032 §3.2), injetado em `whatsapp-reserva.ts`. Determinístico: o mesmo
// token em toda geração; o convite é criado uma vez (ON CONFLICT DO NOTHING) e a validade nunca é
// renovada. O link devolvido vive só em memória até a chamada ao adaptador. Reserva que não é
// `concluido` de cliente não anonimizada → Error (vira `link_indisponivel` permanente).

const DIA_MS = 24 * 60 * 60 * 1000;

export type DependenciasConvite = {
  agora?: () => Date;
  segredo?: () => string;
  appUrl?: () => string;
};

export function criarGeradorLink(deps: DependenciasConvite = {}): GeradorLinkAvaliacao {
  return async (ctx: SistemaContext, reservaId: string): Promise<string> => {
    const agora = (deps.agora ?? (() => new Date()))();
    const token = gerarToken((deps.segredo ?? (() => segredoDeAvaliacao()))(), ctx.salaoId, reservaId);
    const expiraEm = new Date(agora.getTime() + VALIDADE_CONVITE_DIAS * DIA_MS);
    const r = await emTransacao((repos) =>
      repos.avaliacoes.garantirConvite(ctx, { reservaId, tokenHash: hashDoToken(token), expiraEm, agora }),
    );
    if (r === null) throw new Error('reserva sem convite de avaliação');
    const appUrl = (deps.appUrl ?? (() => validarEnv(process.env).APP_URL))().replace(/\/+$/, '');
    return `${appUrl}/${r.slug}/avaliar/${token}`;
  };
}

export const gerarLinkAvaliacao: GeradorLinkAvaliacao = criarGeradorLink();
