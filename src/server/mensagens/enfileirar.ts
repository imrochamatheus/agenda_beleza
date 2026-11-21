import { enfileirar as enfileirarPadrao } from '@/server/queue/client';
import { FILA } from '@/server/queue/filas';

import type { ResultadoRegistro, TipoMensagem } from './tipos';

type Enfileirar = typeof enfileirarPadrao;

export type DependenciasEnfileirar = {
  enfileirar?: Enfileirar;
  /** Recebe uma linha JSON; padrão `console.error`. */
  log?: (linha: string) => void;
};

/**
 * Enfileira, DEPOIS do commit, as mensagens que `registrarMensagem` marcou com `precisaEnfileirar`
 * (RN-3). Nunca lança: a reserva já está salva e a reconciliação reenfileira o que falhar. O log traz
 * só `mensagemId`, `tipo` e `revisao` (RN-22), nunca a causa do erro.
 */
export async function enfileirarMensagens(
  registros: readonly ResultadoRegistro[],
  deps: DependenciasEnfileirar = {},
): Promise<void> {
  const enviar = deps.enfileirar ?? enfileirarPadrao;
  const log = deps.log ?? ((linha: string) => console.error(linha));
  for (const r of registros) {
    if (!r.precisaEnfileirar) continue;
    await enfileirarUma(enviar, log, r);
  }
}

/** Mesma regra para o reenvio manual e a reconciliação (a linha já está `pendente`). */
export async function enfileirarUma(
  enviar: Enfileirar,
  log: (linha: string) => void,
  r: { mensagemId: string; chave: string; tipo: TipoMensagem; revisao: number },
): Promise<void> {
  try {
    await enviar(FILA.whatsappReserva, { mensagemId: r.mensagemId }, { chave: r.chave });
  } catch {
    log(
      JSON.stringify({
        evento: 'mensagem.fila_indisponivel',
        em: new Date().toISOString(),
        mensagemId: r.mensagemId,
        tipo: r.tipo,
        revisao: r.revisao,
      }),
    );
  }
}
