import { LOTE_RECONCILIACAO, PRAZO_ENVIANDO_MS, PRAZO_PENDENTE_MS } from '@/server/mensagens/config';
import { chaveDaMensagem } from '@/server/mensagens/chave';
import { enfileirar as enfileirarPadrao } from '@/server/queue/client';
import { ErroFilaIndisponivel } from '@/server/queue/erros';
import { FILA } from '@/server/queue/filas';
import { repoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { RepoMensagemSistema } from '@/server/repos/mensagem-sistema';

import { definirHandler } from './tipos';

export type DependenciasReconciliacao = {
  enfileirar?: typeof enfileirarPadrao;
  agora?: () => Date;
  sistema?: RepoMensagemSistema;
  log?: (evento: string, campos: Record<string, number>) => void;
};

/**
 * Reconciliação das mensagens (D-024 RN-9, A-10), a cada minuto, só olhando `mensagem`:
 * (a) `enviando` mais antiga que PRAZO_ENVIANDO → `falhou/resultado_incerto` (sem reenvio: o envio
 * pode ter ocorrido); (b) `pendente` mais antiga que PRAZO_PENDENTE → tenta enfileirar com a mesma
 * chave (`chave_em_uso` = já há job: nada a fazer). Fila fora do ar interrompe o lote. Em lotes de
 * até LOTE_RECONCILIACAO, mais antigas primeiro; idempotente. O log traz só contagens.
 */
export function criarReconciliarMensagens(deps: DependenciasReconciliacao = {}) {
  return definirHandler(FILA.reconciliarMensagens, {
    cron: '* * * * *',
    async processar(_payload, ctx) {
      const agora = (deps.agora ?? (() => new Date()))();
      const sistema = deps.sistema ?? repoMensagemSistema();
      const enfileirar = deps.enfileirar ?? enfileirarPadrao;
      const log = deps.log ?? ((evento, campos) => ctx.log(evento, campos));

      const enviandoFechadas = await sistema.expirarEnviandoPresas(
        new Date(agora.getTime() - PRAZO_ENVIANDO_MS),
        LOTE_RECONCILIACAO,
        agora,
      );

      const pendentes = await sistema.listarPendentesAntigas(
        new Date(agora.getTime() - PRAZO_PENDENTE_MS),
        LOTE_RECONCILIACAO,
      );
      let reenfileiradas = 0;
      let jaNaFila = 0;
      let filaIndisponivel = 0;
      for (const m of pendentes) {
        try {
          const r = await enfileirar(
            FILA.whatsappReserva,
            { mensagemId: m.id },
            { chave: chaveDaMensagem(m.reservaId, m.tipo, m.revisao) },
          );
          if (r.criado) reenfileiradas++;
          else jaNaFila++;
        } catch (falha) {
          if (!(falha instanceof ErroFilaIndisponivel)) throw falha;
          // A fila está fora: não adianta insistir nas demais; o próximo ciclo tenta de novo.
          filaIndisponivel = 1;
          break;
        }
      }

      log('mensagem.reconciliacao', {
        pendentesExaminadas: pendentes.length,
        reenfileiradas,
        jaNaFila,
        filaIndisponivel,
        enviandoFechadas,
      });
    },
  });
}

export const reconciliarMensagens = criarReconciliarMensagens();
