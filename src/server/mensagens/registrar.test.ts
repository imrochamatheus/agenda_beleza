import { describe, expect, it, vi } from 'vitest';

import type { Repos } from '@/server/repos';
import type { ContextoDeRegistroDTO, NovaMensagem } from '@/server/repos/tipos';
import { contextoDeSistema } from '@/server/tenant/context';

import { registrarMensagem } from './registrar';
import type { TipoMensagem } from './tipos';

const SALAO = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';
const RESERVA = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const ctx = contextoDeSistema(SALAO, 'teste');
const AGORA = new Date('2026-11-21T12:00:00Z');

function montar(c: Partial<ContextoDeRegistroDTO> = {}, criada = true) {
  const chamadas: string[] = [];
  const inseridas: NovaMensagem[] = [];
  const mensagens = {
    contextoDeRegistro: vi.fn(async () => {
      chamadas.push('contexto');
      return { reservaRevisao: 0, reservaStatus: 'confirmado', clienteAnonimizada: false, telefone: '+5511987654321', consentimentoMensagens: true, consentimentoConvite: true, ...c } as ContextoDeRegistroDTO;
    }),
    inserir: vi.fn(async (_c: unknown, d: NovaMensagem) => {
      chamadas.push('inserir');
      inseridas.push(d);
      return { criada, mensagem: { id: 'm1', reservaId: d.reservaId, tipo: d.tipo, revisao: d.revisao, estado: d.estado, erroCodigo: d.erroCodigo } };
    }),
    substituirPendentes: vi.fn(async () => {
      chamadas.push('substituir');
      return 0;
    }),
  };
  return { r: { mensagens } as unknown as Repos, mensagens, chamadas, inseridas };
}
const registrar = (m: ReturnType<typeof montar>, tipo: TipoMensagem) => registrarMensagem(ctx, { reservaId: RESERVA, tipo }, AGORA, m.r);

describe('registrarMensagem: revisão derivada (RN-2, A-2)', () => {
  it.each([
    ['confirmacao', 3, 0],
    ['convite_avaliacao', 3, 0],
    ['remarcacao', 3, 3],
    ['cancelamento', 3, 3],
    ['cancelamento', 0, 0],
  ] as const)('%s com reserva.revisao=%d grava revisão %d', async (tipo, reservaRevisao, esperada) => {
    const m = montar({ reservaRevisao });
    const r = await registrar(m, tipo);
    expect(m.inseridas[0]).toMatchObject({ tipo, revisao: esperada, estado: 'pendente', destinatarioE164: '+5511987654321' });
    expect(r).toEqual({ criada: true, mensagemId: 'm1', tipo, revisao: esperada, estado: 'pendente', chave: `${RESERVA}:${tipo}:${esperada}`, precisaEnfileirar: true });
  });

  it('remarcação com reserva.revisao 0 é erro de programação', async () => {
    const m = montar({ reservaRevisao: 0 });
    await expect(registrar(m, 'remarcacao')).rejects.toThrow(RangeError);
    expect(m.mensagens.inserir).not.toHaveBeenCalled();
  });
});

describe('registrarMensagem: elegibilidade (RN-8; CA-13, CA-14)', () => {
  it('sem consentimento → nao_enviada sem telefone e sem enfileirar', async () => {
    const m = montar({ consentimentoMensagens: false });
    const r = await registrar(m, 'confirmacao');
    expect(m.inseridas[0]).toEqual({ reservaId: RESERVA, tipo: 'confirmacao', revisao: 0, estado: 'nao_enviada', erroCodigo: 'sem_consentimento', destinatarioE164: null });
    expect(r).toMatchObject({ estado: 'nao_enviada', precisaEnfileirar: false, criada: true });
  });

  it('cliente anonimizada → cancelada_anonimizacao', async () => {
    const m = montar({ clienteAnonimizada: true, telefone: null });
    const r = await registrar(m, 'cancelamento');
    expect(m.inseridas[0]).toMatchObject({ estado: 'cancelada_anonimizacao', destinatarioE164: null, erroCodigo: null });
    expect(r.precisaEnfileirar).toBe(false);
  });

  it('convite: só a finalidade do convite vale', async () => {
    const m = montar({ consentimentoMensagens: true, consentimentoConvite: false });
    expect((await registrar(m, 'convite_avaliacao')).estado).toBe('nao_enviada');
  });
});

describe('registrarMensagem: substituição (RN-7, A-7) e idempotência', () => {
  it('remarcação N substitui confirmação e remarcação com revisão < N, depois do INSERT', async () => {
    const m = montar({ reservaRevisao: 2 });
    await registrar(m, 'remarcacao');
    expect(m.chamadas).toEqual(['contexto', 'inserir', 'substituir']);
    expect(m.mensagens.substituirPendentes).toHaveBeenCalledWith(ctx, { reservaId: RESERVA, tipos: ['confirmacao', 'remarcacao'], revisaoMenorQue: 2 }, AGORA);
  });

  it('cancelamento substitui confirmação e remarcação de qualquer revisão', async () => {
    const m = montar({ reservaRevisao: 2 });
    await registrar(m, 'cancelamento');
    expect(m.mensagens.substituirPendentes).toHaveBeenCalledWith(ctx, { reservaId: RESERVA, tipos: ['confirmacao', 'remarcacao'], revisaoMenorQue: null }, AGORA);
  });

  it.each(['confirmacao', 'convite_avaliacao'] as const)('%s não substitui nada', async (tipo) => {
    const m = montar();
    await registrar(m, tipo);
    expect(m.mensagens.substituirPendentes).not.toHaveBeenCalled();
  });

  it('linha já existente (criada=false): não substitui e não manda enfileirar', async () => {
    const m = montar({ reservaRevisao: 1 }, false);
    const r = await registrar(m, 'remarcacao');
    expect(m.mensagens.substituirPendentes).not.toHaveBeenCalled();
    expect(r).toMatchObject({ criada: false, precisaEnfileirar: false });
  });
});
