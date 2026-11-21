/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { formatarMoeda } from '@/lib/format';

import Home from './page';

describe('Home (E9.1)', () => {
  it('mostra a marca como h1 dentro de main', () => {
    render(<Home />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Agenda Beleza' });
    expect(screen.getByRole('main').contains(h1)).toBe(true);
  });

  it('CA-9: preço e dias de teste vêm de plano.ts', () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain(`${formatarMoeda(PRECO_MENSAL_CENTAVOS)}/mês`);
    expect(screen.getByText(`${DIAS_TESTE} dias grátis`, { exact: false })).toBeTruthy();
    expect(formatarMoeda(PRECO_MENSAL_CENTAVOS)).toContain('79,00');
    const fonte = readFileSync('src/app/page.tsx', 'utf8');
    expect(fonte).not.toMatch(/79|30 dias/);
  });

  it('RN-10: informa que não há limite de profissionais', () => {
    render(<Home />);
    expect(screen.getByText('Sem limite de profissionais', { exact: false })).toBeTruthy();
  });

  it('CA-12: apresenta a página pública do salão e não cita concorrentes', () => {
    const { container } = render(<Home />);
    expect(container.textContent).toMatch(/avaliações verificadas/);
    expect(container.textContent).toMatch(/Perfil, fotos/);
    expect(container.textContent).not.toMatch(/Trinks|AppBarber|AppBeleza/i);
  });

  it('CA-13: links para cadastro, login, termos e privacidade', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: 'Criar conta do salão' }).getAttribute('href')).toBe('/cadastro');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect(screen.getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe('/termos');
    expect(screen.getByRole('link', { name: 'Política de Privacidade' }).getAttribute('href')).toBe('/privacidade');
  });
});
