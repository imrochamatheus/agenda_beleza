/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { valorDoItem } from '@/server/reserva-publica/passos';
import type { ItemEscolhido, ResumoConfirmacao } from '@/server/reserva-publica/tipos';

import type { EstadoReserva, ReescolhaNoEstado } from '../estado';
import { FormularioDados } from './FormularioDados';

const S = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666'];
const ANA = '33333333-3333-4333-8333-333333333333';
const BIA = '55555555-5555-4555-8555-555555555555';
const CARLA = '77777777-7777-4777-8777-777777777777';
const CHAVE = '44444444-4444-4444-8444-444444444444';
// 2026-12-01 em São Paulo (UTC−3): 12:00Z = 09:00.
const H = (hhmm: string) => `2026-12-01T${String(Number(hhmm.slice(0, 2)) + 3).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`;
const V = [valorDoItem(ANA, H('09:00')), valorDoItem(BIA, H('10:00')), valorDoItem(CARLA, H('15:00'))];
const OCULTOS = {
  slug: 'bela',
  chave: CHAVE,
  campos: [
    ...S.map((value) => ({ name: 's', value })),
    { name: 'data', value: '2026-12-01' },
    ...V.map((value, k) => ({ name: `h${k}`, value })),
  ],
};
const base = (o: Partial<EstadoReserva>): EstadoReserva => ({
  status: 'editando',
  mensagem: null,
  erros: {},
  valores: { nome: 'Maria', telefone: '123', mensagensReserva: true, conviteAvaliacao: true },
  chave: CHAVE,
  resumo: null,
  repetida: false,
  ...o,
});
const HUMANO = { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'XXXX.DUMMY.TOKEN.XXXX', controleDeTeste: false } as const;

const item = (indice: number, servicoNome: string, profissionalNome: string, inicio: string, fim: string, preco: number): ItemEscolhido => ({
  indice,
  servicoId: S[indice],
  servicoNome,
  profissionalId: [ANA, BIA, CARLA][indice],
  profissionalNome,
  inicioIso: H(inicio),
  fimIso: H(fim),
  precoCentavos: preco,
  duracaoMin: 60,
});
const ESCOVA = item(0, 'Escova', 'Ana', '09:00', '10:00', 9000);
const MANICURE = item(2, 'Manicure', 'Carla', '15:00', '15:45', 4000);

