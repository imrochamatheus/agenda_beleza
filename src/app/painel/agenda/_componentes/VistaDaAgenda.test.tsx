/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { vistaDemonstracao } from '@/app/dev/agenda/demonstracao';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';

import { hrefAgenda, hrefNovaReserva } from './links';
import { VistaDaAgenda } from './VistaDaAgenda';

// D-028 T-4 (CA-5, CA-7, CA-8, CA-9, CA-12, CA-13, CA-14, CA-17): grade do dia, lista da semana e navegação,
// com a vista montada pela MESMA função pura do serviço. Terça 01/12/2026, 12:00 em São Paulo.
const AGORA = new Date('2026-12-01T15:00:00Z');
const hrefReserva = (id: string) => `/r/${id}`;

function renderizar(entrada: Record<string, string> = {}, base = '/painel/agenda') {
  const vista = vistaDemonstracao(entrada, AGORA)!;
  return render(<VistaDaAgenda vista={vista} base={base} hrefReserva={hrefReserva} baseNovaReserva="/nova" />);
}

describe('links', () => {
  it('só os parâmetros presentes entram, codificados', () => {
    expect(hrefAgenda('/x', {})).toBe('/x');
    expect(hrefAgenda('/x', { data: '2026-12-01', visao: 'semana', profissional: 'a b' })).toBe('/x?data=2026-12-01&visao=semana&profissional=a+b');
    expect(hrefAgenda('/x', { profissional: null })).toBe('/x');
  });
});

describe('Nova reserva (D-029 CA-15)', () => {
  it('o link leva a data e o profissional da vista (filtro do gestor ou a única coluna)', () => {
    const vista = vistaDemonstracao({ data: '2026-12-01' }, AGORA)!;
    expect(hrefNovaReserva('/nova', { ...vista, profissionalFiltro: null })).toBe('/nova?data=2026-12-01');
    expect(hrefNovaReserva('/nova', { ...vista, profissionalFiltro: 'abc' })).toBe('/nova?data=2026-12-01&profissional=abc');
    const unica = { ...vista, profissionais: [], profissionalFiltro: null, colunas: [vista.colunas[0]] };
    expect(hrefNovaReserva('/nova', unica)).toBe(`/nova?data=2026-12-01&profissional=${vista.colunas[0].id}`);
  });

  it('a agenda mostra o link "Nova reserva" apontando para a base informada', () => {
    renderizar();
    const link = screen.getByRole('link', { name: 'Nova reserva' });
    expect(link.getAttribute('href')).toBe('/nova?data=2026-12-01');
  });
});

