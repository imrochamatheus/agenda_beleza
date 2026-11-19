/** @vitest-environment jsdom */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button (CA-17, RN-9)', () => {
  it('type="button" por padrão e variante primária', () => {
    render(<Button>Salvar</Button>);
    const botao = screen.getByRole('button', { name: 'Salvar' });
    expect(botao.getAttribute('type')).toBe('button');
    expect(botao.className).toContain('primaria');
  });

  it.each(['secundaria', 'perigo', 'discreta'] as const)('aplica a variante %s', (variante) => {
    render(<Button variante={variante}>Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain(variante);
  });

  it('não envia formulário sem type="submit"; com submit envia', () => {
    const enviar = vi.fn((e: SubmitEvent) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={(e) => enviar(e.nativeEvent as SubmitEvent)}>
        <Button>Ação</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ação' }));
    expect(enviar).not.toHaveBeenCalled();
    rerender(
      <form onSubmit={(e) => enviar(e.nativeEvent as SubmitEvent)}>
        <Button type="submit">Ação</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ação' }));
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('chama onClick quando habilitado', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ir</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ocupado: disabled, aria-busy="true" e rótulo legível; clique não chama onClick', () => {
    const onClick = vi.fn();
    render(
      <Button ocupado rotuloOcupado="Salvando…" onClick={onClick}>
        Salvar
      </Button>,
    );
    const botao = screen.getByRole('button', { name: 'Salvando…' });
    expect(botao).toHaveProperty('disabled', true);
    expect(botao.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(botao);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ocupado usa "Aguarde…" por padrão', () => {
    render(<Button ocupado>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeTruthy();
  });

  it('disabled nativo não chama onClick', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Parado
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Parado' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('D-10: desabilitadoFocavel continua focável, aria-disabled e bloqueia clique e envio', () => {
    const onClick = vi.fn();
    const enviar = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <Button type="submit" desabilitadoFocavel onClick={onClick}>
          Enviar
        </Button>
      </form>,
    );
    const botao = screen.getByRole('button', { name: 'Enviar' });
    expect(botao).toHaveProperty('disabled', false);
    expect(botao.getAttribute('aria-disabled')).toBe('true');
    botao.focus();
    expect(document.activeElement).toBe(botao);
    const evento = fireEvent.click(botao);
    expect(evento).toBe(false); // preventDefault
    expect(onClick).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('repassa atributos nativos, ref e aria-label (ícone sem texto)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} aria-label="Fechar" name="acao" value="fechar" className="extra">
        <svg aria-hidden="true" />
      </Button>,
    );
    const botao = screen.getByRole('button', { name: 'Fechar' });
    expect(ref.current).toBe(botao);
    expect(botao.getAttribute('name')).toBe('acao');
    expect(botao.className).toContain('extra');
    expect(botao.hasAttribute('aria-disabled')).toBe(false);
    expect(botao.hasAttribute('aria-busy')).toBe(false);
  });
});
