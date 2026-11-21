/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TEXTO_CONFIRMACAO_EXCLUSAO } from '@/server/clientes/tipos';

import { ConfirmarExclusaoCliente } from './ConfirmarExclusaoCliente';

// D-031 CA-13: a confirmação diz o que acontece, não executa sozinha, foca o título e cancela por link.

function montar(acao = vi.fn(async () => {})) {
  render(<ConfirmarExclusaoCliente acao={acao} clienteId="uuid-9" nome="Maria Souza" hrefCancelar="/painel/clientes/uuid-9" />);
  return acao;
}

describe('ConfirmarExclusaoCliente', () => {
  it('título focado, nome da cliente, todas as consequências e irreversibilidade', () => {
    montar();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Excluir cliente' });
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Maria Souza').tagName).toBe('STRONG');
    for (const t of TEXTO_CONFIRMACAO_EXCLUSAO.oQueAcontece) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText(/irreversível/)).toBeTruthy();
    expect(screen.getByText(/não receberá mais avisos/)).toBeTruthy();
  });

  it('o formulário leva só o clienteId; Confirmar é submit; Cancelar é link para o detalhe e não envia', () => {
    const acao = montar();
    const confirmar = screen.getByRole('button', { name: 'Confirmar exclusão' }) as HTMLButtonElement;
    expect(confirmar.type).toBe('submit');
    const form = confirmar.form as HTMLFormElement;
    expect(Array.from(new FormData(form).entries())).toEqual([['clienteId', 'uuid-9']]);
    const cancelar = screen.getByRole('link', { name: 'Cancelar' });
    expect(cancelar.getAttribute('href')).toBe('/painel/clientes/uuid-9');
    expect(form.contains(cancelar)).toBe(true);
    expect(acao).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