async function enviar(estado: EstadoReserva) {
  const acao = vi.fn(async () => estado);
  render(<FormularioDados acao={acao} ocultos={OCULTOS} humano={HUMANO} base="/bela" />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
  await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
  return acao;
}
const formData = (acao: ReturnType<typeof vi.fn>, n = 0) => (acao.mock.calls[n] as unknown as [EstadoReserva, FormData])[1];

describe('FormularioDados (CA-7, CA-8, CA-10)', () => {
  it('envia slug, s, data, todos os h<k> e a chave de idempotência', async () => {
    const acao = await enviar(base({}));
    const fd = formData(acao);
    expect(fd.get('slug')).toBe('bela');
    expect(fd.getAll('s')).toEqual(S);
    expect([fd.get('data'), fd.get('h0'), fd.get('h1'), fd.get('h2'), fd.get('chave')]).toEqual(['2026-12-01', ...V, CHAVE]);
    expect(fd.getAll('reabrir')).toEqual([]);
  });

  it('erros por campo, valores preservados e o foco no aviso geral', async () => {
    await enviar(base({ mensagem: 'Revise.', erros: { nome: 'Nome curto.', telefone: 'Telefone inválido.', mensagensReserva: 'Aceite.' } }));
    expect(await screen.findByText('Nome curto.')).toBeTruthy();
    expect(screen.getByText('Telefone inválido.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Nome/ }) as HTMLInputElement).value).toBe('Maria');
    expect((screen.getByRole('textbox', { name: /Telefone/ }) as HTMLInputElement).value).toBe('123');
    expect(screen.getByRole('alert').textContent).toContain('Revise.');
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Revise.'));
  });

  it('confirmada: roteiro com início–fim no fuso do salão, profissional por item, total sem duração total', async () => {
    const resumo: ResumoConfirmacao = {
      fuso: 'America/Sao_Paulo',
      data: '2026-12-01',
      itens: [ESCOVA, MANICURE].map(({ servicoNome, profissionalNome, inicioIso, fimIso, precoCentavos, duracaoMin }) => ({
        servicoNome,
        profissionalNome,
        inicioIso,
        fimIso,
        precoCentavos,
        duracaoMin,
      })),
      totalCentavos: 13000,
    };
    const { container } = render(
      <FormularioDados acao={vi.fn()} ocultos={OCULTOS} humano={HUMANO} base="/bela" estadoInicial={base({ status: 'confirmada', resumo })} />,
    );
    expect(screen.getByText('Reserva confirmada!')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Terça-feira, 01/12/2026' })).toBeTruthy();
    const lista = screen.getByRole('list', { name: 'Seu dia' });
    const paradas = within(lista).getAllByRole('listitem');
    expect(paradas.map((p) => p.textContent)).toEqual([
      expect.stringMatching(/09:00 até –10:00Escovacom Ana · R\$\s90,00/),
      expect.stringMatching(/15:00 até –15:45Manicurecom Carla · R\$\s40,00/),
    ]);
    expect(container.textContent).toMatch(/TotalR\$\s130,00/);
    expect(container.textContent).toContain('2 serviços');
    expect(container.textContent).toContain('Você receberá a confirmação por WhatsApp, com todos os horários.');
    // Intervalo de 10:00 a 15:00 (≥ 30 min): lembrete de chegar antes de cada horário (ND-4).
    expect(container.textContent).toContain('chegue alguns minutos antes de cada horário');
    expect(container.textContent).not.toMatch(/Duração/);
    expect(screen.queryByRole('link', { name: /Alterar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  });

  it('repetida: "Esta reserva já estava confirmada."; sem intervalo longo, sem o lembrete', () => {
    const resumo: ResumoConfirmacao = {
      fuso: 'America/Sao_Paulo',
      data: '2026-12-01',
      itens: [{ servicoNome: 'Escova', profissionalNome: 'Ana', inicioIso: H('09:00'), fimIso: H('10:00'), precoCentavos: 9000, duracaoMin: 60 }],
      totalCentavos: 9000,
    };
    const { container } = render(
      <FormularioDados acao={vi.fn()} ocultos={OCULTOS} humano={HUMANO} base="/bela" estadoInicial={base({ status: 'confirmada', resumo, repetida: true })} />,
    );
    expect(screen.getByText('Esta reserva já estava confirmada.')).toBeTruthy();
    expect(container.textContent).toContain('1 serviço');
    expect(container.textContent).not.toContain('chegue alguns minutos');
  });

  it('indisponível: aviso e nenhum formulário', async () => {
    await enviar(base({ status: 'indisponivel' }));
    expect(await screen.findByText('Agendamento indisponível')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('FormularioDados: reescolha por item (CA-10, web-design §5.6)', () => {
  const NOVO = H('11:00');
  const reescolha = (o: Partial<ReescolhaNoEstado> = {}): ReescolhaNoEstado => ({
    resultado: 'reescolher',
    fuso: 'America/Sao_Paulo',
    data: '2026-12-01',
    mantidos: [ESCOVA, MANICURE],
    itens: [
      {
        indice: 1,
        servicoId: S[1],
        servicoNome: 'Hidratação',
        horarioAnteriorIso: H('10:00'),
        profissionalAnteriorNome: 'Bia',
        profissionais: [
          { id: BIA, nome: 'Bia', horarios: [H('10:45'), NOVO] },
          { id: ANA, nome: 'Ana', horarios: [] },
          { id: CARLA, nome: 'Carla', horarios: [H('12:00')] },
        ],
        caiu: true,
        preSelecionado: null,
      },
    ],
    consulta: { s: S, data: '2026-12-01', h: V },
    ...o,
  });
  const MENSAGEM = 'O horário das 10:00 de Hidratação com Bia acabou de ser reservado.';

  it('título com o serviço, aviso focado, roteiro com o item em destaque e grades agrupadas num só name', async () => {
    const estado = base({ status: 'horario_indisponivel', mensagem: MENSAGEM, reescolha: reescolha() });
    const acao = vi.fn(async () => estado);
    render(<FormularioDados acao={acao} ocultos={OCULTOS} humano={HUMANO} base="/bela" />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha outro horário para Hidratação' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(MENSAGEM);
    await waitFor(() => expect(document.activeElement?.textContent).toContain(MENSAGEM));

    const paradas = within(screen.getByRole('list', { name: 'Seu dia' })).getAllByRole('listitem');
    expect(paradas.map((p) => p.getAttribute('data-estado'))).toEqual(['escolhida', 'destaque', 'escolhida']);
    expect(paradas[1].textContent).toContain('escolha um novo horário abaixo');
    expect(screen.queryByRole('link', { name: /^Alterar/ })).toBeNull();

    // Grades por profissional (quem não tem horário por último), todas com o name do item.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Terça-feira, 01/12/2026', 'Bia', 'Carla', 'Ana']);
    expect(screen.getByText('Sem horários livres neste dia.')).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(['h1']));
    expect(radios.map((r) => r.value)).toEqual([valorDoItem(BIA, H('10:45')), valorDoItem(BIA, NOVO), valorDoItem(CARLA, H('12:00'))]);

    // Dados preservados; reenvio leva os itens mantidos, o novo horário e o índice reaberto.
    expect((screen.getByRole('textbox', { name: /Nome/ }) as HTMLInputElement).value).toBe('Maria');
    expect((screen.getByRole('checkbox', { name: /mensagens da minha reserva/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(radios[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(2));
    const fd = formData(acao, 1);
    expect(fd.getAll('s')).toEqual(S);
    expect([fd.get('h0'), fd.getAll('h1'), fd.get('h2'), fd.getAll('reabrir')]).toEqual([V[0], [valorDoItem(BIA, NOVO)], V[2], ['1']]);
  });

  it('vários itens: "Escolha outros horários" e um bloco "Novo horário para X" por item', () => {
    const r = reescolha();
    const outro = { ...r.itens[0], indice: 2, servicoId: S[2], servicoNome: 'Manicure', horarioAnteriorIso: H('15:00'), profissionais: [{ id: CARLA, nome: 'Carla', horarios: [H('16:00')] }] };
    render(
      <FormularioDados
        acao={vi.fn()}
        ocultos={OCULTOS}
        humano={HUMANO}
        base="/bela"
        estadoInicial={base({ status: 'horario_indisponivel', mensagem: 'm', reescolha: { ...r, mantidos: [ESCOVA], itens: [r.itens[0], outro] } })}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Escolha outros horários' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Novo horário para Hidratação' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Novo horário para Manicure' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0);
    expect(new Set((screen.getAllByRole('radio') as HTMLInputElement[]).map((x) => x.name))).toEqual(new Set(['h1', 'h2']));
  });

  it('sem horário restante: "Não há mais horários" com "Escolher outro dia" e "Seguir sem X" (GET, sem dado pessoal)', () => {
    const r = reescolha();
    const semNada = { ...r, itens: [{ ...r.itens[0], profissionais: r.itens[0].profissionais.map((p) => ({ ...p, horarios: [] })) }] };
    render(<FormularioDados acao={vi.fn()} ocultos={OCULTOS} humano={HUMANO} base="/bela" estadoInicial={base({ status: 'horario_indisponivel', mensagem: 'm', reescolha: semNada })} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Não há mais horários para Hidratação neste dia.' })).toBeTruthy();
    const outroDia = screen.getByRole('link', { name: 'Escolher outro dia' }).getAttribute('href')!;
    const seguir = screen.getByRole('link', { name: 'Seguir sem Hidratação' }).getAttribute('href')!;
    expect(outroDia).toBe(`/bela?s=${S[0]}&s=${S[1]}&s=${S[2]}&de=2026-12-01#reservar`);
    expect(seguir).toBe(`/bela?s=${S[0]}&s=${S[2]}&data=2026-12-01&h0=${encodeURIComponent(V[0])}&h1=${encodeURIComponent(V[2])}`);
    expect(outroDia + seguir).not.toMatch(/Maria|123/);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('item reaberto ainda livre volta pré-selecionado (reenvio com erro de campo)', () => {
    const r = reescolha();
    const reaberto = { ...r, itens: [{ ...r.itens[0], caiu: false, preSelecionado: valorDoItem(BIA, NOVO) }] };
    render(<FormularioDados acao={vi.fn()} ocultos={OCULTOS} humano={HUMANO} base="/bela" estadoInicial={base({ erros: { nome: 'Nome curto.' }, reescolha: reaberto })} />);
    const marcado = (screen.getAllByRole('radio') as HTMLInputElement[]).filter((x) => x.checked);
    expect(marcado.map((x) => x.value)).toEqual([valorDoItem(BIA, NOVO)]);
    expect(screen.getByText('Nome curto.')).toBeTruthy();
  });

  it('sem estado de reescolha (GET) mostra a alternativa da página, sem formulário', () => {
    render(<FormularioDados acao={vi.fn(async () => base({}))} ocultos={OCULTOS} humano={HUMANO} base="/bela" alternativa={<p>Passo do serviço</p>} />);
    expect(screen.getByText('Passo do serviço')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  });
});
