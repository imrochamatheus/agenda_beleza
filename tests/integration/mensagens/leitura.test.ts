import { describe, expect, it } from 'vitest';

import { mensagensDaReserva } from '@/server/mensagens/leitura';

import { anonimizarCliente, criarCenarioMensagem, criarMensagem } from '../../support/mensagens';

import { ctxDo } from './apoio';

// D-024 T-7: CA-22 (mensagensDaReserva para a E7.3).

describe('CA-22: situação de envio da reserva', () => {
  it('devolve os campos da RN-23, por criado_em, sem destinatário, parâmetros nem provedor', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    const t = (min: number) => new Date(Date.UTC(2026, 10, 21, 10, min));
    const enviada = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0, estado: 'enviada', enviadaEm: t(1), provedorMensagemId: 'wamid.SEGREDO', destinatarioE164: s.telefone, atualizadoEm: t(1), tentativas: [{ resultado: 'sucesso', iniciadaEm: t(1) }] });
    const falhou = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'falhou', erroCodigo: 'resultado_incerto', atualizadoEm: t(5), tentativas: [{ resultado: 'falha', erroCodigo: 'x', iniciadaEm: t(4) }, { resultado: 'falha', erroCodigo: 'resultado_incerto', iniciadaEm: t(5) }] });
    const nao = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 1, estado: 'nao_enviada', erroCodigo: 'sem_consentimento', atualizadoEm: t(9) });
    const lista = await mensagensDaReserva(ctxDo(s), s.reservaId);
    expect(lista).toEqual([
      { id: enviada, tipo: 'confirmacao', revisao: 0, estado: 'enviada', enviadaEm: t(1), erroCodigo: null, tentativas: 1, ultimaTentativaEm: t(1) },
      { id: falhou, tipo: 'remarcacao', revisao: 1, estado: 'falhou', enviadaEm: null, erroCodigo: 'resultado_incerto', tentativas: 2, ultimaTentativaEm: t(5) },
      { id: nao, tipo: 'cancelamento', revisao: 1, estado: 'nao_enviada', enviadaEm: null, erroCodigo: 'sem_consentimento', tentativas: 0, ultimaTentativaEm: null },
    ]);
    const texto = JSON.stringify(lista);
    expect(texto).not.toContain('SEGREDO');
    expect(texto).not.toContain(s.telefone);
    for (const campo of ['destinatario', 'parametros', 'provedor']) expect(texto.toLowerCase()).not.toContain(campo);
  });

  it('reserva sem mensagens → lista vazia; cliente anonimizada continua funcionando', async () => {
    const s = await criarCenarioMensagem();
    expect(await mensagensDaReserva(ctxDo(s), s.reservaId)).toEqual([]);
    await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviada' });
    await anonimizarCliente(s.clienteId);
    expect(await mensagensDaReserva(ctxDo(s), s.reservaId)).toHaveLength(1);
  });

  it('id malformado → NaoEncontrado', async () => {
    const s = await criarCenarioMensagem();
    await expect(mensagensDaReserva(ctxDo(s), 'nao-uuid')).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });
});
