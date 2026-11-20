/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';

import { instalarDialogoFalso } from '../../../../tests/support/dialogo';

import { ControleAtivacao } from './ControleAtivacao';
import type { EstadoDesativacao } from './estado';

// D-013 T-5: CA-3 e CA-16 (desativar com ConfirmDialog, recusa anunciada, reativar por formulário).
// Tab real e Enter/Espaço nativos ficam no passo manual (sem user-event, D-013 §8).

let restaurar: () => void;
beforeEach(() => {
  restaurar = instalarDialogoFalso();
});
afterEach(() => {
  restaurar();
});

const semReativar = async () => {};

describe('ControleAtivacao (ativo)', () => {
  it('Desativar abre o diálogo com o foco em Cancelar; Esc fecha sem chamar a ação e devolve o foco', async () => {
    const desativar = vi.fn(async (): Promise<EstadoDesativacao> => ({ status: 'desativado' }));
    render(<ControleAtivacao id="p1" nome="Ana" ativo desativar={desativar} reativar={semReativar} />);
    const botao = screen.getByRole('button', { name: 'Desativar' });
    botao.focus();
    fireEvent.click(botao);
    const dialogo = await screen.findByRole('dialog', { name: 'Desativar Ana?' });
    expect(dialogo.hasAttribute('open')).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cancelar' })));
    // Ciclo de foco: Tab no último volta ao primeiro.
    const confirmar = within(dialogo).getByRole('button', { name: 'Desativar' });
    confirmar.focus();
    fireEvent.keyDown(dialogo, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    await waitFor(() => expect(dialogo.hasAttribute('open')).toBe(false));
    expect(desativar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(botao);
  });

  it('CA-3: recusa → diálogo fecha e a lista de reservas aparece em role="alert"', async () => {
    const desativar = vi.fn(
      async (): Promise<EstadoDesativacao> => ({
        status: 'recusado',
        reservas: [
          { id: 'r1', inicio: '2031-01-02T02:30:00.000Z', inicioLocal: '01/01/2031 23:30', servicos: ['Corte', 'Escova'], cliente: 'Clara' },
          { id: 'r2', inicio: '2031-01-03T15:00:00.000Z', inicioLocal: '03/01/2031 12:00', servicos: ['Escova'], cliente: 'cliente removida' },
        ],
      }),
    );
    render(<ControleAtivacao id="p1" nome="Ana" ativo desativar={desativar} reativar={semReativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    const dialogo = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Desativar' }));
    });
    const alerta = await screen.findByRole('alert');
    expect(desativar).toHaveBeenCalledWith('p1');
    expect(alerta.textContent).toContain(MENSAGENS_PROFISSIONAL.recusaDesativacao);
    expect(within(alerta).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '01/01/2031 23:30 — Corte, Escova — Clara',
      '03/01/2031 12:00 — Escova — cliente removida',
    ]);
    await waitFor(() => expect(dialogo.hasAttribute('open')).toBe(false));
  });

  it('erro da ação (ex.: acesso negado) aparece em role="alert"', async () => {
    const desativar = async (): Promise<EstadoDesativacao> => ({ status: 'erro', mensagem: MENSAGENS_PROFISSIONAL.acessoNegado });
    render(<ControleAtivacao id="p1" nome="Ana" ativo desativar={desativar} reativar={semReativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    const dialogo = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Desativar' }));
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado.');
  });

  it('sucesso: fecha o diálogo sem alerta', async () => {
    const desativar = async (): Promise<EstadoDesativacao> => ({ status: 'desativado' });
    render(<ControleAtivacao id="p1" nome="Ana" ativo desativar={desativar} reativar={semReativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    const dialogo = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Desativar' }));
    });
    await waitFor(() => expect(dialogo.hasAttribute('open')).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ControleAtivacao (inativo)', () => {
  it('formulário POST com id oculto e botão "Reativar"; sem diálogo', async () => {
    const reativar = vi.fn<(f: FormData) => Promise<void>>(async () => {});
    render(<ControleAtivacao id="p9" nome="Ana" ativo={false} desativar={vi.fn()} reativar={reativar} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const botao = screen.getByRole('button', { name: 'Reativar' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect((botao.form!.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('p9');
    fireEvent.click(botao);
    await waitFor(() => expect(reativar).toHaveBeenCalledTimes(1));
    expect(reativar.mock.calls[0][0].get('id')).toBe('p9');
  });
});
