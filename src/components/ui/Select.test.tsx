/** @vitest-environment jsdom */
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select } from './Select';

const OPCOES = [
  { valor: 'a', rotulo: 'Ana' },
  { valor: 'b', rotulo: 'Bia', desabilitada: true },
];

describe('Select (CA-17, RN-9)', () => {
  it('select nativo com rótulo associado e opções', () => {
    render(<Select rotulo="Profissional" opcoes={OPCOES} />);
    const select = screen.getByLabelText('Profissional') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const opcoes = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(opcoes.map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ['a', 'Ana', false],
      ['b', 'Bia', true],
    ]);
  });

  it('textoVazio vira a 1ª opção com value=""', () => {
    render(<Select rotulo="Serviço" opcoes={OPCOES} textoVazio="Escolha…" />);
    const select = screen.getByLabelText('Serviço') as HTMLSelectElement;
    expect(select.options[0].value).toBe('');
    expect(select.options[0].textContent).toBe('Escolha…');
  });

  it('ajuda, erro, aria-invalid e obrigatório textual', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select rotulo="Fuso" opcoes={OPCOES} ajuda="Fuso do salão." erro="Escolha um fuso." obrigatorio ref={ref} />,
    );
    const select = screen.getByLabelText('Fuso (obrigatório)') as HTMLSelectElement;
    expect(ref.current).toBe(select);
    expect(select.required).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    const ids = select.getAttribute('aria-describedby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual([
      'Fuso do salão.',
      'Erro: Escolha um fuso.',
    ]);
  });

  it('sem ajuda nem erro não define aria-describedby', () => {
    render(<Select rotulo="Livre" opcoes={OPCOES} id="livre" defaultValue="a" />);
    const select = screen.getByLabelText('Livre') as HTMLSelectElement;
    expect(select.id).toBe('livre');
    expect(select.value).toBe('a');
    expect(select.hasAttribute('aria-describedby')).toBe(false);
  });
});
