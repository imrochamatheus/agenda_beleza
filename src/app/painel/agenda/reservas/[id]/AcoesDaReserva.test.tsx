/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DetalheDaReserva, ItemDoDetalhe } from '@/server/agenda/tipos';

import { AcoesDaReserva } from './AcoesDaReserva';
import type { AcoesDaReservaProps } from './AcoesDaReserva';
import { estadoRemarcarInicial, NADA_ABERTO } from './estado';
import type { Abertura } from './estado';
import { montarAcoes } from './montagem';

// D-050 web-design §5.10, critérios 19–22, C2: ações POR ITEM, sem diálogo; abrir é GET, executar é POST.
const SP = 'America/Sao_Paulo';
const nenhuma = { remarcar: false, cancelar: false, concluir: false, naoCompareceu: false };

const item = (p: Partial<ItemDoDetalhe>): ItemDoDetalhe => ({
  id: 'i1',
  servicoId: 's1',
  servicoNome: 'Escova',
  profissionalId: 'p1',
  profissionalNome: 'Ana',
  profissionalAtivo: true,
  inicio: new Date('2026-11-26T12:00:00Z'),
  fim: new Date('2026-11-26T13:00:00Z'),
  status: 'confirmado',
  encaixe: false,
  precoCentavos: 9000,
  duracaoMin: 60,
  acoes: { remarcar: true, cancelar: true, concluir: false, naoCompareceu: false },
  ...p,
});

const ITENS = [
  item({}),
  item({ id: 'i2', servicoId: 's2', servicoNome: 'Hidratação', status: 'cancelado', acoes: nenhuma, inicio: new Date('2026-11-26T13:00:00Z'), fim: new Date('2026-11-26T13:40:00Z') }),
  item({
    id: 'i3',
    servicoId: 's3',
    servicoNome: 'Manicure',
    profissionalId: 'p2',
    profissionalNome: 'Bia',
    inicio: new Date('2026-11-26T18:00:00Z'),
    fim: new Date('2026-11-26T18:45:00Z'),
    acoes: { remarcar: false, cancelar: true, concluir: true, naoCompareceu: true },
  }),
];

const detalhe = (p: Partial<DetalheDaReserva> = {}): DetalheDaReserva => ({
  id: 'r1',
  clienteId: 'c1',
  fuso: SP,
  clienteNome: 'Maria',
  anonimizada: false,
  contato: null,
  data: { ano: 2026, mes: 11, dia: 26 },
  status: 'confirmado',
  origem: 'equipe',
  temFalhaDeMensagem: false,
  itens: ITENS,
  total: { centavos: 13000, servicos: 2, rotulo: 'reserva' },
  temItemCancelado: true,
  podeCancelarTodos: true,
  papel: 'gestor',
  ...p,
});

const SERVICOS = [
  { id: 's1', nome: 'Escova', ativo: true, precoCentavos: 9000, duracaoMin: 60 },
  { id: 's2', nome: 'Hidratação', ativo: true, precoCentavos: 7500, duracaoMin: 40 },
  { id: 's3', nome: 'Manicure', ativo: true, precoCentavos: 4000, duracaoMin: 45 },
  { id: 's4', nome: 'Corte', ativo: true, precoCentavos: 8000, duracaoMin: 60 },
];
const PROFISSIONAIS = [
  { id: 'p1', nome: 'Ana' },
  { id: 'p2', nome: 'Bia' },
];

function montar(abrir: Partial<Abertura> = {}, p: Partial<AcoesDaReservaProps> = {}, d: Partial<DetalheDaReserva> = {}) {
  const reserva = detalhe(d);
  const dados = montarAcoes({ reserva, abrir: { ...NADA_ABERTO, ...abrir }, servicos: SERVICOS, profissionais: PROFISSIONAIS });
  const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a) => a);
  const acaoCancelar = vi.fn<AcoesDaReservaProps['acaoCancelar']>(async (a) => a);
  const acaoMarcar = vi.fn<AcoesDaReservaProps['acaoMarcar']>(async (a) => a);
  const acaoCancelarTodos = vi.fn<AcoesDaReservaProps['acaoCancelarTodos']>(async (a) => a);
  render(
    <AcoesDaReserva
      reservaId="r1"
      hrefBase="/r/r1"
      {...dados}
      rodape={<p>Total R$ 130,00</p>}
      acaoRemarcar={acaoRemarcar}
      acaoCancelar={acaoCancelar}
      acaoMarcar={acaoMarcar}
      acaoCancelarTodos={acaoCancelarTodos}
      {...p}
    />,
  );
  return { acaoRemarcar, acaoCancelar, acaoMarcar, acaoCancelarTodos };
}

