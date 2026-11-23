/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instalarDialogoFalso } from '../../../../tests/support/dialogo';

import { ESPERA_DEMORADA_MS, Vitrine } from './Vitrine';

let restaurar: () => void;
beforeEach(() => {
  restaurar = instalarDialogoFalso();
});
afterEach(() => {
  restaurar();
  vi.useRealTimers();
});

const contador = (id: string) => screen.getByTestId(id).textContent;
const botao = (nome: string) => screen.getByRole('button', { name: nome, hidden: true });

describe('Vitrine (RN-17)', () => {
  it('mostra as seções com h1/h2 e os exemplos exigidos', () => {
    render(<Vitrine />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vitrine de componentes' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Botões',
      'Campos',
      'Seleção',
      'Caixas de seleção',
      'Alertas',
      'Estados',
      'Lista de dados',
      'Grade de horários',
      'Roteiro do dia',
      'Diálogos',
    ]);
    const contato = screen.getByLabelText('E-mail de contato');
    expect(contato.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(contato.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Erro: Informe um e-mail válido.',
    );
    expect(screen.getByRole('button', { name: 'Salvando…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Agendar' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('table', { name: 'Serviços do salão' })).toBeTruthy();
    const celulas = screen.getAllByRole('cell').map((c) => c.lastElementChild!.textContent);
    expect(celulas).toContain('R$\u00a0420,00');
    expect(celulas).toContain('contato.muito.longo.para.testar.quebra@exemplo.com.br');
    expect(screen.getByRole('heading', { name: 'Nada por aqui ainda.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nenhum horário disponível nesta data.' })).toBeTruthy();
    const grade = screen.getByRole('group', { name: 'Horários de terça-feira, 10/03/2026' });
    expect(within(grade).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
    const repetida = screen.getByRole('group', { name: 'Horários de sábado, 16/02/2019' });
    expect(within(repetida).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      '23:00 (UTC−02:00)',
      '23:00 (UTC−03:00)',
    ]);
    expect(screen.getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe('/termos');
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(3);
  });

  it('escolher um horário mostra o horário no fuso do salão', () => {
    render(<Vitrine />);
    expect(screen.getByTestId('horario-escolhido').textContent).toBe('Horário escolhido: nenhum');
    fireEvent.click(screen.getByRole('radio', { name: '10:30' }));
    expect(screen.getByTestId('horario-escolhido').textContent).toBe('Horário escolhido: 10/03/2026 10:30');
  });

  it('D-050: duas grades de um serviço partilham o name, com prefixo por profissional e legenda discreta', () => {
    render(<Vitrine />);
    const p1 = screen.getByRole('group', { name: 'Horários de Profissional 1' });
    const p2 = screen.getByRole('group', { name: 'Horários de Profissional 2' });
    const valores = [p1, p2].flatMap((g) => within(g).getAllByRole('radio').map((r) => (r as HTMLInputElement).value));
    expect(valores).toEqual([
      'p1_2026-03-10T12:00:00.000Z',
      'p1_2026-03-10T12:30:00.000Z',
      'p2_2026-03-10T17:00:00.000Z',
      'p2_2026-03-10T17:30:00.000Z',
    ]);
    const nomes = [p1, p2].flatMap((g) => within(g).getAllByRole('radio').map((r) => (r as HTMLInputElement).name));
    expect(new Set(nomes)).toEqual(new Set(['h_escova']));
    expect(p1.querySelector('legend')!.className).toContain('legendaDiscreta');
  });

  it('D-050: roteiro do dia com os quatro estados, total e um link "Alterar" nomeado', () => {
    render(<Vitrine />);
    const secao = screen.getByRole('region', { name: 'Terça-feira, 10/03/2026' });
    const paradas = within(within(secao).getByRole('list', { name: 'Serviços do dia' })).getAllByRole('listitem');
    expect(paradas.map((p) => p.getAttribute('data-estado'))).toEqual(['escolhida', 'destaque', 'cancelada', 'pendente']);
    expect(within(secao).getByRole('link', { name: 'Alterar Escova às 09:00 com Profissional 1' })).toBeTruthy();
    expect(secao.querySelector('[class*="rodape"]')!.textContent).toBe('Total: R$\u00a0130,00');
  });

  it('"Tentar novamente" incrementa o contador', () => {
    render(<Vitrine />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(contador('contador-tentativas')).toBe('Tentativas: 2');
  });

  it('confirmação simples e de perigo: contadores de confirmado e cancelado', () => {
    render(<Vitrine />);
    fireEvent.click(botao('Abrir confirmação'));
    fireEvent.click(botao('Confirmar'));
    fireEvent.click(botao('Abrir confirmação de perigo'));
    const perigo = document.querySelectorAll('dialog')[1] as HTMLElement;
    expect(within(perigo).getByRole('button', { name: 'Excluir', hidden: true }).className).toContain('perigo');
    fireEvent.click(within(perigo).getByRole('button', { name: 'Cancelar', hidden: true }));
    expect(contador('contador-confirmado')).toBe('Confirmações: 1');
    expect(contador('contador-cancelado')).toBe('Cancelamentos: 1');
    expect([...document.querySelectorAll('dialog')].every((d) => !d.open)).toBe(true);
  });

  it('confirmação demorada: ocupada até a espera, depois confirma uma vez', async () => {
    vi.useFakeTimers();
    render(<Vitrine />);
    fireEvent.click(botao('Abrir confirmação demorada'));
    fireEvent.click(botao('Cancelar reserva'));
    expect(botao('Cancelando…')).toHaveProperty('disabled', true);
    await act(async () => {
      vi.advanceTimersByTime(ESPERA_DEMORADA_MS);
    });
    expect(contador('contador-confirmado')).toBe('Confirmações: 1');
    expect(document.querySelectorAll('dialog')[2].open).toBe(false);
  });

  it('confirmação que falha: continua aberta com o alerta; cancelar conta como cancelamento', async () => {
    render(<Vitrine />);
    fireEvent.click(botao('Abrir confirmação que falha'));
    await act(async () => {
      fireEvent.click(botao('Enviar'));
    });
    const dialogo = document.querySelectorAll('dialog')[3] as HTMLDialogElement;
    expect(dialogo.open).toBe(true);
    expect(within(dialogo).getByRole('alert', { hidden: true }).textContent).toBe(
      'Não foi possível concluir. Tente novamente.',
    );
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar', hidden: true }));
    expect(contador('contador-confirmado')).toBe('Confirmações: 0');
    expect(contador('contador-cancelado')).toBe('Cancelamentos: 1');
  });
});
