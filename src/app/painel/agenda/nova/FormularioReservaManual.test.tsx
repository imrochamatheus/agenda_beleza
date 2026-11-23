/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { aplicarLinha, estadoInicial, valoresVazios } from './estado';
import type { EstadoReservaManual } from './estado';
import { FormularioReservaManual } from './FormularioReservaManual';
import type { FormularioReservaManualProps } from './FormularioReservaManual';

// D-029 / D-050 web-design §5.8 (critérios 7, 23, 24, 25; CA-36 no componente): linhas "Serviço n", botão
// padrão oculto, adicionar/remover por envio, aviso de encaixe por item, resumo de erros e resultado.
const servicos = [
  { id: 's1', nome: 'Escova', rotulo: 'Escova · 1 h · R$ 90,00' },
  { id: 's2', nome: 'Hidratação', rotulo: 'Hidratação · 45 min · R$ 120,00' },
  { id: 's3', nome: 'Manicure', rotulo: 'Manicure · 40 min · R$ 50,00' },
];
const profissionais = [{ valor: 'p1', rotulo: 'Ana' }, { valor: 'p2', rotulo: 'Bia' }, { valor: 'p3', rotulo: 'Carla' }];
const tres = valoresVazios({
  data: '2026-12-01',
  nome: 'Maria',
  telefone: '11 91234-5678',
  mensagens: true,
  itens: [
    { servicoId: 's1', profissionalId: 'p1', hora: '09:00' },
    { servicoId: 's2', profissionalId: 'p2', hora: '19:00' },
    { servicoId: 's3', profissionalId: 'p3', hora: '13:00' },
  ],
});
const base = estadoInicial('chave-1', valoresVazios({ data: '2026-12-01', itens: [{ servicoId: '', profissionalId: 'p1', hora: '10:00' }] }));

type Acao = FormularioReservaManualProps['acao'];

function montar(estado: EstadoReservaManual, acao: Acao = vi.fn<Acao>(async (anterior) => anterior), fixo = false) {
  render(
    <FormularioReservaManual
      acao={acao}
      estadoInicial={estado}
      servicos={servicos}
      profissionais={fixo ? null : profissionais}
      profissionalFixo={fixo ? { id: 'p1', nome: 'Ana' } : undefined}
      fuso="America/Sao_Paulo"
    />,
  );
  return acao;
}

const formulario = () => document.querySelector('form') as HTMLFormElement;

