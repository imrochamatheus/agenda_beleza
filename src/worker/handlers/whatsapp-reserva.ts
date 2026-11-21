import { gerarLinkAvaliacao } from '@/server/avaliacoes/convite';
import { integracoes } from '@/server/integrations/registry';
import { enviarMensagem } from '@/server/mensagens/envio';
import type { DependenciasEnvio } from '@/server/mensagens/envio';
import { ErroReenvioAgendado } from '@/server/mensagens/tipos';
import { FILA } from '@/server/queue/filas';

import { definirHandler } from './tipos';

/**
 * Envio das mensagens de reserva (D-024). O payload `{ mensagemId }` já chega validado. O núcleo é
 * `enviarMensagem` (reivindicação atômica, tentativa por chamada, estado final). Falha temporária com
 * retentativas restantes devolve a mensagem a `pendente` e lança `ErroReenvioAgendado` (mensagem
 * fixa, sem causa) para o pg-boss reagendar com o backoff de `QUEUE_RETRY_*`; nos demais casos o job
 * termina `completed` e o estado oficial fica em `mensagem.estado`. Só escreve em `mensagem` e
 * `mensagem_tentativa`. Produção: porta do registro e o gerador real do link de avaliação (D-032, `gerarLinkAvaliacao`).
 */
export function criarWhatsappReserva(deps: Partial<DependenciasEnvio> = {}) {
  return definirHandler(FILA.whatsappReserva, {
    async processar({ mensagemId }, ctx) {
      const resultado = await enviarMensagem(
        mensagemId,
        { atual: ctx.tentativa, maxima: ctx.tentativasMaximas },
        {
          whatsapp: deps.whatsapp ?? (() => integracoes().whatsapp),
          gerarLink: deps.gerarLink ?? gerarLinkAvaliacao,
          agora: deps.agora ?? (() => new Date()),
          sistema: deps.sistema,
          log: deps.log ?? ((evento, campos) => ctx.log(evento, campos)),
        },
      );
      if (resultado === 'reagendar') {
        throw new ErroReenvioAgendado();
      }
    },
  });
}

export const whatsappReserva = criarWhatsappReserva();
