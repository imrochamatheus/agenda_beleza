/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AcoesDaReserva } from './AcoesDaReserva';
import type { AcoesDaReservaProps } from './AcoesDaReserva';
import { estadoRemarcarInicial } from './estado';

// D-030 CA-13: só as ações que a máquina permite; cancelar em dois passos; encaixe e erros na resposta.
const valores = { data: '2026-12-01', hora: '10:00', profissionalId: 'p1', servicoIds: ['s1'], confirmarEncaixe: false };
const todas = { remarcar: true, cancelar: true, concluir: true, naoCompareceu: true };

function montar(p: Partial<AcoesDaReservaProps> = {}) {
  const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a) => a);
  const acaoCancelar = vi.fn<AcoesDaReservaProps['acaoCancelar']>(async (a) => a);
  const acaoMarcar = vi.fn<AcoesDaReservaProps['acaoMarcar']>(async (a) => a);
  render(
    <AcoesDaReserva
      reservaId="r1"
      resultado={null}
      acoes={todas}
      remarcar={{ valores, servicos: [{ id: 's1', rotulo: 'Corte' }, { id: 's2', rotulo: 'Escova' }], profissionais: [{ valor: 'p1', rotulo: 'Ana' }, { valor: 'p2', rotulo: 'Bia' }] }}
      acaoRemarcar={acaoRemarcar}
      acaoCancelar={acaoCancelar}
      acaoMarcar={acaoMarcar}
      {...p}
    />,
  );
  return { acaoRemarcar, acaoCancelar, acaoMarcar };
}

describe('AcoesDaReserva', () => {
  it('mostra só o que a máquina permite', () => {
    montar({ acoes: { remarcar: false, cancelar: false, concluir: false, naoCompareceu: false } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('antes do início: sem "marcar", com remarcar e cancelar', () => {
    montar({ acoes: { remarcar: true, cancelar: true, concluir: false, naoCompareceu: false } });
    expect(screen.queryByRole('button', { name: /Marcar como/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remarcar reserva' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar reserva' })).toBeTruthy();
  });

  it('só concluir/não compareceu quando é o que resta', () => {
    montar({ acoes: { remarcar: false, cancelar: false, concluir: false, naoCompareceu: true } });
    expect(screen.queryByRole('button', { name: 'Marcar como concluída' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Marcar como não compareceu' })).toBeTruthy();
  });

  it('resultado do PRG aparece como status', () => {
    montar({ resultado: 'cancelada', acoes: { remarcar: false, cancelar: false, concluir: false, naoCompareceu: false } });
    expect(screen.getByRole('status').textContent).toBe('Reserva cancelada.');
  });

  it('campos do remarcar vêm preenchidos; profissional fixo sem seletor', () => {
    montar({ remarcar: { valores, servicos: [{ id: 's1', rotulo: 'Corte' }], profissionais: null, profissionalFixo: 'Ana' } });
    expect((screen.getByLabelText('Nova data') as HTMLInputElement).value).toBe('2026-12-01');
    expect((screen.getByLabelText(/Nova hora/) as HTMLInputElement).value).toBe('10:00');
    expect((screen.getByRole('checkbox', { name: /Corte/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect((document.querySelector('input[name="profissionalId"]') as HTMLInputElement).value).toBe('p1');
  });

  it('cancelar em dois passos: confirmar → confirmação com "Manter reserva"; confirmar envia passo=cancelar', async () => {
    let chamada = 0;
    const acaoCancelar = vi.fn<AcoesDaReservaProps['acaoCancelar']>(async (_a, fd) => {
      chamada += 1;
      return { mensagem: null, confirmando: fd.get('passo') === 'confirmar' };
    });
    montar({ acaoCancelar });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    const botao = await screen.findByRole('button', { name: 'Confirmar cancelamento' });
    expect(screen.getByRole('button', { name: 'Manter reserva' })).toBeTruthy();
    expect((acaoCancelar.mock.calls[0][1] as FormData).get('passo')).toBe('confirmar');
    expect((acaoCancelar.mock.calls[0][1] as FormData).get('reservaId')).toBe('r1');
    fireEvent.click(botao);
    await waitFor(() => expect(chamada).toBe(2));
    expect((acaoCancelar.mock.calls[1][1] as FormData).get('passo')).toBe('cancelar');
  });

  it('mensagem do cancelamento e da situação aparecem como alerta, na resposta', async () => {
    montar({
      acaoCancelar: vi.fn(async () => ({ mensagem: 'A reserva já terminou.', confirmando: false })),
      acaoMarcar: vi.fn(async () => ({ mensagem: 'A reserva ainda não começou.' })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    expect(await screen.findByText('A reserva já terminou.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como concluída' }));
    expect(await screen.findByText('A reserva ainda não começou.')).toBeTruthy();
  });

  it('marcar envia a situação escolhida', async () => {
    const { acaoMarcar } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como concluída' }));
    await waitFor(() => expect(acaoMarcar).toHaveBeenCalled());
    expect((acaoMarcar.mock.calls[0][1] as FormData).get('para')).toBe('concluido');
    expect((acaoMarcar.mock.calls[0][1] as FormData).get('reservaId')).toBe('r1');
  });

  it('aviso de encaixe traz os motivos e a caixa de confirmação; a resposta preserva os dados', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a, fd) => ({
      ...a,
      valores: { ...a.valores, hora: String(fd.get('hora')) },
      motivos: ['fora_da_jornada', 'bloqueado'],
      mensagem: 'aviso',
    }));
    montar({ acaoRemarcar });
    fireEvent.change(screen.getByLabelText(/Nova hora/), { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar reserva' }));
    const alerta = await screen.findByText('Atenção: encaixe');
    expect(alerta.closest('[role="alert"]')!.textContent).toContain('Fora da jornada do profissional.');
    expect(alerta.closest('[role="alert"]')!.textContent).toContain('Horário bloqueado.');
    expect(screen.getByRole('checkbox', { name: 'Confirmo o encaixe' })).toBeTruthy();
    expect((screen.getByLabelText(/Nova hora/) as HTMLInputElement).value).toBe('20:00');
  });

  it('erros de campo viram resumo com links e foco', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a) => ({
      ...estadoRemarcarInicial(a.valores),
      erros: { servicos: 'Sem serviço.', data: 'Data inválida.', profissional: 'Sem profissional.' },
    }));
    montar({ acaoRemarcar });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar reserva' }));
    const resumo = await screen.findByText('Corrija os campos indicados para remarcar a reserva.');
    const caixa = resumo.closest('[role="alert"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(Array.from(caixa.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['#remarcar-servicos', '#remarcar-profissional', '#remarcar-data']);
  });

  it('mensagem geral da remarcação (ex.: horário indisponível) aparece sem resumo', async () => {
    montar({ acaoRemarcar: vi.fn(async (a) => ({ ...a, mensagem: 'Horário indisponível.' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar reserva' }));
    expect(await screen.findByText('Horário indisponível.')).toBeTruthy();
  });
});
