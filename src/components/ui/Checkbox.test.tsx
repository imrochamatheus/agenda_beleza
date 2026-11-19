/** @vitest-environment jsdom */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox (CA-17, RN-9)', () => {
  it('input checkbox nativo com rótulo clicável (não controlado)', () => {
    render(<Checkbox rotulo="Receber novidades" />);
    const caixa = screen.getByLabelText('Receber novidades') as HTMLInputElement;
    expect(caixa.type).toBe('checkbox');
    expect(caixa.checked).toBe(false);
    fireEvent.click(screen.getByText('Receber novidades'));
    expect(caixa.checked).toBe(true);
  });

  it('rótulo com links (consentimento) e obrigatório textual', () => {
    render(
      <Checkbox
        obrigatorio
        rotulo={
          <>
            Li e aceito os <a href="/termos">Termos de Uso</a>
          </>
        }
      />,
    );
    const caixa = screen.getByRole('checkbox', { name: 'Li e aceito os Termos de Uso (obrigatório)' }) as HTMLInputElement;
    expect(caixa.required).toBe(true);
    expect(screen.getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe('/termos');
  });

  it('ajuda e erro ligados por aria-describedby, aria-invalid', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox rotulo="Aceito" ajuda="Necessário para agendar." erro="Marque para continuar." ref={ref} />);
    const caixa = screen.getByLabelText('Aceito');
    expect(ref.current).toBe(caixa);
    expect(caixa.getAttribute('aria-invalid')).toBe('true');
    const textos = caixa
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!.textContent);
    expect(textos).toEqual(['Necessário para agendar.', 'Erro: Marque para continuar.']);
  });

  it('controlado: chama onChange', () => {
    const aoMudar = vi.fn();
    render(<Checkbox rotulo="Controlada" checked={false} onChange={aoMudar} id="c1" />);
    const caixa = screen.getByLabelText('Controlada');
    expect(caixa.id).toBe('c1');
    fireEvent.click(caixa);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(caixa.hasAttribute('aria-describedby')).toBe(false);
  });
});
