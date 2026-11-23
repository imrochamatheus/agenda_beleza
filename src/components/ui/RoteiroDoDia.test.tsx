/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RoteiroDoDia, type ParadaDoRoteiro } from './RoteiroDoDia';

const PARADAS: ParadaDoRoteiro[] = [
  {
    chave: 'a',
    hora: '09:00',
    fim: '10:00',
    servico: 'Escova',
    profissional: 'Ana',
    detalhe: '1 h · R$ 90,00',
    estado: 'escolhida',
    etiquetas: [{ texto: 'Confirmado', variante: 'confirmado' }],
    acoes: <a href="#alterar-a">Alterar Escova às 09:00 com Ana</a>,
    id: 'item-a',
  },
  { chave: 'b', hora: null, servico: 'Manicure', detalhe: 'a escolher', estado: 'pendente' },
  {
    chave: 'c',
    hora: '15:00',
    servico: 'Hidratação',
    profissional: 'Carla',
    detalhe: '45 min · R$ 120,00',
    estado: 'cancelada',
    etiquetas: [
      { texto: 'Cancelado', variante: 'cancelado' },
      { texto: 'Encaixe', variante: 'encaixe' },
    ],
  },
  { chave: 'd', hora: '16:00', servico: 'Corte', profissional: 'Bia', detalhe: '30 min', estado: 'destaque' },
];

const itens = () => within(screen.getByRole('list', { name: 'Seu dia' })).getAllByRole('listitem');

describe('RoteiroDoDia (D-050 §4.1)', () => {
  it('com título: section nomeada pelo título (h3 padrão) e uma <ol> nomeada, na ordem recebida', () => {
    render(<RoteiroDoDia rotulo="Seu dia" titulo="Quinta-feira, 26/11/2026" paradas={PARADAS} />);
    const titulo = screen.getByRole('heading', { level: 3, name: 'Quinta-feira, 26/11/2026' });
    const secao = screen.getByRole('region', { name: 'Quinta-feira, 26/11/2026' });
    expect(secao.contains(titulo)).toBe(true);
    const lista = screen.getByRole('list', { name: 'Seu dia' });
    expect(lista.tagName).toBe('OL');
    expect(itens().map((li) => li.getAttribute('data-estado'))).toEqual([
      'escolhida',
      'pendente',
      'cancelada',
      'destaque',
    ]);
  });

  it('nivelTitulo 2 gera h2; sem título não há section nem heading', () => {
    const { unmount } = render(<RoteiroDoDia rotulo="Seu dia" titulo="Hoje" nivelTitulo={2} paradas={PARADAS} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Hoje' })).toBeTruthy();
    unmount();
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByRole('list', { name: 'Seu dia' })).toBeTruthy();
  });

  it('parada escolhida lê "09:00 até 10:00, Escova, com Ana, detalhe, etiqueta"; ponto e traço ocultos', () => {
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    const [primeira] = itens();
    expect(primeira.textContent).toBe('09:00 até –10:00Escovacom Ana · 1 h · R$ 90,00ConfirmadoAlterar Escova às 09:00 com Ana');
    const ocultos = [...primeira.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent);
    expect(ocultos).toEqual(['', '–']);
    expect(primeira.id).toBe('item-a');
    expect(primeira.tabIndex).toBe(-1);
    expect(within(primeira).getByRole('link', { name: 'Alterar Escova às 09:00 com Ana' })).toBeTruthy();
  });

  it('parada pendente: "—" oculto com "horário a escolher" para leitor; sem profissional nem etiquetas', () => {
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    const pendente = itens()[1];
    expect(pendente.querySelector('p')!.textContent).toBe('—horário a escolher');
    expect(pendente.querySelector('p [aria-hidden="true"]')!.textContent).toBe('—');
    expect(pendente.textContent).toContain('Manicurea escolher');
    expect(pendente.textContent).not.toContain('com ');
    expect(pendente.hasAttribute('id')).toBe(false);
    expect(pendente.hasAttribute('tabindex')).toBe(false);
  });

  it('parada cancelada: serviço e detalhe riscáveis; etiquetas fora do riscado, cada uma com sua variante', () => {
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    const cancelada = itens()[2];
    expect(cancelada.className).toContain('cancelada');
    const riscaveis = [...cancelada.querySelectorAll('[class*="riscavel"]')].map((e) => e.textContent);
    expect(riscaveis).toEqual(['Hidratação', 'com Carla · 45 min · R$ 120,00']);
    const cancelado = within(cancelada).getByText('Cancelado');
    expect(cancelado.closest('[class*="riscavel"]')).toBeNull();
    expect(cancelado.className).toContain('etiquetaCancelado');
    expect(within(cancelada).getByText('Encaixe').className).toContain('etiquetaEncaixe');
  });

  it('parada em destaque recebe a classe; o horário sem fim não tem " até "', () => {
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    const destaque = itens()[3];
    expect(destaque.className).toContain('destaque');
    expect(destaque.textContent).toBe('16:00Cortecom Bia · 30 min');
  });

  it('cada variante de etiqueta tem sua classe', () => {
    const variantes = ['confirmado', 'concluido', 'nao_compareceu', 'cancelado', 'encaixe', 'neutra'] as const;
    render(
      <RoteiroDoDia
        rotulo="Seu dia"
        paradas={[
          {
            chave: 'x',
            hora: '08:00',
            servico: 'S',
            detalhe: 'd',
            estado: 'escolhida',
            etiquetas: variantes.map((v) => ({ texto: v, variante: v })),
          },
        ]}
      />,
    );
    const classes = variantes.map((v) => screen.getByText(v).className);
    expect(new Set(classes).size).toBe(variantes.length);
    for (const classe of classes) expect(classe).toContain('etiqueta');
  });

  it('rodapé aparece depois da lista, com e sem título', () => {
    const { unmount } = render(
      <RoteiroDoDia rotulo="Seu dia" titulo="Hoje" paradas={PARADAS} rodape={<p>Total: R$ 210,00</p>} />,
    );
    const lista = screen.getByRole('list', { name: 'Seu dia' });
    const total = screen.getByText('Total: R$ 210,00');
    expect(lista.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} rodape={<p>Total: R$ 0,00</p>} />);
    expect(screen.getByText('Total: R$ 0,00')).toBeTruthy();
  });

  it('nenhum elemento interativo próprio: só os do slot de ações', () => {
    render(<RoteiroDoDia rotulo="Seu dia" paradas={PARADAS} />);
    const lista = screen.getByRole('list', { name: 'Seu dia' });
    expect(lista.querySelectorAll('a, button, input, select, textarea, [tabindex="0"]')).toHaveLength(1);
  });
});
