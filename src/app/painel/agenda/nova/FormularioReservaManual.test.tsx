/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoInicial, valoresVazios } from './estado';
import type { EstadoReservaManual } from './estado';
import { FormularioReservaManual } from './FormularioReservaManual';
import type { FormularioReservaManualProps } from './FormularioReservaManual';

// D-029 CA-5, CA-15, CA-16: campos, aviso de encaixe com a caixa de confirmação, erros e resultado.
const servicos = [{ id: 's1', rotulo: 'Corte · 1 h · R$ 120,00' }, { id: 's2', rotulo: 'Escova · 45 min · R$ 80,00' }];
const profissionais = [{ valor: 'p1', rotulo: 'Ana' }, { valor: 'p2', rotulo: 'Bia' }];
const base = estadoInicial('chave-1', valoresVazios({ profissionalId: 'p1', data: '2026-12-01', hora: '10:00' }));

function montar(estado: EstadoReservaManual, acao = vi.fn<FormularioReservaManualProps['acao']>(async (anterior) => anterior), fixo = false) {
  render(
    <FormularioReservaManual
      acao={acao}
      estadoInicial={estado}
      servicos={servicos}
      profissionais={fixo ? null : profissionais}
      profissionalFixo={fixo ? 'Ana' : undefined}
    />,
  );
  return acao;
}

describe('FormularioReservaManual', () => {
  it('campos, chave oculta, pré-preenchimento e consentimento opcional sem caixa de encaixe', () => {
    montar(base);
    expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('2026-12-01');
    expect((screen.getByLabelText(/Hora/) as HTMLInputElement).value).toBe('10:00');
    expect((screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement).value).toBe('p1');
    expect(screen.getByRole('checkbox', { name: /Corte/ })).toBeTruthy();
    const consent = screen.getByRole('checkbox', { name: /Termos de Uso/ }) as HTMLInputElement;
    expect(consent.required).toBe(false);
    expect(consent.name).toBe('consentimento_mensagens');
    expect(screen.queryByRole('checkbox', { name: 'Confirmo o encaixe' })).toBeNull();
    expect((document.querySelector('input[name="chave"]') as HTMLInputElement).value).toBe('chave-1');
  });

  it('profissional: sem seletor, o id vai em campo oculto', () => {
    montar(estadoInicial('k', valoresVazios({ profissionalId: 'p1' })), undefined, true);
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).toBeNull();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect((document.querySelector('input[name="profissionalId"]') as HTMLInputElement).value).toBe('p1');
  });

  it('aviso de encaixe: motivos listados, foco no aviso, caixa "Confirmo o encaixe" e dados preservados', async () => {
    montar({
      ...base,
      mensagem: 'Este horário está fora do horário normal de atendimento. Para registrar mesmo assim, confirme o encaixe.',
      motivos: ['fora_da_jornada', 'bloqueado'],
      valores: { ...base.valores, nome: 'Joana', servicoIds: ['s2'] },
    });
    const aviso = screen.getByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(aviso));
    expect(aviso.textContent).toContain('Fora da jornada do profissional.');
    expect(aviso.textContent).toContain('Horário bloqueado.');
    expect(screen.getByRole('checkbox', { name: 'Confirmo o encaixe' })).toBeTruthy();
    expect((screen.getByLabelText('Nome da cliente') as HTMLInputElement).value).toBe('Joana');
    expect((screen.getByRole('checkbox', { name: /Escova/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('erros: resumo focado com links para os campos e erro ligado a cada campo', async () => {
    montar({ ...base, erros: { nome: 'Informe o nome.', data: 'Data inválida.' } });
    const resumo = screen.getByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    const links = Array.from(resumo.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#reserva-data', '#reserva-nome']);
    expect((screen.getByLabelText('Nome da cliente') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('reserva criada: resultado focado com link para a agenda; encaixe e repetida', async () => {
    montar({ ...base, criada: { encaixe: true, repetida: false, hrefAgenda: '/painel/agenda?data=2026-12-01' } });
    const status = screen.getByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(status.textContent).toContain('Reserva registrada como encaixe.');
    expect(screen.getByRole('link', { name: 'Ver na agenda' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01');
  });

  it('erro geral e reserva repetida/comum', () => {
    montar({ ...base, mensagem: 'Este horário não está mais disponível. Escolha outro horário.' });
    expect(screen.getByRole('alert').textContent).toContain('não está mais disponível');
  });

  it('o envio chama a ação com os dados do formulário', async () => {
    const acao = montar(base);
    fireEvent.change(screen.getByLabelText('Nome da cliente'), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Corte/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar reserva' }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    const fd = acao.mock.calls[0][1];
    expect(fd.get('nome')).toBe('Maria');
    expect(fd.getAll('s')).toEqual(['s1']);
    expect(fd.get('chave')).toBe('chave-1');
  });
});
