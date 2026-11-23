/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { exemplos } from '@/app/dev/agenda/demonstracao';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';

import { DetalheDaReserva } from './DetalheDaReserva';

// D-028 T-4 (RN-10, CA-3, CA-5, CA-17); D-050 web-design §5.10 (critérios 19 e 20): detalhe somente leitura
// com o roteiro dos serviços. Terça 01/12/2026, 12:00 em São Paulo.
const AGORA = new Date('2026-12-01T15:00:00Z');
const d = (id: string): Detalhe => exemplos(AGORA).detalhes.get(id)!;
const m = (id: string) => exemplos(AGORA).mensagens.get(id)!;
const termos = () => Array.from(document.querySelectorAll('dl dt')).map((t) => t.textContent);
const paradas = () => within(screen.getByRole('list', { name: 'Serviços da reserva' })).getAllByRole('listitem');

describe('DetalheDaReserva', () => {
  it('dl com Cliente, Telefone, Data, Situação e Origem; sem Profissional, Início nem Fim (critério 19)', () => {
    render(<DetalheDaReserva reserva={d('demo-r9')} hrefVoltar="/painel/agenda?data=2026-12-01" mensagens={m('demo-r9')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reserva' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para a agenda' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01');
    expect(termos()).toEqual(['Cliente', 'Telefone', 'Data', 'Situação', 'Origem']);
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('Lúcia Prado');
    expect(dl.textContent).toContain('(11) 98765-4321');
    expect(dl.textContent).toContain('Terça-feira, 01/12/2026');
    expect(dl.textContent).toContain('Confirmada');
    expect(dl.textContent).toContain('Cadastrada pela equipe');
  });

  it('roteiro: <ol> em ordem de início, id por item, hora início–fim, serviço, profissional, etiquetas (critério 19)', () => {
    render(<DetalheDaReserva reserva={d('demo-r9')} hrefVoltar="/x" mensagens={[]} />);
    const lista = screen.getByRole('list', { name: 'Serviços da reserva' });
    expect(lista.tagName).toBe('OL');
    const li = paradas();
    expect(li.map((x) => x.id)).toEqual(['item-demo-r9-i1', 'item-demo-r9-i2', 'item-demo-r9-i3']);
    expect(li.every((x) => x.getAttribute('tabindex') === '-1')).toBe(true);
    expect(li[0].textContent).toMatch(/^11:00 até –11:30Escova/);
    expect(li[0].textContent).toContain('com Ana Demonstração · 30 min');
    expect(li[0].textContent).toMatch(/R\$\s*55,00/);
    expect(li[1].textContent).toContain('Hidratação');
    expect(li[2].textContent).toContain('com Carla Antiga (inativo)');
    const etiquetas = (x: HTMLElement) => Array.from(x.querySelectorAll('span')).map((s) => s.textContent).filter((t) => ['Confirmado', 'Encaixe', 'Cancelado', 'Concluído'].includes(t!));
    expect(etiquetas(li[0])).toEqual(['Confirmado']);
    expect(etiquetas(li[2])).toEqual(['Confirmado', 'Encaixe']);
    expect(screen.getByText(/R\$\s*170,00/).closest('p')!.textContent).toMatch(/^Total R\$\s*170,00 · 3 serviços$/);
    expect(screen.queryByText('Itens cancelados não entram no total.')).toBeNull();
    // Somente leitura: nenhum formulário nem botão.
    expect(document.querySelector('form, button')).toBeNull();
  });

  it('item cancelado: parada riscável marcada como cancelada, etiqueta "Cancelado", fora do total e com a nota (critério 20)', () => {
    render(<DetalheDaReserva reserva={d('demo-r2')} hrefVoltar="/x" mensagens={m('demo-r2')} />);
    const [corte, escova] = paradas();
    expect(corte.getAttribute('data-estado')).toBe('escolhida');
    expect(escova.getAttribute('data-estado')).toBe('cancelada');
    expect(escova.textContent).toContain('Cancelado');
    expect(corte.textContent).toContain('Concluído');
    expect(screen.getByText(/R\$\s*90,00 ·|^R\$\s*90,00$/, { selector: 'strong' }).closest('p')!.textContent).toMatch(/^Total R\$\s*90,00 · 1 serviço$/);
    expect(screen.getByText('Itens cancelados não entram no total.')).toBeTruthy();
    expect(document.querySelector('dl')!.textContent).toContain('Concluída');
  });

  it('toda cancelada: "Total (cancelada)" soma todos e não mostra a nota', () => {
    render(<DetalheDaReserva reserva={d('demo-r4')} hrefVoltar="/x" mensagens={[]} />);
    expect(screen.getByText(/Total \(cancelada\)/).closest('p')!.textContent).toMatch(/^Total \(cancelada\) R\$\s*90,00 · 1 serviço$/);
    expect(screen.queryByText('Itens cancelados não entram no total.')).toBeNull();
    expect(document.querySelector('dl')!.textContent).toContain('Cancelada');
  });

  it('anonimizada: "cliente removida", sem telefone, com itens e preços', () => {
    render(<DetalheDaReserva reserva={d('demo-r5')} hrefVoltar="/x" mensagens={m('demo-r5')} />);
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('cliente removida');
    expect(termos()).not.toContain('Telefone');
    expect(dl.textContent).toContain('Não compareceu');
    expect(screen.getByRole('region', { name: 'Serviços' }).textContent).toMatch(/R\$\s*90,00/);
  });

  it('profissional: frase "Você vê apenas os seus serviços nesta reserva." e o total dos seus serviços (ND-2)', () => {
    const base = d('demo-r9');
    const daBia = base.itens.filter((i) => i.profissionalId === 'demo-bia');
    render(
      <DetalheDaReserva
        reserva={{ ...base, papel: 'profissional', itens: daBia, podeCancelarTodos: false, total: { centavos: 7500, servicos: 1, rotulo: 'seus_servicos' } }}
        hrefVoltar="/x"
        mensagens={[]}
      />,
    );
    expect(screen.getByText('Você vê apenas os seus serviços nesta reserva.')).toBeTruthy();
    expect(paradas()).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Serviços' }).textContent).not.toMatch(/Escova|Manicure/);
    expect(screen.getByText(/Total dos seus serviços/).closest('p')!.textContent).toMatch(/^Total dos seus serviços R\$\s*75,00 · 1 serviço$/);
  });

  it('o gestor não vê a frase do profissional', () => {
    render(<DetalheDaReserva reserva={d('demo-r9')} hrefVoltar="/x" mensagens={[]} />);
    expect(screen.queryByText('Você vê apenas os seus serviços nesta reserva.')).toBeNull();
  });

  it('resultado do PRG: role=status, foco por âncora (#resultado), antes da dl', () => {
    render(<DetalheDaReserva reserva={d('demo-r9')} hrefVoltar="/x" mensagens={[]} resultado="Escova marcado como concluído." />);
    const status = screen.getByRole('status');
    expect(status.id).toBe('resultado');
    expect(status.getAttribute('tabindex')).toBe('-1');
    expect(status.textContent).toBe('Escova marcado como concluído.');
    expect(status.compareDocumentPosition(document.querySelector('dl')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('roteiro interativo substitui o somente leitura', () => {
    render(<DetalheDaReserva reserva={d('demo-r9')} hrefVoltar="/x" mensagens={[]} roteiro={<p>interativo</p>} />);
    expect(screen.getByText('interativo')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Serviços da reserva' })).toBeNull();
  });

  it('seção de mensagens depois de Serviços; falha não altera o restante (D-043 CA-1, CA-7)', () => {
    render(<DetalheDaReserva reserva={d('demo-r1')} hrefVoltar="/x" mensagens={m('demo-r1')} />);
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titulos).toEqual(['Serviços', 'Mensagens de WhatsApp']);
    const secao = screen.getByRole('region', { name: 'Mensagens de WhatsApp' });
    expect(secao.textContent).toContain('Falha ao enviar confirmação por WhatsApp');
    expect(secao.textContent).toContain('3 tentativas');
    expect(screen.getByRole('region', { name: 'Serviços' }).textContent).toMatch(/R\$\s*90,00/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('sem mensagens mostra o texto vazio (D-043 CA-13)', () => {
    render(<DetalheDaReserva reserva={d('demo-r2')} hrefVoltar="/x" mensagens={[]} />);
    expect(screen.getByText('Nenhuma mensagem de WhatsApp para esta reserva.')).toBeTruthy();
  });
});
