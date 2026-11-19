/** @vitest-environment jsdom */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Field } from './Field';

describe('Field (CA-17, RN-9)', () => {
  it('rótulo associado e type text por padrão', () => {
    render(<Field rotulo="Nome" name="nome" autoComplete="name" />);
    const input = screen.getByLabelText('Nome') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.name).toBe('nome');
    expect(input.getAttribute('autocomplete')).toBe('name');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it.each(['email', 'password', 'tel', 'number', 'date'] as const)('tipo %s', (tipo) => {
    render(<Field rotulo="Campo" tipo={tipo} />);
    expect((screen.getByLabelText('Campo') as HTMLInputElement).type).toBe(tipo);
  });

  it('ajuda e erro em aria-describedby, aria-invalid e "Erro:" visível', () => {
    render(<Field rotulo="E-mail" tipo="email" ajuda="Usado para avisos." erro="Informe um e-mail válido." />);
    const input = screen.getByLabelText('E-mail');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])!.textContent).toBe('Usado para avisos.');
    expect(document.getElementById(ids[1])!.textContent).toBe('Erro: Informe um e-mail válido.');
    expect(screen.getByText('Erro:').tagName).toBe('STRONG');
  });

  it('obrigatório: required e texto no rótulo', () => {
    render(<Field rotulo="Nome" obrigatorio />);
    const input = screen.getByLabelText('Nome (obrigatório)') as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it('texto de obrigatório sobrescrevível e required nativo também aceito', () => {
    render(<Field rotulo="Nome" obrigatorio textoObrigatorio="exigido" />);
    expect(screen.getByLabelText('Nome (exigido)')).toBeTruthy();
    render(<Field rotulo="Apelido" required />);
    expect((screen.getByLabelText('Apelido') as HTMLInputElement).required).toBe(true);
  });

  it('usa o id recebido e junta o aria-describedby do consumidor', () => {
    render(<Field rotulo="Telefone" id="tel" erro="Inválido" aria-describedby="dica-externa" />);
    const input = screen.getByLabelText('Telefone');
    expect(input.id).toBe('tel');
    expect(input.getAttribute('aria-describedby')).toBe('tel-erro dica-externa');
  });

  it('controlado e não controlado, com ref', () => {
    const ref = createRef<HTMLInputElement>();
    const aoMudar = vi.fn();
    render(<Field rotulo="Controlado" value="a" onChange={aoMudar} />);
    fireEvent.change(screen.getByLabelText('Controlado'), { target: { value: 'ab' } });
    expect(aoMudar).toHaveBeenCalledTimes(1);
    render(<Field rotulo="Livre" defaultValue="x" ref={ref} inputMode="tel" />);
    expect(ref.current).toBe(screen.getByLabelText('Livre'));
    expect(ref.current!.value).toBe('x');
    expect(ref.current!.getAttribute('inputmode')).toBe('tel');
  });
});
