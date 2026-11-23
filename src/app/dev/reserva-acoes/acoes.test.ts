import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoCancelarTodosInicial, estadoDoItemInicial, estadoRemarcarInicial } from '@/app/painel/agenda/reservas/[id]/estado';

import { demonstrarCancelarAcao, demonstrarCancelarTodosAcao, demonstrarMarcarAcao, demonstrarRemarcarAcao } from './acoes';
import { idDaReservaDemo } from './demonstracao';

// D-030/D-050: as ações de demonstração só validam; desligada a vitrine, não processam nada. PRG na mesma vista.
afterEach(() => vi.unstubAllEnvs());

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const redireciona = (destino: string) => ({ digest: expect.stringContaining(`NEXT_REDIRECT;replace;${destino}`) });
const valores = { servicoId: '', profissionalId: '', data: '', hora: '', confirmarEncaixe: false };
const futura = idDaReservaDemo('futura');
const iniciada = idDaReservaDemo('iniciada');

describe('ações de /dev/reserva-acoes', () => {
  it('vitrine desligada: devolvem o estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const r = estadoRemarcarInicial(null, valores);
    expect(await demonstrarRemarcarAcao(r, formulario({}))).toBe(r);
    expect(await demonstrarCancelarAcao(estadoDoItemInicial, formulario({}))).toBe(estadoDoItemInicial);
    expect(await demonstrarMarcarAcao(estadoDoItemInicial, formulario({ destino: 'concluido' }))).toBe(estadoDoItemInicial);
    expect(await demonstrarCancelarTodosAcao(estadoCancelarTodosInicial, formulario({}))).toBe(estadoCancelarTodosInicial);
  });

  it('remarcar: erros voltam no estado com o item; sucesso é PRG com o item e a hora anterior', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const e = await demonstrarRemarcarAcao(estadoRemarcarInicial(null, valores), formulario({ reservaId: futura, itemId: 'item-escova', hora: 'x' }));
    expect(e).toMatchObject({ itemId: 'item-escova', erros: { hora: expect.any(String) } });
    const fd = formulario({ reservaId: futura, itemId: 'item-escova', hora: '10:00', de: '09:00' });
    await expect(demonstrarRemarcarAcao(estadoRemarcarInicial(null, valores), fd)).rejects.toMatchObject(
      redireciona('/dev/reserva-acoes?vista=futura&resultado=remarcado&item=item-escova&de=09%3A00#resultado'),
    );
  });

  it('cancelar: item cancelável → PRG; item já cancelado → recusa na parada', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarCancelarAcao(estadoDoItemInicial, formulario({ reservaId: futura, itemId: 'item-manicure' }))).rejects.toMatchObject(
      redireciona('/dev/reserva-acoes?vista=futura&resultado=cancelado&item=item-manicure#resultado'),
    );
    expect(await demonstrarCancelarAcao(estadoDoItemInicial, formulario({ reservaId: futura, itemId: 'item-hidratacao' }))).toEqual({
      itemId: 'item-hidratacao',
      mensagem: 'Esta ação não é possível para a situação atual do serviço.',
    });
  });

  it('marcar: só o que a máquina permite agora', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarMarcarAcao(estadoDoItemInicial, formulario({ reservaId: iniciada, itemId: 'item-escova', destino: 'concluido' }))).rejects.toMatchObject(
      redireciona('/dev/reserva-acoes?vista=iniciada&resultado=concluido&item=item-escova#resultado'),
    );
    await expect(demonstrarMarcarAcao(estadoDoItemInicial, formulario({ reservaId: iniciada, itemId: 'item-escova', destino: 'nao_compareceu' }))).rejects.toMatchObject(
      redireciona('/dev/reserva-acoes?vista=iniciada&resultado=nao_compareceu&item=item-escova#resultado'),
    );
    expect((await demonstrarMarcarAcao(estadoDoItemInicial, formulario({ reservaId: futura, itemId: 'item-escova', destino: 'concluido' }))).mensagem).toBe(
      'Só é possível marcar o resultado depois do início do serviço.',
    );
    expect((await demonstrarMarcarAcao(estadoDoItemInicial, formulario({ reservaId: futura, itemId: 'x', destino: 'cancelado' }))).mensagem).toBe(
      'Esta ação não é possível para a situação atual do serviço.',
    );
  });

  it('cancelar todos: PRG com a quantidade; sem cancelável → recusa', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarCancelarTodosAcao(estadoCancelarTodosInicial, formulario({ reservaId: futura }))).rejects.toMatchObject(
      redireciona('/dev/reserva-acoes?vista=futura&resultado=todos_cancelados&n=2#resultado'),
    );
    expect(await demonstrarCancelarTodosAcao(estadoCancelarTodosInicial, formulario({ reservaId: idDaReservaDemo('cancelada') }))).toEqual({
      mensagem: 'Nenhum serviço desta reserva pode ser cancelado agora.',
    });
  });
});
