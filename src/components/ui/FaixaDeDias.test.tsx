/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FaixaDeDias, type DiaDaFaixaDeDias, type FaixaDeDiasProps } from './FaixaDeDias';

const dia = (n: number, extra: Partial<DiaDaFaixaDeDias> = {}): DiaDaFaixaDeDias => ({
  chave: `2026-12-${String(n).padStart(2, '0')}`,
  semana: 'Ter',
  dia: String(n),
  mes: 'dez',
  rotulo: `Terça-feira, ${String(n).padStart(2, '0')}/12/2026`,
  href: `/salao?data=2026-12-${String(n).padStart(2, '0')}#reservar`,
  atual: false,
  ...extra,
});

const BASE: FaixaDeDiasProps = {
  idTitulo: 'reservar-dia',
  titulo: 'Escolha o dia',
  periodo: '01/12/2026 a 07/12/2026',
  dias: [1, 2, 3, 4, 5, 6, 7].map((n) => dia(n)),
  anterior: { href: '/salao?de=2026-11-24#reservar', rotulo: 'Semana anterior' },
  proxima: { href: '/salao?de=2026-12-08#reservar', rotulo: 'Próxima semana' },
  rotuloNavegacao: 'Semanas',
  apoio: 'Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele.',
};

describe('FaixaDeDias (D-051 §3.5)', () => {
  it('título h3, período e a lista nomeada pelos dois; um item por dia', () => {
    render(<FaixaDeDias {...BASE} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Escolha o dia' }).id).toBe('reservar-dia');
    expect(document.getElementById('reservar-dia-periodo')?.textContent).toBe('01/12/2026 a 07/12/2026');
    const lista = screen.getByRole('list', { name: 'Escolha o dia 01/12/2026 a 07/12/2026' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText(BASE.apoio!)).toBeTruthy();
  });

  it('dia com horário é link com o rótulo completo; três linhas visíveis ficam aria-hidden', () => {
    render(<FaixaDeDias {...BASE} />);
    const link = screen.getByRole('link', { name: 'Terça-feira, 01/12/2026' });
    expect(link.getAttribute('href')).toBe('/salao?data=2026-12-01#reservar');
    const ocultos = link.querySelectorAll('[aria-hidden="true"]');
    expect([...ocultos].map((s) => s.textContent)).toEqual(['Ter', '1', 'dez']);
    expect(link.hasAttribute('aria-current')).toBe(false);
  });

  it('dia sem horário é <span> fora do Tab, com o nome contendo "sem horários"', () => {
    const dias = [dia(1, { href: null, rotulo: 'Terça-feira, 01/12/2026, sem horários' }), dia(2)];
    render(<FaixaDeDias {...BASE} dias={dias} />);
    expect(screen.queryByRole('link', { name: /01\/12\/2026/ })).toBeNull();
    const texto = screen.getByText('Terça-feira, 01/12/2026, sem horários');
    const caixa = texto.parentElement!;
    expect(caixa.tagName).toBe('SPAN');
    expect(caixa.hasAttribute('tabindex')).toBe(false);
    // Com pelo menos um link, o invólucro não vira parada de Tab.
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(document.querySelector('[tabindex]')).toBeNull();
  });

  it('aria-current="date" no dia marcado, link ou span (marcado sem horário)', () => {
    const { unmount } = render(<FaixaDeDias {...BASE} dias={[dia(1), dia(2, { atual: true })]} />);
    expect(screen.getByRole('link', { name: 'Terça-feira, 02/12/2026' }).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('link', { name: 'Terça-feira, 01/12/2026' }).hasAttribute('aria-current')).toBe(false);
    unmount();
    render(<FaixaDeDias {...BASE} dias={[dia(1), dia(2, { atual: true, href: null, rotulo: 'X, sem horários' })]} />);
    const marcado = document.querySelector('[aria-current="date"]')!;
    expect(marcado.tagName).toBe('SPAN');
    expect(marcado.textContent).toContain('X, sem horários');
  });

  it('navegação: os dois links, só um ou nenhum (sem <nav>)', () => {
    const { unmount, rerender } = render(<FaixaDeDias {...BASE} />);
    const nav = screen.getByRole('navigation', { name: 'Semanas' });
    expect(within(nav).getByRole('link', { name: 'Semana anterior' }).getAttribute('href')).toBe(
      '/salao?de=2026-11-24#reservar',
    );
    expect(within(nav).getByRole('link', { name: 'Próxima semana' }).getAttribute('href')).toBe(
      '/salao?de=2026-12-08#reservar',
    );
    rerender(<FaixaDeDias {...BASE} anterior={null} />);
    expect(screen.queryByText('Semana anterior')).toBeNull();
    expect(screen.getByRole('link', { name: 'Próxima semana' })).toBeTruthy();
    rerender(<FaixaDeDias {...BASE} proxima={null} />);
    expect(screen.queryByText('Próxima semana')).toBeNull();
    rerender(<FaixaDeDias {...BASE} anterior={null} proxima={null} apoio={undefined} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText(BASE.apoio!)).toBeNull();
    unmount();
  });

  it('última semana com 5 dias: só 5 <li> (as colunas sobrando ficam vazias)', () => {
    render(<FaixaDeDias {...BASE} dias={[1, 2, 3, 4, 5].map((n) => dia(n))} proxima={null} />);
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('ol'))).toHaveLength(5);
  });

  it('semana sem nenhum link: o invólucro é um grupo focável nomeado pelo título e o período (C2)', () => {
    const dias = [1, 2, 3].map((n) => dia(n, { href: null, rotulo: `D${n}, sem horários` }));
    render(<FaixaDeDias {...BASE} dias={dias} className="extra" />);
    const grupo = screen.getByRole('group', { name: 'Escolha o dia 01/12/2026 a 07/12/2026' });
    expect(grupo.getAttribute('tabindex')).toBe('0');
    expect(screen.queryAllByRole('link').map((l) => l.textContent)).toEqual(['← Semana anterior', 'Próxima semana →']);
    expect(grupo.parentElement!.className).toContain('extra');
  });
});
