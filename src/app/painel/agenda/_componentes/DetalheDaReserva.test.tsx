/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { exemplos } from '@/app/dev/agenda/demonstracao';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';

import { DetalheDaReserva } from './DetalheDaReserva';

// D-028 T-4 (RN-10, CA-3, CA-5, CA-17): detalhe somente leitura.
const AGORA = new Date('2026-12-01T15:00:00Z');
const d = (id: string): Detalhe => exemplos(AGORA).detalhes.get(id)!;
const m = (id: string) => exemplos(AGORA).mensagens.get(id)!;

describe('DetalheDaReserva', () => {
  it('profissional, cliente, telefone formatado, horários no fuso, itens, total e voltar', () => {
    render(<DetalheDaReserva reserva={d('demo-r2')} hrefVoltar="/painel/agenda?data=2026-12-01" mensagens={m('demo-r2')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reserva' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para a agenda' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01');
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('Ana Demonstração');
    expect(dl.textContent).toContain('Joana Lima');
    expect(dl.textContent).toContain('(11) 98765-4321');
    expect(dl.textContent).toContain('01/12/2026 15:00');
    expect(dl.textContent).toContain('01/12/2026 16:30');
    expect(dl.textContent).toContain('Concluída');
    const itens = within(screen.getByRole('region', { name: 'Serviços' })).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain('Corte feminino');
    expect(itens[0].textContent).toMatch(/R\$\s*90,00/);
    expect(screen.getByText(/Total: R\$\s*145,00/)).toBeTruthy();
  });

  it('anonimizada: "cliente removida", sem telefone, com itens e preços', () => {
    render(<DetalheDaReserva reserva={d('demo-r5')} hrefVoltar="/x" mensagens={m('demo-r5')} />);
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('cliente removida');
    expect(dl.textContent).not.toContain('Telefone');
    expect(dl.textContent).toContain('Não compareceu');
    expect(screen.getByRole('region', { name: 'Serviços' }).textContent).toMatch(/R\$\s*90,00/);
  });

  it('profissional inativa e encaixe aparecem marcados', () => {
    const { rerender } = render(<DetalheDaReserva reserva={d('demo-r7')} hrefVoltar="/x" mensagens={m('demo-r7')} />);
    expect(document.querySelector('dl')!.textContent).toContain('Carla Antiga (inativo)');
    rerender(<DetalheDaReserva reserva={d('demo-r3')} hrefVoltar="/x" mensagens={m('demo-r3')} />);
    expect(document.querySelector('dl')!.textContent).toContain('Cadastrada pela equipe · Encaixe');
  });

  it('seção de mensagens depois de Serviços; falha não altera o restante (CA-1, CA-7)', () => {
    render(<DetalheDaReserva reserva={d('demo-r1')} hrefVoltar="/x" mensagens={m('demo-r1')} />);
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titulos).toEqual(['Serviços', 'Mensagens de WhatsApp']);
    const secao = screen.getByRole('region', { name: 'Mensagens de WhatsApp' });
    expect(secao.textContent).toContain('Falha ao enviar confirmação por WhatsApp');
    expect(secao.textContent).toContain('3 tentativas');
    expect(screen.getByRole('region', { name: 'Serviços' }).textContent).toMatch(/R\$\s*90,00/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('sem mensagens mostra o texto vazio (CA-13)', () => {
    render(<DetalheDaReserva reserva={d('demo-r2')} hrefVoltar="/x" mensagens={[]} />);
    expect(screen.getByText('Nenhuma mensagem de WhatsApp para esta reserva.')).toBeTruthy();
  });
});
