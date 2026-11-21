import { describe, expect, it, vi } from 'vitest';

import type { PortaWhatsApp } from '@/server/integrations/whatsapp/port';
import { ErroEnvioTemporario } from '@/server/integrations/whatsapp/port';
import { ErroReenvioAgendado } from '@/server/mensagens/tipos';
import type { RepoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { ResultadoInicio } from '@/server/repos/tipos';

import type { ContextoJob } from './tipos';
import { criarWhatsappReserva } from './whatsapp-reserva';

const ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const RESERVA = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

function ctx(tentativa: number, tentativasMaximas = 5) {
  const log = vi.fn<ContextoJob['log']>();
  const c: ContextoJob = { id: 'j', fila: 'whatsapp-reserva', tentativa, tentativasMaximas, agendadoPara: new Date(), sinal: new AbortController().signal, log };
  return { c, log };
}

function sistema(): { sistema: RepoMensagemSistema; fechamentos: unknown[] } {
  const fechamentos: unknown[] = [];
  const inicio: ResultadoInicio = {
    resultado: 'enviar', tentativaId: 't', numero: 1, destinatarioE164: '+5511987654321', tipo: 'confirmacao', revisao: 0, reservaId: RESERVA,
    contexto: {
      tipo: 'confirmacao', mensagemRevisao: 0, reservaId: RESERVA, reserva: { revisao: 0, status: 'confirmado', inicio: new Date('2026-11-25T13:00:00Z') },
      salaoNome: 'S', fuso: 'America/Sao_Paulo', profissionalNome: 'P', servicos: ['A'], clienteAnonimizada: false, telefone: '+5511987654321',
      consentimentoMensagens: true, consentimentoConvite: false,
    },
  };
  return {
    fechamentos,
    sistema: {
      localizar: async () => ({ salaoId: '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10', estado: 'pendente' }),
      iniciarEnvio: async () => inicio,
      concluirEnvio: async (_s, _i, _t, r) => {
        fechamentos.push(r);
        return true;
      },
      listarPendentesAntigas: async () => [],
      expirarEnviandoPresas: async () => 0,
    },
  };
}

describe('whatsapp-reserva (D-024)', () => {
  it('sucesso: conclui sem lançar e registra pelo log do contexto', async () => {
    const s = sistema();
    const porta: PortaWhatsApp = { enviarModelo: async () => ({ provedorMensagemId: 'w' }) };
    const h = criarWhatsappReserva({ sistema: s.sistema, whatsapp: () => porta });
    const { c, log } = ctx(1);
    await expect(h.processar({ mensagemId: ID }, c)).resolves.toBeUndefined();
    expect(s.fechamentos).toEqual([{ resultado: 'sucesso', provedorMensagemId: 'w' }]);
    expect(log).toHaveBeenCalledWith('mensagem.enviada', expect.objectContaining({ mensagemId: ID, estado: 'enviada' }));
  });

  it('falha temporária com tentativas restantes lança ErroReenvioAgendado (fixo, sem causa)', async () => {
    const s = sistema();
    const porta: PortaWhatsApp = { enviarModelo: async () => { throw new ErroEnvioTemporario('x'); } };
    const h = criarWhatsappReserva({ sistema: s.sistema, whatsapp: () => porta });
    const erro = await h.processar({ mensagemId: ID }, ctx(2, 5).c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroReenvioAgendado);
    expect((erro as Error).cause).toBeUndefined();
    expect((erro as Error).message).toBe('Reenvio agendado pelo backoff da fila.');
  });

  it('última tentativa (tentativa = máximo) não lança: a mensagem vai a falhou', async () => {
    const s = sistema();
    const porta: PortaWhatsApp = { enviarModelo: async () => { throw new ErroEnvioTemporario('x'); } };
    const h = criarWhatsappReserva({ sistema: s.sistema, whatsapp: () => porta });
    await expect(h.processar({ mensagemId: ID }, ctx(5, 5).c)).resolves.toBeUndefined();
    expect(s.fechamentos).toEqual([expect.objectContaining({ estadoFinal: 'falhou' })]);
  });

  it('usa o relógio e o log injetados e o contrato da fila', async () => {
    const s = sistema();
    const agora = new Date('2026-01-01T00:00:00Z');
    const log = vi.fn();
    const h = criarWhatsappReserva({ sistema: s.sistema, whatsapp: () => ({ enviarModelo: async () => ({ provedorMensagemId: 'w' }) }), agora: () => agora, log });
    await h.processar({ mensagemId: ID }, ctx(1).c);
    expect(log).toHaveBeenCalled();
    expect(h.fila).toBe('whatsapp-reserva');
    expect(h.politica).toBe('exclusive');
    expect(h.cron).toBeUndefined();
  });
});
