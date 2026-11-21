import { enfileirar as enfileirarPadrao } from '@/server/queue/client';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado } from '@/server/tenant/context';

import { chaveDaMensagem } from './chave';
import { conferirVigencia } from './elegibilidade';
import { enfileirarUma } from './enfileirar';
import type { DependenciasEnfileirar } from './enfileirar';
import type { ResultadoReenvio } from './tipos';

/**
 * Reenvio manual de mensagem `falhou` (RN-18; contrato de E7.3/E8.3). Sem verificação de papel: quem
 * chama decide quem pode (e audita, no caso do super admin). Numa transação a linha volta a
 * `pendente` (mantém registro, chave e tentativas); só DEPOIS do commit enfileira com a mesma chave.
 * `enviada` nunca é reenviada. Mensagem de outro salão ou id inválido → NaoEncontrado. Se a fila
 * estiver fora, a linha já está `pendente` e a reconciliação a recupera (o resultado continua
 * `reenfileirada`, e o log `mensagem.fila_indisponivel` registra a falha).
 */
export async function reenviarMensagem(
  ctx: ContextoEscopado,
  mensagemId: string,
  agora: Date,
  deps: DependenciasEnfileirar = {},
): Promise<ResultadoReenvio> {
  const r = await emTransacao((repos) => repos.mensagens.reenviar(ctx, mensagemId, agora, conferirVigencia));
  if (r.resultado === 'recusada') {
    return r;
  }
  const chave = chaveDaMensagem(r.reservaId, r.tipo, r.revisao);
  await enfileirarUma(deps.enfileirar ?? enfileirarPadrao, deps.log ?? ((linha: string) => console.error(linha)), {
    mensagemId: r.mensagemId,
    chave,
    tipo: r.tipo,
    revisao: r.revisao,
  });
  return { resultado: 'reenfileirada', mensagemId: r.mensagemId, chave };
}
