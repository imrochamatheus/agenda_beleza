import type { Repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { chaveDaMensagem } from './chave';
import { decidirElegibilidade } from './elegibilidade';
import type { ResultadoRegistro, TipoMensagem } from './tipos';

/**
 * Outbox (RN-3, A-2): registra a mensagem DENTRO da transação do evento da reserva, sem rede e sem
 * fila. Quem chama grava itens e derivados primeiro (e incrementa `reserva.revisao` em remarcar item,
 * cancelar item e cancelar todos, D-050 RN-28), chama esta função com os `Repos` da mesma transação e,
 * depois do commit, passa o resultado a `enfileirarMensagens`. A revisão é DERIVADA da reserva:
 * `confirmacao`/`convite_avaliacao` = 0; `remarcacao` (exige ≥ 1) e `cancelamento` = `reserva.revisao`.
 *
 * `reservaItemId` (D-050 RN-29) só com `remarcacao`/`cancelamento` (senão RangeError); ausente = reserva
 * inteira ("cancelar todos"). D-050: NÃO substitui mais pendentes; o chamador chama
 * `r.mensagens.substituirNaoVigentes` depois de registrar (RN-31).
 *
 * Elegibilidade (RN-8) avaliada aqui: sem consentimento nasce `nao_enviada`; cliente anonimizada
 * nasce `cancelada_anonimizacao`; nos dois casos não há job nem telefone gravado. Outro salão →
 * NaoEncontrado (RN-13).
 */
export async function registrarMensagem(
  ctx: ContextoEscopado,
  e: { reservaId: string; tipo: TipoMensagem; reservaItemId?: string | null },
  agora: Date,
  r: Repos,
): Promise<ResultadoRegistro> {
  const reservaItemId = e.reservaItemId ?? null;
  if (reservaItemId !== null && e.tipo !== 'remarcacao' && e.tipo !== 'cancelamento') {
    throw new RangeError('reservaItemId só é aceito em remarcação ou cancelamento');
  }
  const c = await r.mensagens.contextoDeRegistro(ctx, e.reservaId);

  let revisao = 0;
  if (e.tipo === 'remarcacao' || e.tipo === 'cancelamento') {
    if (c.reservaRevisao < 1) {
      throw new RangeError(`${e.tipo} exige reserva com revisão maior ou igual a 1`);
    }
    revisao = c.reservaRevisao;
  }

  const decisao = decidirElegibilidade({
    tipo: e.tipo,
    clienteAnonimizada: c.clienteAnonimizada,
    telefone: c.telefone,
    consentimentoMensagens: c.consentimentoMensagens,
    consentimentoConvite: c.consentimentoConvite,
  });

  const base = { reservaId: e.reservaId, reservaItemId, tipo: e.tipo, revisao };
  const { criada, mensagem } = await r.mensagens.inserir(
    ctx,
    decisao.acao === 'enviar'
      ? { ...base, estado: 'pendente', erroCodigo: null, destinatarioE164: c.telefone }
      : { ...base, estado: decisao.estado, erroCodigo: decisao.erroCodigo, destinatarioE164: null },
    agora,
  );

  return {
    criada,
    mensagemId: mensagem.id,
    tipo: mensagem.tipo,
    revisao: mensagem.revisao,
    estado: mensagem.estado,
    chave: chaveDaMensagem(e.reservaId, mensagem.tipo, mensagem.revisao),
    precisaEnfileirar: criada && mensagem.estado === 'pendente',
  };
}
