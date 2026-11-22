import { enfileirar as enfileirarPadrao } from '@/server/queue/client';
import type { Repos } from '@/server/repos';
import type { ResultadoReenvioRepo } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado } from '@/server/tenant/context';

import { chaveDaMensagem } from './chave';
import { conferirVigencia } from './elegibilidade';
import { enfileirarUma } from './enfileirar';
import type { DependenciasEnfileirar } from './enfileirar';
import type { ResultadoReenvio } from './tipos';

type Reenfileirada = Extract<ResultadoReenvioRepo, { resultado: 'reenfileirada' }>;

/**
 * Núcleo transacional do reenvio (D-045): `mensagem FOR UPDATE` → só `falhou` e vigente volta a `pendente`
 * (cliente anonimizada vira `cancelada_anonimizacao`). Roda NA transação do chamador (`r`): o super admin
 * grava a auditoria na mesma transação. Não enfileira.
 */
export function reenviarNoRepos(
  r: Repos,
  ctx: ContextoEscopado,
  mensagemId: string,
  agora: Date,
): Promise<ResultadoReenvioRepo> {
  return r.mensagens.reenviar(ctx, mensagemId, agora, conferirVigencia);
}

/**
 * Enfileiramento do reenvio, DEPOIS do commit, com a chave `reserva:tipo:revisao`. Nunca lança (falha →
 * log `mensagem.fila_indisponivel`; a reconciliação recupera). O resultado não muda se a fila estiver fora;
 * `filaIndisponivel` diz se houve falha.
 */
export async function enfileirarReenvio(
  r: Reenfileirada,
  deps: DependenciasEnfileirar = {},
): Promise<ResultadoReenvio & { resultado: 'reenfileirada'; filaIndisponivel: boolean }> {
  const chave = chaveDaMensagem(r.reservaId, r.tipo, r.revisao);
  const enviar = deps.enfileirar ?? enfileirarPadrao;
  let falhou = false;
  await enfileirarUma(
    async (...args: Parameters<typeof enfileirarPadrao>) => {
      try {
        return await enviar(...args);
      } catch (e) {
        falhou = true;
        throw e;
      }
    },
    deps.log ?? ((linha: string) => console.error(linha)),
    { mensagemId: r.mensagemId, chave, tipo: r.tipo, revisao: r.revisao },
  );
  return { resultado: 'reenfileirada', mensagemId: r.mensagemId, chave, filaIndisponivel: falhou };
}

/**
 * Reenvio manual de mensagem `falhou` (RN-18; contrato de E7.3). Sem verificação de papel: quem chama
 * decide quem pode. Numa transação a linha volta a `pendente` (mantém registro, chave e tentativas); só
 * DEPOIS do commit enfileira com a mesma chave. `enviada` nunca é reenviada. Mensagem de outro salão ou id
 * inválido → NaoEncontrado. Se a fila estiver fora, a linha já está `pendente` e a reconciliação a recupera
 * (o resultado continua `reenfileirada`). O super admin usa `reenviarMensagemAdmin` (auditado).
 */
export async function reenviarMensagem(
  ctx: ContextoEscopado,
  mensagemId: string,
  agora: Date,
  deps: DependenciasEnfileirar = {},
): Promise<ResultadoReenvio> {
  const r = await emTransacao((repos) => reenviarNoRepos(repos, ctx, mensagemId, agora));
  if (r.resultado === 'recusada') {
    return r;
  }
  const e = await enfileirarReenvio(r, deps);
  return { resultado: 'reenfileirada', mensagemId: e.mensagemId, chave: e.chave };
}