const parada = (id: string) => document.getElementById(`item-${id}`)!;
const enviado = (f: { mock: { calls: unknown[][] } }, n = 0) => f.mock.calls[n][1] as FormData;

describe('AcoesDaReserva: ações por item', () => {
  it('cada parada tem só as ações que a máquina permite; links GET com nome acessível completo e alvo ≥ 2,75 rem', () => {
    montar();
    const escova = within(parada('i1'));
    expect(escova.getByRole('link', { name: 'Remarcar Escova (09:00)' }).getAttribute('href')).toBe('/r/r1?remarcar=i1#remarcar');
    expect(escova.getByRole('link', { name: 'Cancelar Escova (09:00)' }).getAttribute('href')).toBe('/r/r1?cancelar=i1#cancelar');
    expect(escova.queryByRole('button')).toBeNull();
    expect(within(parada('i2')).queryByRole('link')).toBeNull();
    expect(within(parada('i2')).queryByRole('button')).toBeNull();
    const manicure = within(parada('i3'));
    const concluido = manicure.getByRole('button', { name: 'Marcar Manicure como concluído' });
    expect(concluido.textContent).toBe('Concluído');
    expect(manicure.getByRole('button', { name: 'Marcar Manicure como não compareceu' }).textContent).toBe('Não compareceu');
    expect(manicure.queryByRole('link', { name: /Remarcar/ })).toBeNull();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('marcar envia o item e a situação; a recusa aparece só na parada do item', async () => {
    const acaoMarcar = vi.fn<AcoesDaReservaProps['acaoMarcar']>(async (_a, fd) => ({ itemId: String(fd.get('itemId')), mensagem: 'Só é possível marcar o resultado depois do início do serviço.' }));
    montar({}, { acaoMarcar });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Manicure como não compareceu' }));
    await waitFor(() => expect(acaoMarcar).toHaveBeenCalled());
    expect(Object.fromEntries(enviado(acaoMarcar).entries())).toEqual({ reservaId: 'r1', itemId: 'i3', destino: 'nao_compareceu' });
    const alerta = await within(parada('i3')).findByRole('alert');
    expect(alerta.textContent).toContain('Só é possível marcar o resultado depois do início do serviço.');
    expect(within(parada('i1')).queryByRole('alert')).toBeNull();
  });

  it('"Cancelar todos os serviços" só com podeCancelarTodos, como link GET de perigo', () => {
    montar();
    expect(screen.getByRole('link', { name: 'Cancelar todos os serviços' }).getAttribute('href')).toBe('/r/r1?cancelar=todos#cancelar-todos');
    expect(screen.getByText('Total R$ 130,00')).toBeTruthy();
  });

  it('sem podeCancelarTodos (profissional ou < 2 canceláveis) o botão não aparece', () => {
    montar({}, {}, { podeCancelarTodos: false });
    expect(screen.queryByRole('link', { name: 'Cancelar todos os serviços' })).toBeNull();
  });
});

describe('remarcar (critério 22)', () => {
  it('?remarcar=: exatamente um formulário, dentro da parada do item, com a data como texto quando há outro serviço', () => {
    montar({ remarcar: 'i1' });
    const formularios = document.querySelectorAll('form');
    const remarcar = Array.from(formularios).filter((f) => f.querySelector('h3'));
    expect(remarcar).toHaveLength(1);
    expect(parada('i1').contains(remarcar[0])).toBe(true);
    const titulo = within(remarcar[0]).getByRole('heading', { level: 3, name: 'Remarcar Escova' });
    expect(titulo.id).toBe('remarcar');
    expect(titulo.getAttribute('tabindex')).toBe('-1');
    expect(parada('i1').getAttribute('data-estado')).toBe('destaque');
    expect(document.getElementById('remarcar-data')!.textContent).toBe('Data: 26/11/2026 — a mesma dos outros serviços.');
    expect(within(remarcar[0]).queryByLabelText('Data')).toBeNull();
    expect((screen.getByLabelText(/Hora/) as HTMLInputElement).value).toBe('09:00');
    const servico = screen.getByRole('combobox', { name: 'Serviço' }) as HTMLSelectElement;
    expect(servico.value).toBe('s1');
    // O serviço de outro item (inclusive cancelado) não é oferecido (M-5).
    expect(Array.from(servico.options).map((o) => o.value)).toEqual(['s1', 's4']);
    expect((screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement).value).toBe('p1');
    expect(screen.getByRole('link', { name: 'Fechar' }).getAttribute('href')).toBe('/r/r1#item-i1');
    expect(remarcar[0].querySelector<HTMLInputElement>('input[name="de"]')!.value).toBe('09:00');
  });

  it('DEF-1: item de profissional inativo começa com "Escolha a profissional" selecionado; enviar vazio mostra o erro do campo', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a, fd) => ({
      ...estadoRemarcarInicial(String(fd.get('itemId')), { ...a.valores, profissionalId: String(fd.get('profissionalId')) }),
      erros: { profissional: 'Escolha a profissional.' },
    }));
    montar({ remarcar: 'i1' }, { acaoRemarcar }, { itens: [{ ...ITENS[0], profissionalAtivo: false }, ITENS[1], ITENS[2]] });
    const select = screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.selectedOptions[0].textContent).toBe('Escolha a profissional');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'p1', 'p2']);
    expect(document.getElementById(select.getAttribute('aria-describedby')!.split(' ')[0])!.textContent).toBe('Atual: Ana (inativo).');
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar serviço' }));
    await waitFor(() => expect(acaoRemarcar).toHaveBeenCalled());
    expect(enviado(acaoRemarcar).get('profissionalId')).toBe('');
    const depois = (await screen.findByRole('combobox', { name: /Profissional/ })) as HTMLSelectElement;
    expect(depois.value).toBe('');
    expect(depois.getAttribute('aria-invalid')).toBe('true');
    expect(within(parada('i1')).getAllByText('Escolha a profissional.').length).toBeGreaterThan(0);
  });

  it('profissional atual ativo: sem opção vazia', () => {
    montar({ remarcar: 'i1' });
    const select = screen.getByRole('combobox', { name: 'Profissional' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['p1', 'p2']);
  });

  it('único serviço não cancelado: a data é campo', () => {
    montar({ remarcar: 'i1' }, {}, { itens: [ITENS[0], ITENS[1]] });
    expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('2026-11-26');
  });

  it('profissional logado: sem seletor de profissional e sem enviar o id (mantém o atual)', () => {
    montar({ remarcar: 'i1' }, {}, { papel: 'profissional', podeCancelarTodos: false });
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).toBeNull();
    expect(document.getElementById('remarcar-profissional')!.textContent).toBe('Profissional: Ana');
    expect(document.querySelector('input[name="profissionalId"]')).toBeNull();
  });

  it('aviso de encaixe traz os motivos e a caixa de confirmação; a resposta preserva os dados', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a, fd) => ({
      ...a,
      itemId: String(fd.get('itemId')),
      valores: { ...a.valores, hora: String(fd.get('hora')) },
      motivos: ['fora_da_jornada', 'bloqueado'],
      mensagem: 'aviso',
    }));
    montar({ remarcar: 'i1' }, { acaoRemarcar });
    fireEvent.change(screen.getByLabelText(/Hora/), { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar serviço' }));
    const alerta = await screen.findByText('Atenção: encaixe');
    const caixa = alerta.closest('[role="alert"]') as HTMLElement;
    expect(caixa.textContent).toContain('Fora da jornada do profissional.');
    expect(caixa.textContent).toContain('Horário bloqueado.');
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(screen.getByRole('checkbox', { name: 'Confirmo o encaixe' })).toBeTruthy();
    expect((screen.getByLabelText(/Hora/) as HTMLInputElement).value).toBe('20:00');
    expect(Object.fromEntries(enviado(acaoRemarcar).entries())).toMatchObject({ reservaId: 'r1', itemId: 'i1', servicoId: 's1', profissionalId: 'p1', hora: '20:00', de: '09:00' });
  });

  it('erros de campo viram resumo com links e foco', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a) => ({
      ...estadoRemarcarInicial('i1', a.valores),
      erros: { servico: 'Sem serviço.', data: 'Data inválida.', hora: 'Hora inválida.', profissional: 'Sem profissional.' },
    }));
    montar({ remarcar: 'i1' }, { acaoRemarcar });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar serviço' }));
    const resumo = await screen.findByText('Corrija os campos indicados para remarcar o serviço.');
    const caixa = resumo.closest('[role="alert"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(Array.from(caixa.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      '#remarcar-servico',
      '#remarcar-profissional',
      '#remarcar-data',
      '#remarcar-hora',
    ]);
    expect(within(parada('i1')).getByText('Data inválida.')).toBeTruthy();
  });

  it('erros com profissional fixo e data em campo aparecem junto do texto/campo', async () => {
    const acaoRemarcar = vi.fn<AcoesDaReservaProps['acaoRemarcar']>(async (a) => ({ ...a, erros: { profissional: 'Inativo.', data: 'Data ruim.' } }));
    montar({ remarcar: 'i1' }, { acaoRemarcar }, { papel: 'profissional', itens: [ITENS[0]] });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar serviço' }));
    expect(await screen.findByText('Inativo.', { selector: '#remarcar-profissional-erro, #remarcar-profissional-erro *' })).toBeTruthy();
    expect(screen.getAllByText('Data ruim.').length).toBeGreaterThan(0);
  });

  it('mensagem geral (ex.: horário indisponível) aparece sem resumo', async () => {
    montar({ remarcar: 'i1' }, { acaoRemarcar: vi.fn(async (a) => ({ ...a, mensagem: 'Horário indisponível.' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar serviço' }));
    expect(await within(parada('i1')).findByText('Horário indisponível.')).toBeTruthy();
  });
});

describe('cancelar', () => {
  it('?cancelar=<item>: confirmação sob a parada; "Sim, cancelar este serviço" envia o item; "Manter serviço" é link', async () => {
    const acaoCancelar = vi.fn<AcoesDaReservaProps['acaoCancelar']>(async (_a, fd) => ({ itemId: String(fd.get('itemId')), mensagem: 'Este serviço já terminou e não pode mais ser cancelado.' }));
    montar({ cancelar: 'i1' }, { acaoCancelar });
    const caixa = document.getElementById('cancelar')!;
    expect(parada('i1').contains(caixa)).toBe(true);
    expect(caixa.getAttribute('tabindex')).toBe('-1');
    expect(caixa.textContent).toContain('Cancelar Escova (09:00 com Ana)? O horário será liberado');
    expect(within(caixa).getByRole('link', { name: 'Manter serviço' }).getAttribute('href')).toBe('/r/r1#item-i1');
    fireEvent.click(within(caixa).getByRole('button', { name: 'Sim, cancelar este serviço' }));
    await waitFor(() => expect(acaoCancelar).toHaveBeenCalled());
    expect(Object.fromEntries(enviado(acaoCancelar).entries())).toEqual({ reservaId: 'r1', itemId: 'i1' });
    expect((await within(parada('i1')).findByRole('alert')).textContent).toContain('já terminou');
  });

  it('?cancelar=todos: confirmação sob o total, POST com a reserva; recusa vira alerta', async () => {
    const acaoCancelarTodos = vi.fn<AcoesDaReservaProps['acaoCancelarTodos']>(async () => ({ mensagem: 'Nenhum serviço desta reserva pode ser cancelado agora.' }));
    montar({ cancelarTodos: true }, { acaoCancelarTodos });
    const caixa = document.getElementById('cancelar-todos')!;
    expect(caixa.textContent).toContain('Cancelar os 2 serviços que ainda podem ser cancelados (Escova 09:00, Manicure 15:00)?');
    expect(within(caixa).getByRole('link', { name: 'Manter serviços' }).getAttribute('href')).toBe('/r/r1');
    expect(screen.queryByRole('link', { name: 'Cancelar todos os serviços' })).toBeNull();
    fireEvent.click(within(caixa).getByRole('button', { name: 'Sim, cancelar todos' }));
    await waitFor(() => expect(acaoCancelarTodos).toHaveBeenCalled());
    expect(Object.fromEntries(enviado(acaoCancelarTodos).entries())).toEqual({ reservaId: 'r1' });
    expect((await screen.findByRole('alert')).textContent).toContain('Nenhum serviço desta reserva');
  });
});
