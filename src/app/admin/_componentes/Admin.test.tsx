/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AntesDepois, JsonLegivel, MAX_CAMPOS_MOSTRADOS, MAX_VALOR } from './AntesDepois';
import { CampoDeSalao, FiltrosGet, PaginacaoAdmin, ResumoDaLista } from './FiltrosGet';
import { SeloDeEstado } from './SeloDeEstado';
import { avisoDeFusoGlobal, quandoGlobal, quandoNoFuso } from './quando';

afterEach(cleanup);

describe('SeloDeEstado (D-045)', () => {
  it('ícone decorativo + texto num <span>; cada forma desenha um svg aria-hidden', () => {
    const { container } = render(
      <>
        {(['circulo', 'relogio', 'triangulo', 'traco', 'cadeado'] as const).map((f) => (
          <SeloDeEstado key={f} forma={f} variante="erro">
            Texto {f}
          </SeloDeEstado>
        ))}
      </>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(5);
    for (const s of svgs) expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('span > span')).toHaveLength(5);
    expect(screen.getByText('Texto triangulo')).toBeTruthy();
  });
});

describe('FiltrosGet, campo de salão e paginação', () => {
  it('formulário GET nomeado; "Limpar filtros" só com filtro ativo; campos ocultos', () => {
    const { container, rerender } = render(
      <FiltrosGet rotulo="Filtrar x" base="/admin/x?vista=a" ativo={false} ocultos={{ vista: 'a' }}>
        <span>campo</span>
      </FiltrosGet>,
    );
    const form = screen.getByRole('search', { name: 'Filtrar x' });
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/admin/x');
    expect((container.querySelector('input[name="vista"]') as HTMLInputElement).value).toBe('a');
    expect(screen.queryByRole('link', { name: 'Limpar filtros' })).toBeNull();
    rerender(
      <FiltrosGet rotulo="Filtrar x" base="/admin/x" ativo>
        <span>campo</span>
      </FiltrosGet>,
    );
    expect(screen.getByRole('link', { name: 'Limpar filtros' }).getAttribute('href')).toBe('/admin/x');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeTruthy();
  });

  it('ResumoDaLista é aria-live polite', () => {
    render(<ResumoDaLista texto="3 de 3 mensagens" />);
    expect(screen.getByText('3 de 3 mensagens').getAttribute('aria-live')).toBe('polite');
  });

  it('CampoDeSalao: select com "Todos" e as opções; modo código vira campo de texto', () => {
    const { rerender } = render(<CampoDeSalao filtro={{ modo: 'select', opcoes: [{ id: 'a', nome: 'Aurora' }] }} valor="a" />);
    const sel = screen.getByRole('combobox', { name: 'Salão' }) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Todos', 'Aurora']);
    expect(sel.value).toBe('a');
    rerender(<CampoDeSalao filtro={{ modo: 'codigo' }} valor="xyz" />);
    expect((screen.getByRole('textbox', { name: 'Código do salão' }) as HTMLInputElement).value).toBe('xyz');
  });

  it('PaginacaoAdmin: nada com uma página; Anterior/Próxima nos extremos', () => {
    const href = (p: number) => `/x?pagina=${p}`;
    const { container, rerender } = render(<PaginacaoAdmin pagina={1} paginas={1} href={href} />);
    expect(container.firstChild).toBeNull();
    rerender(<PaginacaoAdmin pagina={1} paginas={3} href={href} />);
    expect(screen.queryByRole('link', { name: 'Anterior' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/x?pagina=2');
    rerender(<PaginacaoAdmin pagina={3} paginas={3} href={href} />);
    expect(screen.getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/x?pagina=2');
    expect(screen.queryByRole('link', { name: 'Próxima' })).toBeNull();
    expect(screen.getByText('Página 3 de 3')).toBeTruthy();
  });
});

describe('AntesDepois e JsonLegivel (CA-8/R-3)', () => {
  it('ambos nulos: "Sem detalhes", sem <details>', () => {
    const { container } = render(<AntesDepois antes={null} depois={null} />);
    expect(screen.getByText('Sem detalhes')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
  });

  it('diff por campo com Antes/Depois em texto, "Sem mudança", lado único e (vazio)', () => {
    const { container } = render(
      <AntesDepois antes={{ a: 1, igual: 'x', so_antes: true, n: null }} depois={{ a: 2, igual: 'x', so_depois: { k: 1 }, n: 'v' }} />,
    );
    expect(screen.getByText('Ver alterações (5 campos)')).toBeTruthy();
    const texto = container.textContent ?? '';
    expect(texto).toContain('Antes: 1');
    expect(texto).toContain('Depois: 2');
    expect(texto).toContain('Sem mudança: x');
    expect(texto).toContain('Antes: true');
    expect(texto).toContain('Depois: {"k":1}');
    expect(texto).toContain('Antes: (vazio)');
    expect(texto).toContain('Ver JSON completo');
  });

  it('um campo: singular; valor com HTML é texto; valor enorme é cortado no diff', () => {
    const { container } = render(<AntesDepois antes={{ m: '<b>x</b>', g: 'z'.repeat(5000) }} depois={null} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/Ver alterações \(2 campos\)/)).toBeTruthy();
    const dd = Array.from(container.querySelectorAll('dd')).map((d) => d.textContent ?? '');
    expect(dd.some((t) => t.includes('<b>x</b>'))).toBe(true);
    expect(dd.find((t) => t.includes('zzz'))!.length).toBeLessThan(MAX_VALOR + 60);
    cleanup();
    render(<AntesDepois antes={{ a: 1 }} depois={{ a: 1 }} />);
    expect(screen.getByText('Ver alterações (1 campo)')).toBeTruthy();
  });

  it('mais de 30 campos: mostra 30 e o aviso', () => {
    const muitos = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`c${i}`, i]));
    const { container } = render(<AntesDepois antes={muitos} depois={null} />);
    expect(container.querySelectorAll('.campo, [class*="campo"]').length).toBeGreaterThanOrEqual(MAX_CAMPOS_MOSTRADOS);
    expect(screen.getByText('e mais 5 campos (veja o JSON completo)')).toBeTruthy();
  });

  it('JsonLegivel: campos e JSON completo; valor que não é objeto só mostra o JSON; mais de 30 avisa', () => {
    const { container } = render(<JsonLegivel valor={{ id: 'p1', nota: '<script>x</script>' }} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Ver payload')).toBeTruthy();
    expect(within(container).getByText('<script>x</script>')).toBeTruthy();
    cleanup();
    const { container: c2 } = render(<JsonLegivel valor="texto solto" rotulo="Ver" />);
    expect(c2.querySelector('dl')).toBeNull();
    expect(c2.querySelector('pre')!.textContent).toContain('texto solto');
    cleanup();
    render(<JsonLegivel valor={Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]))} />);
    expect(screen.getByText('e mais 3 campos (veja o JSON completo)')).toBeTruthy();
  });
});

describe('datas do admin (format.ts, fuso do salão ou São Paulo)', () => {
  it('global: America/Sao_Paulo com deslocamento; do salão: o fuso dele', () => {
    expect(quandoGlobal('2026-11-21T17:05:00Z')).toBe('21/11/2026 14:05 (UTC−03:00)');
    expect(quandoNoFuso('2026-11-21T17:05:00Z', 'America/Manaus')).toBe('21/11/2026 13:05');
    expect(avisoDeFusoGlobal(new Date('2026-11-21T17:05:00Z'))).toBe('Horários em America/Sao_Paulo (UTC−03:00).');
  });
});