describe('FormularioReservaManual', () => {
  it('estrutura: botão padrão oculto primeiro (C5), data uma vez, uma linha "Serviço 1" sem Remover, ajuda sem "mesmo profissional"', () => {
    montar(base);
    const primeiro = formulario().firstElementChild as HTMLButtonElement;
    expect(primeiro.tagName).toBe('BUTTON');
    expect(primeiro.type).toBe('submit');
    expect(primeiro.hidden).toBe(true);
    expect(primeiro.getAttribute('name')).toBeNull();
    expect(screen.getAllByLabelText('Data')).toHaveLength(1);
    expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('2026-12-01');
    expect(screen.getByRole('group', { name: 'Serviço 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
    expect((document.querySelector('input[name="itens"]') as HTMLInputElement).value).toBe('1');
    expect((document.querySelector('input[name="chave"]') as HTMLInputElement).value).toBe('chave-1');
    expect((screen.getByLabelText('Hora (HH:MM)') as HTMLInputElement).name).toBe('item-1-hora');
    expect((screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement).value).toBe('p1');
    expect(document.body.textContent).not.toContain('mesmo profissional');
    expect(screen.queryByRole('checkbox', { name: /Confirmo o encaixe/ })).toBeNull();
    const consent = screen.getByRole('checkbox', { name: /Termos de Uso/ }) as HTMLInputElement;
    expect(consent.required).toBe(false);
  });

  it('três linhas: nomes item-<n>-*, "Remover serviço n" em cada uma e "Adicionar outro serviço"', () => {
    montar(estadoInicial('k', tres));
    for (const n of [1, 2, 3]) {
      const linha = screen.getByRole('group', { name: `Serviço ${n}` });
      expect((within(linha).getByRole('combobox', { name: 'Serviço' }) as HTMLSelectElement).name).toBe(`item-${n}-servico`);
      expect((within(linha).getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement).name).toBe(`item-${n}-profissional`);
      const remover = within(linha).getByRole('button', { name: `Remover serviço ${n}` }) as HTMLButtonElement;
      expect([remover.type, remover.name, remover.value]).toEqual(['submit', 'linha', `remover:${n}`]);
    }
    const adicionar = screen.getByRole('button', { name: 'Adicionar outro serviço' }) as HTMLButtonElement;
    expect([adicionar.type, adicionar.name, adicionar.value]).toEqual(['submit', 'linha', 'adicionar']);
  });

  it('"Adicionar" some com 10 linhas', () => {
    const dez = { ...tres, itens: Array.from({ length: 10 }, () => ({ servicoId: '', profissionalId: '', hora: '' })) };
    montar(estadoInicial('k', dez));
    expect(screen.queryByRole('button', { name: 'Adicionar outro serviço' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Remover serviço/ })).toHaveLength(10);
  });

  it('profissional logado: sem seletor; cada linha mostra "Profissional: Ana (você)" e envia o id oculto', () => {
    montar(estadoInicial('k', { ...tres, itens: tres.itens.map((l) => ({ ...l, profissionalId: '' })) }), undefined, true);
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).toBeNull();
    expect(screen.getAllByText(/Ana \(você\)/)).toHaveLength(3);
    const ocultos = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name$="-profissional"]'));
    expect(ocultos.map((i) => [i.name, i.value])).toEqual([['item-1-profissional', 'p1'], ['item-2-profissional', 'p1'], ['item-3-profissional', 'p1']]);
  });

  it('aviso de encaixe: lista "Serviço n — serviço com profissional às hh:mm: motivos", etiqueta na linha e UMA caixa', async () => {
    montar({ ...estadoInicial('k', tres), encaixe: [{ indice: 1, motivos: ['fora_da_jornada'] }, { indice: 2, motivos: ['bloqueado', 'fora_do_funcionamento'] }] });
    const aviso = screen.getByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(aviso));
    expect(aviso.textContent).toContain('Atenção: encaixe');
    const itens = within(aviso).getAllByRole('listitem').map((li) => li.textContent);
    expect(itens).toEqual([
      'Serviço 2 — Hidratação com Bia às 19:00: fora da jornada.',
      'Serviço 3 — Manicure com Carla às 13:00: horário bloqueado; fora do funcionamento.',
    ]);
    expect(screen.getAllByRole('checkbox', { name: 'Confirmo o encaixe destes serviços' })).toHaveLength(1);
    const linha2 = screen.getByRole('group', { name: 'Serviço 2' });
    expect(linha2.textContent).toContain('Encaixe');
    expect(within(linha2).getByLabelText('Hora (HH:MM)').getAttribute('aria-describedby')).toContain('item-2-hora-encaixe');
    expect(screen.getByRole('group', { name: 'Serviço 1' }).textContent).not.toContain('Encaixe');
    expect((screen.getByLabelText('Nome da cliente') as HTMLInputElement).value).toBe('Maria');
  });

  it('resumo de erros: "Serviço n — Campo: texto" com links para item-<n>-<campo>, na ordem da tela', async () => {
    montar({
      ...estadoInicial('k', tres),
      erros: { data: 'Informe uma data válida.', telefone: 'Telefone inválido.' },
      errosPorLinha: { 1: { hora: 'Informe a hora no formato HH:MM.' }, 2: { servico: 'Este serviço já está no Serviço 1.' } },
    });
    const resumo = screen.getAllByRole('alert')[0];
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    const links = Array.from(resumo.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.textContent]);
    expect(links).toEqual([
      ['#reserva-data', 'Data: Informe uma data válida.'],
      ['#item-2-hora', 'Serviço 2 — Hora: Informe a hora no formato HH:MM.'],
      ['#item-3-servico', 'Serviço 3 — Serviço: Este serviço já está no Serviço 1.'],
      ['#reserva-telefone', 'Telefone (WhatsApp): Telefone inválido.'],
    ]);
    const hora2 = document.getElementById('item-2-hora') as HTMLInputElement;
    expect(hora2.getAttribute('aria-invalid')).toBe('true');
  });

  it('erro de quantidade aponta para a primeira linha; mensagem geral em Alert', () => {
    montar({ ...estadoInicial('k', tres), erros: { itens: 'Inclua de um a dez serviços.' }, mensagem: 'Algum serviço escolhido não está disponível.' });
    const alertas = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alertas.some((t) => t?.includes('Algum serviço escolhido'))).toBe(true);
    expect(document.querySelector('a[href="#item-1-servico"]')?.textContent).toBe('Serviços: Inclua de um a dez serviços.');
  });

  it('reserva criada: resultado focado com roteiro (horas no fuso, profissionais), encaixe no plural por regra e link da agenda', async () => {
    montar({
      ...base,
      criada: {
        repetida: false,
        encaixes: 2,
        hrefAgenda: '/painel/agenda?data=2026-12-01',
        itens: [
          { servicoId: 's1', profissionalId: 'p1', inicioIso: '2026-12-01T12:00:00.000Z', fimIso: '2026-12-01T13:00:00.000Z', duracaoMin: 60, encaixe: false },
          { servicoId: 's2', profissionalId: 'p2', inicioIso: '2026-12-01T22:00:00.000Z', fimIso: '2026-12-01T22:45:00.000Z', duracaoMin: 45, encaixe: true },
        ],
      },
    });
    const status = screen.getByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(status.textContent).toContain('Reserva registrada com encaixe em 2 serviços.');
    const roteiro = within(status).getByRole('list', { name: 'Serviços da reserva' });
    const paradas = within(roteiro).getAllByRole('listitem').map((li) => li.textContent);
    expect(paradas[0]).toContain('09:00');
    expect(paradas[0]).toContain('Escova');
    expect(paradas[0]).toContain('com Ana');
    expect(paradas[1]).toContain('19:00');
    expect(paradas[1]).toContain('Encaixe');
    expect(screen.getByRole('link', { name: 'Ver na agenda' }).getAttribute('href')).toBe('/painel/agenda?data=2026-12-01');
  });

  it('criada sem encaixe e repetida', () => {
    montar({ ...base, criada: { repetida: true, encaixes: 0, hrefAgenda: '/a', itens: [] } });
    expect(screen.getByRole('status').textContent).toContain('Esta reserva já havia sido registrada.');
  });

  it('linha removida: status antes da Data e foco na legenda da linha indicada', async () => {
    montar(aplicarLinha(tres, 'k', { tipo: 'remover', indice: 2 }));
    expect(screen.getByRole('status').textContent).toBe('Serviço 3 removido.');
    expect(screen.queryByRole('group', { name: 'Serviço 3' })).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBe('item-2-legenda'));
    const status = screen.getByRole('status');
    expect(status.compareDocumentPosition(screen.getByLabelText('Data')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('o envio padrão (Enter implícito) não leva `linha`; "Adicionar" leva linha=adicionar', async () => {
    const acao = montar(estadoInicial('k', tres));
    fireEvent.change(screen.getByLabelText('Nome da cliente'), { target: { value: 'Joana' } });
    fireEvent.submit(formulario());
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(acao).mock.calls[0][1];
    expect(fd.get('linha')).toBeNull();
    expect(fd.get('nome')).toBe('Joana');
    expect(fd.get('itens')).toBe('3');
    expect(fd.get('item-2-profissional')).toBe('p2');
    expect(fd.get('item-3-hora')).toBe('13:00');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro serviço' }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(2));
    expect(vi.mocked(acao).mock.calls[1][1].get('linha')).toBe('adicionar');
  });
});
