/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataList, type Coluna } from './DataList';

type Servico = { id: string; nome: string; preco: string };
const COLUNAS: Coluna<Servico>[] = [
  { chave: 'nome', rotulo: 'Serviço', renderizar: (s) => s.nome },
  { chave: 'preco', rotulo: 'Preço', renderizar: (s) => <strong>{s.preco}</strong> },
];
const LINHAS: Servico[] = [
  { id: '1', nome: 'Corte', preco: 'R$ 50,00' },
  { id: '2', nome: 'Escova', preco: 'R$ 40,00' },
];

describe('DataList (CA-17, RN-20)', () => {
  it('tabela com caption, th scope="col" e as linhas', () => {
    render(<DataList legenda="Serviços" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(s) => s.id} />);
    const tabela = screen.getByRole('table', { name: 'Serviços' });
    const cabecalhos = within(tabela).getAllByRole('columnheader');
    expect(cabecalhos.map((c) => [c.textContent, c.getAttribute('scope')])).toEqual([
      ['Serviço', 'col'],
      ['Preço', 'col'],
    ]);
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas).toHaveLength(3);
    const celulas = within(linhas[1]).getAllByRole('cell');
    // Cada célula começa com o rótulo da coluna, oculto para leitores de tela.
    expect(celulas[0].firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(celulas[0].firstElementChild!.textContent).toBe('Serviço');
    expect(celulas[1].lastElementChild!.textContent).toBe('R$ 50,00');
  });

  it('legenda oculta visualmente continua como nome acessível', () => {
    render(
      <DataList legenda="Clientes" legendaVisivel={false} colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(s) => s.id} />,
    );
    const tabela = screen.getByRole('table', { name: 'Clientes' });
    expect(tabela.querySelector('caption')!.className).toBe('visualmente-oculto');
  });

  it('sem linhas: EmptyState padrão, sem tabela', () => {
    render(<DataList legenda="Serviços" colunas={COLUNAS} linhas={[]} chaveDaLinha={(s) => s.id} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nada por aqui ainda.' })).toBeTruthy();
  });

  it('sem linhas: vazio recebido por prop', () => {
    render(
      <DataList legenda="X" colunas={COLUNAS} linhas={[]} chaveDaLinha={(s) => s.id} vazio={<p>Sem serviços.</p>} />,
    );
    expect(screen.getByText('Sem serviços.')).toBeTruthy();
  });
});

describe('DataList: detalhe e classeCelula (D-045)', () => {
  it('sem `detalhe`, o DOM é o de sempre: uma <tr> por linha, nenhuma linha de detalhe', () => {
    const { container } = render(<DataList legenda="Serviços" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(s) => s.id} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelectorAll('td[colspan]')).toHaveLength(0);
  });

  it('`detalhe` cria <tr><td colSpan> logo abaixo da linha; null não cria', () => {
    const { container } = render(
      <DataList
        legenda="Serviços"
        colunas={COLUNAS}
        linhas={LINHAS}
        chaveDaLinha={(s) => s.id}
        detalhe={(s) => (s.id === '1' ? <p>Detalhe do corte</p> : null)}
      />,
    );
    const trs = Array.from(container.querySelectorAll('tbody tr'));
    expect(trs).toHaveLength(3);
    const td = trs[1].querySelector('td')!;
    expect(td.getAttribute('colspan')).toBe('2');
    expect(td.textContent).toBe('Detalhe do corte');
    expect(trs[0].querySelectorAll('td')).toHaveLength(2);
    expect(trs[2].textContent).toContain('Escova');
  });

  it('`classeCelula` vai só na célula da coluna', () => {
    const colunas: Coluna<Servico>[] = [COLUNAS[0], { ...COLUNAS[1], classeCelula: 'minha-classe' }];
    const { container } = render(<DataList legenda="X" colunas={colunas} linhas={LINHAS} chaveDaLinha={(s) => s.id} />);
    const tds = container.querySelectorAll('tbody tr:first-child td');
    expect(tds[0].className).not.toContain('minha-classe');
    expect(tds[1].className).toContain('minha-classe');
  });
});

