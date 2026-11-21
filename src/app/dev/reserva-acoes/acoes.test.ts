import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoCancelarInicial, estadoMarcarInicial, estadoRemarcarInicial } from '@/app/painel/agenda/reservas/[id]/estado';

import { demonstrarCancelarAcao, demonstrarMarcarAcao, demonstrarRemarcarAcao } from './acoes';
import { ANA_DEMO, SERVICOS_DEMO } from '@/app/dev/reserva-nova/demonstracao';

// D-030: as ações de demonstração só validam; desligada a vitrine, não processam nada.
afterEach(() => vi.unstubAllEnvs());

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const redireciona = (destino: string) => ({ digest: expect.stringContaining(`NEXT_REDIRECT;replace;${destino}`) });
const valores = { data: '', hora: '', profissionalId: '', servicoIds: [], confirmarEncaixe: false };

describe('ações de /dev/reserva-acoes', () => {
  it('vitrine desligada: devolvem o estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const r = estadoRemarcarInicial(valores);
    expect(await demonstrarRemarcarAcao(r, formulario({}))).toBe(r);
    expect(await demonstrarCancelarAcao(estadoCancelarInicial, formulario({ passo: 'cancelar' }))).toBe(estadoCancelarInicial);
    expect(await demonstrarMarcarAcao(estadoMarcarInicial, formulario({ para: 'concluido' }))).toBe(estadoMarcarInicial);
  });

  it('remarcar: erros voltam no estado; sucesso é PRG', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const e = await demonstrarRemarcarAcao(estadoRemarcarInicial(valores), formulario({ data: 'x' }));
    expect(Object.keys(e.erros).length).toBeGreaterThan(0);
    const fd = formulario({ reservaId: 'x', data: '2099-12-01', hora: '10:00', profissionalId: ANA_DEMO.id, s: SERVICOS_DEMO[0].id });
    await expect(demonstrarRemarcarAcao(estadoRemarcarInicial(valores), fd)).rejects.toMatchObject(redireciona('/dev/reserva-acoes?resultado=remarcada'));
  });

  it('cancelar em dois passos', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(await demonstrarCancelarAcao(estadoCancelarInicial, formulario({ passo: 'confirmar' }))).toEqual({ mensagem: null, confirmando: true });
    expect(await demonstrarCancelarAcao(estadoCancelarInicial, formulario({ passo: 'voltar' }))).toEqual({ mensagem: null, confirmando: false });
    await expect(demonstrarCancelarAcao(estadoCancelarInicial, formulario({ passo: 'cancelar' }))).rejects.toMatchObject(redireciona('/dev/reserva-acoes?resultado=cancelada'));
  });

  it('marcar: destinos válidos redirecionam; inválido recusa', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarMarcarAcao(estadoMarcarInicial, formulario({ para: 'concluido' }))).rejects.toMatchObject(redireciona('/dev/reserva-acoes?resultado=concluida'));
    await expect(demonstrarMarcarAcao(estadoMarcarInicial, formulario({ para: 'nao_compareceu' }))).rejects.toMatchObject(redireciona('/dev/reserva-acoes?resultado=nao_compareceu'));
    expect((await demonstrarMarcarAcao(estadoMarcarInicial, formulario({ para: 'cancelado' }))).mensagem).toBeTruthy();
  });
});
