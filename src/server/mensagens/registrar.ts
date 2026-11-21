import type { Repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { chaveDaMensagem } from './chave';
import { decidirElegibilidade } from './elegibilidade';
import type { ResultadoRegistro, TipoMensagem } from './tipos';

/**
 * Outbox (RN-3, A-2): registra a mensagem DENTRO da transação do evento da reserva, sem rede e sem
 * fila. Quem chama (E3.2/E3.4/E3.5) grava a reserva primeiro (e incrementa `reserva.revisao` na
 * remarcação), chama esta função com os `Repos` da mesma transação e, depois do commit, passa o
 * resultado a `enfileirarMensagens`. A revisão é DERIVADA da reserva: `confirmacao` e
 * `convite_avaliacao` = 0; `remarcacao` e `cancelamento` = `reserva.revisao`.
 *
 * Elegibilidade (RN-8) avaliada aqui: sem consentimento nasce `nao_enviada`; cliente anonimizada
 * nasce `cancelada_anonimizacao`; nos dois casos não há job nem telefone gravado. Só uma linha nova
 * substitui pendentes antigas (RN-7), depois do INSERT. Outro salão → NaoEncontrado (RN-13).
 */
export async function registrarMensagem(
  ctx: ContextoEscopado,
  e: { reservaId: string; tipo: TipoMensagem },
  agora: Date,
  r: Repos,
): Promise<ResultadoRegistro> {
  const c = await r.mensagens.contextoDeRegistro(ctx, e.reservaId);

  let revisao = 0;
  if (e.tipo === 'remarcacao') {
    if (c.reservaRevisao < 1) {
      throw new RangeError('remarcação exige reserva com revisão maior ou igual a 1');
    }
    revisao = c.reservaRevisao;
  } else if (e.tipo === 'cancelamento') {
    revisao = c.reservaRevisao;
  }

  const decisao = decidirElegibilidade({
    tipo: e.tipo,
    clienteAnonimizada: c.clienteAnonimizada,
    telefone: c.telefone,
    consentimentoMensagens: c.consentimentoMensagens,
    consentimentoConvite: c.consentimentoConvite,
  });

  const { criada, mensagem } = await r.mensagens.inserir(
    ctx,
    decisao.acao === 'enviar'
      ? { reservaId: e.reservaId, tipo: e.tipo, revisao, estado: 'pendente', erroCodigo: null, destinatarioE164: c.telefone }
      : { reservaId: e.reservaId, tipo: e.tipo, revisao, estado: decisao.estado, erroCodigo: decisao.erroCodigo, destinatarioE164: null },
    agora,
  );

  if (criada && e.tipo === 'remarcacao') {
    await r.mensagens.substituirPendentes(
      ctx,
      { reservaId: e.reservaId, tipos: ['confirmacao', 'remarcacao'], revisaoMenorQue: revisao },
      agora,
    );
  } else if (criada && e.tipo === 'cancelamento') {
    await r.mensagens.substituirPendentes(
      ctx,
      { reservaId: e.reservaId, tipos: ['confirmacao', 'remarcacao'], revisaoMenorQue: null },
      agora,
    );
  }

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