describe('dia', () => {
  it('uma seção por profissional, com o inativo marcado; título do dia', () => {
    renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Terça-feira, 01/12/2026' })).toBeTruthy();
    const titulos = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual(['Ana Demonstração', 'Bia Demonstração', 'Carla Antiga (inativo)'].filter((t) => titulos.includes(t)));
    expect(titulos).toContain('Ana Demonstração');
    expect(titulos).toContain('Bia Demonstração');
  });

  it('reservas mostram horário local, cliente, serviços e o rótulo textual do status; cancelada e não compareceu (CA-12)', () => {
    renderizar();
    const ana = screen.getByRole('region', { name: 'Ana Demonstração' });
    const r1 = within(ana).getByRole('link', { name: /10:00–11:00 Maria Souza · Corte feminino · Confirmada/ });
    expect(r1.getAttribute('href')).toBe('/r/demo-r1');
    expect(within(ana).getByRole('link', { name: /15:00–16:30 Joana Lima · Corte feminino e Escova · Concluída/ })).toBeTruthy();
    const encaixe = within(ana).getByRole('link', { name: /Paula Encaixe/ });
    expect(encaixe.textContent).toContain('Encaixe');
    const bia = screen.getByRole('region', { name: 'Bia Demonstração' });
    expect(within(bia).getByRole('link', { name: /Renata Alves · Corte feminino · Cancelada/ })).toBeTruthy();
    expect(within(bia).getByRole('link', { name: /Não compareceu/ })).toBeTruthy();
  });

  it('anonimizada: "cliente removida"; nenhum telefone na grade (CA-5, CA-17)', () => {
    const { container } = renderizar();
    expect(TEXTO_CLIENTE_REMOVIDA).toBe('cliente removida');
    expect(within(screen.getByRole('region', { name: 'Bia Demonstração' })).getByRole('link', { name: new RegExp(TEXTO_CLIENTE_REMOVIDA) })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\+55|98765|\(11\)/);
  });

  it('faixas de fundo: "Fora do funcionamento" e "Fora da jornada" com texto, distintos (CA-7, CA-8)', () => {
    renderizar();
    const ana = screen.getByRole('region', { name: 'Ana Demonstração' });
    expect(within(ana).getByText('Fora do funcionamento 00:00–08:00')).toBeTruthy();
    expect(within(ana).getByText('Fora do funcionamento 19:00–24:00')).toBeTruthy();
    expect(within(ana).getByText('Fora da jornada 08:00–09:00')).toBeTruthy();
    expect(within(ana).getByText('Fora da jornada 12:00–14:00')).toBeTruthy();
    expect(within(ana).getByText('Fora da jornada 18:00–19:00')).toBeTruthy();
  });

  it('bloqueio próprio com motivo escapado (sem HTML) (CA-9)', () => {
    const { container } = renderizar();
    const ana = screen.getByRole('region', { name: 'Ana Demonstração' });
    expect(within(ana).getByText(/Bloqueio: Dentista <b>não negrito<\/b>/)).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });

  it('reserva que cruza a meia-noite aparece recortada no dia seguinte (CA-13)', () => {
    renderizar({ data: '2026-12-02', profissional: 'demo-bia' });
    const bia = screen.getByRole('region', { name: 'Bia Demonstração' });
    expect(within(bia).getByRole('link', { name: /00:00–01:00 Noite Longa/ })).toBeTruthy();
  });

  it('salão fechado no domingo: aviso e faixa do dia inteiro', () => {
    renderizar({ data: '2026-12-06', profissional: 'demo-ana' });
    expect(screen.getByText('Salão fechado neste dia.')).toBeTruthy();
    expect(screen.getByText('Fora do funcionamento 00:00–24:00')).toBeTruthy();
  });

  it('filtro: só a profissional e os bloqueios do salão', () => {
    renderizar({ data: '2026-12-03', profissional: 'demo-bia' });
    expect(screen.queryByRole('region', { name: 'Ana Demonstração' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Bia Demonstração' })).getByText(/Bloqueio do salão: Feriado/)).toBeTruthy();
  });
});

describe('navegação (CA-14)', () => {
  it('links de dia anterior, hoje e próximo preservam visão e filtro; formulário GET', () => {
    renderizar({ profissional: 'demo-ana' });
    expect(screen.getByRole('link', { name: 'Dia anterior' }).getAttribute('href')).toBe('/painel/agenda?data=2026-11-30&visao=dia&profissional=demo-ana');
    expect(screen.getByRole('link', { name: 'Hoje' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01&visao=dia&profissional=demo-ana');
    expect(screen.getByRole('link', { name: 'Próximo dia' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-02&visao=dia&profissional=demo-ana');
    expect(screen.getByRole('link', { name: 'Semana' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01&visao=semana&profissional=demo-ana');
    expect(screen.getByRole('link', { name: 'Dia' }).getAttribute('aria-current')).toBe('true');
    const select = screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement;
    expect(select.value).toBe('demo-ana');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Todos os profissionais', 'Ana Demonstração', 'Bia Demonstração', 'Carla Antiga (inativo)']);
    expect(select.form!.method).toBe('get');
    expect(select.form!.getAttribute('action')).toBe('/painel/agenda');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeTruthy();
  });
});

describe('semana', () => {
  it('lista por dia, empilhada; recorta a reserva da meia-noite nos dois dias; dia vazio avisa (R-4)', () => {
    renderizar({ visao: 'semana' });
    expect(screen.getByRole('heading', { level: 2, name: 'Semana de 29/11/2026 a 05/12/2026' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Semana anterior' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Próxima semana' })).toBeTruthy();
    const dias = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(dias).toEqual([
      'Domingo, 29/11/2026', 'Segunda-feira, 30/11/2026', 'Terça-feira, 01/12/2026', 'Quarta-feira, 02/12/2026',
      'Quinta-feira, 03/12/2026', 'Sexta-feira, 04/12/2026', 'Sábado, 05/12/2026',
    ]);
    const terca = screen.getByRole('region', { name: 'Terça-feira, 01/12/2026' });
    expect(within(terca).getByRole('link', { name: /23:00–24:00 Noite Longa/ })).toBeTruthy();
    const quarta = screen.getByRole('region', { name: 'Quarta-feira, 02/12/2026' });
    expect(within(quarta).getByRole('link', { name: /00:00–01:00 Noite Longa/ })).toBeTruthy();
    const quinta = screen.getByRole('region', { name: 'Quinta-feira, 03/12/2026' });
    expect(within(quinta).getAllByText(/Bloqueio do salão: Feriado/).length).toBeGreaterThan(0);
    const domingo = screen.getByRole('region', { name: 'Domingo, 29/11/2026' });
    expect(within(domingo).getByText('Salão fechado.')).toBeTruthy();
    expect(within(domingo).getByText('Sem reservas nem bloqueios neste dia.')).toBeTruthy();
    expect(within(terca).getByRole('link', { name: /Cancelada|Renata/ })).toBeTruthy();
  });
});

describe('aviso de truncamento', () => {
  it('aparece com role=status e sem colunas mostra a mensagem', () => {
    const vista = { ...vistaDemonstracao({}, AGORA)!, truncada: true, colunas: [] };
    render(<VistaDaAgenda vista={vista} base="/x" hrefReserva={hrefReserva} baseNovaReserva="/nova" />);
    expect(screen.getByRole('status').textContent).toContain('primeiras 200 reservas');
    expect(screen.getByText('Nenhum profissional com agenda neste período.')).toBeTruthy();
  });
});

describe('marca de falha de mensagem (D-043 CA-8, CA-14)', () => {
  it('dia: só os blocos com falha vigente têm a marca, com texto acessível dentro do link, sem nova parada de tabulação', () => {
    renderizar({ data: '2026-12-01' });
    const comFalha = screen.getAllByRole('link', { name: /Falha ao enviar mensagem/ });
    expect(comFalha.map((l) => l.getAttribute('href'))).toEqual(['/r/demo-r1', '/r/demo-r4']);
    // O texto acessível vem antes do horário e fica dentro do link.
    expect(comFalha[0].textContent).toMatch(/^Falha ao enviar mensagem\. 10:00–11:00 Maria Souza/);
    expect(comFalha[0].querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(comFalha[0].querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
    // Sem a falha, o nome do link não muda.
    const sem = screen.getByRole('link', { name: /Joana Lima/ });
    expect(sem.textContent).not.toContain('Falha');
    expect(sem.querySelector('svg')).toBeNull();
  });

  it('semana: a marca tem texto visível dentro do item da reserva', () => {
    renderizar({ data: '2026-12-01', visao: 'semana' });
    const terca = screen.getByRole('region', { name: 'Terça-feira, 01/12/2026' });
    const links = within(terca).getAllByRole('link', { name: /Falha ao enviar mensagem/ });
    expect(links).toHaveLength(2);
    for (const l of links) {
      expect(l.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      expect(l.textContent).toMatch(/Falha ao enviar mensagem$/);
    }
    expect(within(terca).getByRole('link', { name: /Joana Lima/ }).textContent).not.toContain('Falha');
  });
});
