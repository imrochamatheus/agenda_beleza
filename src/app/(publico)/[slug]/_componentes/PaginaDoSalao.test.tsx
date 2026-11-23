/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';
import type { PerfilPublico } from '@/server/repos/publico';
import { valorDoItem } from '@/server/reserva-publica/passos';
import type { FaixaDaSemana, ItemEscolhido, VisaoDoPasso } from '@/server/reserva-publica/tipos';

import { estadoInicialReserva } from '../estado';
import { PaginaDoSalao } from './PaginaDoSalao';
import type { PaginaDoSalaoProps } from './PaginaDoSalao';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const H = '2026-12-01T12:00:00.000Z';

const COMPLETO: PerfilPublico = {
  nome: 'Studio Bela',
  descricao: 'Cuidado <b>com</b> carinho.\nSegunda linha.',
  endereco: { logradouro: 'Rua A', numero: '10', complemento: 'sala 2', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01304001' },
  telefoneE164: '+551134567890',
  whatsappE164: '+5511987654321',
  instagram: 'studiobela',
  meiosPagamento: ['pix', 'dinheiro'],
  comodidades: ['wifi'],
  funcionamento: montarSemana([{ diaSemana: 1, inicioMin: 540, fimMin: 1080 }]),
};
const VAZIO: PerfilPublico = {
  nome: 'Salão Vazio',
  descricao: null,
  endereco: null,
  telefoneE164: null,
  whatsappE164: null,
  instagram: null,
  meiosPagamento: [],
  comodidades: [],
  funcionamento: null,
};
const SERVICOS = [
  { id: S1, nome: 'Corte', precoCentavos: 5000, duracaoMin: 30 },
  { id: S2, nome: 'Escova', precoCentavos: 7000, duracaoMin: 45 },
];
const SELECAO = { servicos: SERVICOS, precoTotalCentavos: 12000 };

function montar(o: Partial<PaginaDoSalaoProps> = {}) {
  const props: PaginaDoSalaoProps = {
    base: '/studio-bela',
    slug: 'studio-bela',
    perfil: COMPLETO,
    fotos: [{ id: 'f1', url: '/api/fotos/f1', alt: 'Recepção', largura: 800, altura: 600 }],
    servicos: SERVICOS,
    equipe: [{ id: P1, nome: 'Ana' }],
    decisao: { disponivel: true },
    visao: { passo: 'servicos', marcados: [], aviso: null },
    chave: '44444444-4444-4444-8444-444444444444',
    acao: vi.fn(async (anterior) => anterior),
    humano: { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'XXXX.DUMMY.TOKEN.XXXX', controleDeTeste: false },
    ...o,
  };
  return render(<PaginaDoSalao {...props} />);
}

describe('PaginaDoSalao: perfil (CA-1, CA-2)', () => {
  it('perfil completo: h1 com o nome e todas as seções', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Studio Bela' })).toBeTruthy();
    for (const nome of ['Serviços', 'Equipe', 'Horário de funcionamento', 'Endereço', 'Contato', 'Formas de pagamento', 'Comodidades']) {
      expect(screen.getByRole('heading', { level: 2, name: nome }), nome).toBeTruthy();
    }
    expect(screen.getByAltText('Recepção').getAttribute('width')).toBe('800');
    expect(screen.getByText('Segunda-feira').nextElementSibling?.textContent).toBe('09:00–18:00');
    expect(screen.getByText('Domingo').nextElementSibling?.textContent).toBe('Fechado');
    expect(screen.getByText(/Rua A, 10 – sala 2/)).toBeTruthy();
    expect(screen.getByText(/CEP 01304-001/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '(11) 3456-7890' }).getAttribute('href')).toBe('tel:+551134567890');
    expect(screen.getByRole('link', { name: '(11) 98765-4321' }).getAttribute('href')).toBe('https://wa.me/5511987654321');
    expect(screen.getByRole('link', { name: '@studiobela' }).getAttribute('href')).toBe('https://www.instagram.com/studiobela');
    expect(screen.getByText('Pix')).toBeTruthy();
    expect(screen.getByText('Wi-Fi para clientes')).toBeTruthy();
  });

  it('descrição com HTML aparece como texto, sem criar elementos', () => {
    const { container } = montar();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/Cuidado <b>com<\/b> carinho/)).toBeTruthy();
  });

  it('perfil vazio: seções omitidas e nenhum "undefined"/"null" no texto', () => {
    const { container } = montar({ perfil: VAZIO, fotos: [], equipe: [] });
    for (const nome of ['Equipe', 'Horário de funcionamento', 'Endereço', 'Contato', 'Formas de pagamento', 'Comodidades']) {
      expect(screen.queryByRole('heading', { name: nome }), nome).toBeNull();
    }
    expect(screen.queryByRole('list', { name: 'Fotos do salão' })).toBeNull();
    expect(container.textContent).not.toMatch(/undefined|null/);
  });

  it('funcionamento definido com todos os dias fechados mostra "Fechado" nos sete', () => {
    montar({ perfil: { ...COMPLETO, funcionamento: montarSemana([]) } });
    expect(screen.getAllByText('Fechado')).toHaveLength(7);
  });
});

describe('PaginaDoSalao: indisponível (CA-4)', () => {
  it('mostra o aviso e a lista de serviços, sem formulário nem botão de reservar', () => {
    const { container } = montar({ decisao: { disponivel: false, motivo: 'assinatura' } });
    expect(screen.getByText('Agendamento indisponível')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Serviços' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Studio Bela' })).toBeTruthy();
    expect(screen.getByAltText('Recepção')).toBeTruthy();
  });
});

// D-050: dois serviços (Corte, Escova), Ana e Bia; 2026-12-01 em São Paulo (12:00Z = 09:00).
const P2 = '55555555-5555-4555-8555-555555555555';
const H2 = '2026-12-01T13:00:00.000Z';
const V0 = valorDoItem(P1, H);
const V1 = valorDoItem(P2, H2);
const CORTE_ANA: ItemEscolhido = {
  indice: 0, servicoId: S1, servicoNome: 'Corte', profissionalId: P1, profissionalNome: 'Ana',
  inicioIso: H, fimIso: '2026-12-01T12:30:00.000Z', precoCentavos: 5000, duracaoMin: 30,
};
const ESCOVA_BIA: ItemEscolhido = {
  indice: 1, servicoId: S2, servicoNome: 'Escova', profissionalId: P2, profissionalNome: 'Bia',
  inicioIso: H2, fimIso: '2026-12-01T13:45:00.000Z', precoCentavos: 7000, duracaoMin: 45,
};
type VisaoServico = Extract<VisaoDoPasso, { passo: 'servico' }>;
const servico = (o: Partial<VisaoServico> = {}): VisaoServico => ({
  passo: 'servico',
  s: [S1, S2],
  data: '2026-12-01',
  fuso: 'America/Sao_Paulo',
  selecao: SELECAO,
  indice: 1,
  total: 2,
  servico: SERVICOS[1],
  escolhidos: [CORTE_ANA],
  pendentes: [],
  profissionais: [
    { id: P1, nome: 'Ana', horarios: [] },
    { id: P2, nome: 'Bia', horarios: [H2, '2026-12-01T13:15:00.000Z'] },
  ],
  opcoesDeFiltro: [{ id: P1, nome: 'Ana' }, { id: P2, nome: 'Bia' }],
  filtro: null,
  preSelecionado: null,
  alterando: false,
  proximoEhDados: true,
  vazio: null,
  aviso: null,
  horarioPerdidoIso: null,
  consulta: { s: [S1, S2], data: '2026-12-01', h: [V0, null] },
  faixa: null,
  ...o,
});
/** Semana 0 de 29/11/2026 (domingo, hoje) a 05/12/2026; só terça (01/12) e quinta (03/12) com horário. */
const FAIXA: FaixaDaSemana = {
  hoje: '2026-11-29',
  inicio: '2026-11-29',
  fim: '2026-12-05',
  dias: ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'].map((data) => ({
    data,
    temHorarios: data === '2026-12-01' || data === '2026-12-03',
  })),
  anterior: null,
  proxima: '2026-12-06',
  selecionado: null,
};
type VisaoDia = Extract<VisaoDoPasso, { passo: 'dia' }>;
const dia = (o: Partial<VisaoDia> = {}): VisaoDia => ({
  passo: 'dia',
  s: [S1, S2],
  selecao: SELECAO,
  servico: SERVICOS[0],
  total: 2,
  faixa: FAIXA,
  aviso: null,
  ...o,
});
const DADOS: VisaoDoPasso = {
  passo: 'dados',
  s: [S1, S2],
  data: '2026-12-01',
  fuso: 'America/Sao_Paulo',
  selecao: SELECAO,
  itens: [CORTE_ANA, ESCOVA_BIA],
  totalCentavos: 12000,
  consulta: { s: [S1, S2], data: '2026-12-01', h: [V0, V1] },
};
const enc = encodeURIComponent;
const ocultos = (c: HTMLElement) =>
  [...c.querySelectorAll('input[type=hidden]')].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
/** Critérios 7 e 8 do web-design: o modelo antigo não aparece em nenhum passo. */
const semModeloAntigo = (c: HTMLElement) => {
  expect(c.textContent).not.toMatch(/com o mesmo profissional|Sem preferência|Alterar profissional/);
};

describe('PaginaDoSalao: passos', () => {
  it('serviços: checkboxes "s" por GET, texto novo, aviso e serviços marcados ao voltar', () => {
    const { container } = montar({ visao: { passo: 'servicos', marcados: [S2], aviso: 'servico_indisponivel' } });
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/studio-bela');
    const caixas = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(caixas.map((c) => [c.name, c.value, c.checked])).toEqual([['s', S1, false], ['s', S2, true]]);
    expect(within(form).getByText(/R\$\s*50,00/)).toBeTruthy();
    expect(screen.getByText(/Depois você escolhe o dia e, para cada serviço, o profissional e o horário\./)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Algum dos serviços escolhidos não está mais disponível');
    expect(screen.getAllByRole('heading', { level: 2, name: 'Serviços' })).toHaveLength(1);
    semModeloAntigo(container);
  });

  it('dia (D-051 CA-1, CA-2, CA-4): indicador, h2 do 1º serviço, resumo, régua e o estado "escolha um dia"', () => {
    const { container } = montar({ visao: dia() });
    const h2 = screen.getByRole('heading', { level: 2, name: 'Corte' });
    expect(h2.id).toBe('reservar');
    expect(document.getElementById(h2.getAttribute('aria-describedby')!)?.textContent).toBe('Serviço 1 de 2');
    expect(screen.queryByRole('heading', { level: 2, name: 'Escolha o dia' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Escolha o dia' })).toBeTruthy();
    expect(screen.getByText('Corte · Escova')).toBeTruthy();
    expect(screen.getByText(/2 serviços · R\$\s120,00/)).toBeTruthy();
    const regua = screen.getByRole('list', { name: 'Escolha o dia 29/11/2026 a 05/12/2026' });
    expect(within(regua).getAllByRole('listitem')).toHaveLength(7);
    // Só os dias com horário são links (s + data + #reservar); os outros são texto com "sem horários".
    expect(within(regua).getAllByRole('link').map((l) => [l.textContent?.slice(0, 3), l.getAttribute('href')])).toEqual([
      ['Ter', `/studio-bela?s=${S1}&s=${S2}&data=2026-12-01#reservar`],
      ['Qui', `/studio-bela?s=${S1}&s=${S2}&data=2026-12-03#reservar`],
    ]);
    expect(screen.getByRole('link', { name: 'Terça-feira, 01/12/2026' })).toBeTruthy();
    expect(screen.getByText('Domingo, 29/11/2026, hoje, sem horários').parentElement!.tagName).toBe('SPAN');
    expect(within(regua).getAllByText('Hoje')).toHaveLength(1);
    expect(container.querySelector('[aria-current]')).toBeNull();
    // Semana 0: sem "Semana anterior"; "Próxima semana" leva a s + de.
    expect(screen.queryByText(/Semana anterior/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Próxima semana' }).getAttribute('href')).toBe(
      `/studio-bela?s=${S1}&s=${S2}&de=2026-12-06#reservar`,
    );
    expect(screen.getByText('Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele.')).toBeTruthy();
    // Sem dia: estado vazio e nada de roteiro, filtro, grade, botão ou formulário (D6).
    expect(screen.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeTruthy();
    expect(screen.getByText('Os horários de Corte aparecem aqui, separados por profissional.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Seu dia' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Filtrar por profissional' })).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Escolher outro dia' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Alterar serviços' }).getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&alterar=servicos`);
    expect(container.textContent).not.toMatch(/Duração|1 h 15 min|\(sem horários\)|Próximos dias|Dias anteriores/);
    semModeloAntigo(container);
  });

  it('dia: semana sem nenhum dia oferecido (CA-12) e aviso genérico antes da régua (RN-15)', () => {
    const vazia = { ...FAIXA, dias: FAIXA.dias.map((d) => ({ ...d, temHorarios: false })) };
    const { container, unmount } = montar({ visao: dia({ faixa: vazia, aviso: 'horario_indisponivel' }) });
    expect(screen.queryAllByRole('link', { name: /\/2026/ })).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Escolha o dia 29/11/2026 a 05/12/2026' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('heading', { level: 3, name: 'Nenhum dia desta semana tem horário' })).toBeTruthy();
    expect(screen.getByText('Veja a próxima semana ou altere os serviços.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Próxima semana' })).toHaveLength(1);
    const alerta = screen.getByRole('status');
    expect(alerta.textContent).toContain('Este horário não está mais disponível. Escolha outro horário.');
    const regua = container.querySelector('ol')!;
    expect(alerta.compareDocumentPosition(regua) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    montar({ visao: dia({ faixa: { ...vazia, anterior: '2026-11-22', proxima: null } }) });
    expect(screen.getByText('Esta é a última semana aberta para reservas. Volte à semana anterior ou altere os serviços.')).toBeTruthy();
    expect(screen.queryByText(/Próxima semana/)).toBeNull();
  });

  it('serviço k de N: indicador no aria-describedby do h2, roteiro, filtro, grades num só name e ocultos', () => {
    const { container } = montar({ visao: servico() });
    const h2 = screen.getByRole('heading', { level: 2, name: 'Escova' });
    expect(document.getElementById(h2.getAttribute('aria-describedby')!)?.textContent).toBe('Serviço 2 de 2');
    expect(within(container.querySelector('form')!).getByText(/45 min · R\$\s70,00/)).toBeTruthy();

    const paradas = within(screen.getByRole('list', { name: 'Seu dia' })).getAllByRole('listitem');
    expect(paradas.map((p) => p.getAttribute('data-estado'))).toEqual(['escolhida', 'destaque']);
    expect(paradas[0].textContent).toMatch(/^09:00Cortecom Ana · 30 min · R\$\s50,00/);
    expect(paradas[1].textContent).toContain('escolhendo agora');
    const alterar = within(paradas[0]).getByRole('link', { name: 'Alterar Corte (09:00 com Ana)' });
    expect(alterar.getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&data=2026-12-01&h0=${enc(V0)}&alterar=0`);

    const filtro = screen.getByRole('navigation', { name: 'Filtrar por profissional' });
    const pilulas = within(filtro).getAllByRole('link');
    expect(pilulas.map((l) => [l.textContent, l.getAttribute('aria-current')])).toEqual([['Todos (2)', 'true'], ['Ana', null], ['Bia', null]]);
    expect(pilulas[2].getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&data=2026-12-01&h0=${enc(V0)}&f=${P2}`);

    // Bia (com horários) antes de Ana (sem horários); um só name; valor = profissional + instante.
    const grupos = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(grupos).toEqual(['Terça-feira, 01/12/2026', 'Bia', 'Ana']);
    expect(screen.getByText('Sem horários livres neste dia.')).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [r.name, r.value])).toEqual([['h1', V1], ['h1', valorDoItem(P2, '2026-12-01T13:15:00.000Z')]]);
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(ocultos(container)).toEqual([['s', S1], ['s', S2], ['data', '2026-12-01'], ['h0', V0], ['enviado', '1']]);
    expect(screen.getByRole('button', { name: 'Continuar para seus dados' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escolher outro dia' }).getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&de=2026-12-01#reservar`);
    expect(screen.getByRole('link', { name: 'Alterar serviços' }).getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&alterar=servicos`);
    // Passo k ≥ 1 (D-051 CA-6, critério 18): sem régua e sem resumo.
    expect(screen.queryByRole('heading', { level: 3, name: 'Escolha o dia' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Serviços escolhidos' })).toBeNull();
    semModeloAntigo(container);
  });

  it('serviço 0 com dia (D-051 CA-5, CA-11): régua com o dia marcado, horários abaixo, aviso antes da régua', () => {
    const { container } = montar({
      visao: servico({
        indice: 0, servico: SERVICOS[0], escolhidos: [], pendentes: [1], proximoEhDados: false, aviso: 'sem_selecao',
        profissionais: [{ id: P1, nome: 'Ana', horarios: [H] }], opcoesDeFiltro: [{ id: P1, nome: 'Ana' }],
        consulta: { s: [S1, S2], data: '2026-12-01', h: [null, null] },
        faixa: { ...FAIXA, selecionado: '2026-12-01' },
      }),
    });
    expect(document.getElementById(screen.getByRole('heading', { level: 2, name: 'Corte' }).getAttribute('aria-describedby')!)?.textContent).toBe(
      'Serviço 1 de 2',
    );
    const marcado = screen.getByRole('link', { name: 'Terça-feira, 01/12/2026' });
    expect(marcado.getAttribute('aria-current')).toBe('date');
    expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Serviços escolhidos' })).toBeTruthy();
    // Ordem no DOM: aviso → resumo → régua → roteiro → grade → Continuar.
    const ordem = [
      screen.getByRole('status'),
      screen.getByRole('group', { name: 'Serviços escolhidos' }),
      container.querySelector('ol')!,
      screen.getByRole('list', { name: 'Seu dia' }),
      screen.getByRole('radio'),
      screen.getByRole('button', { name: 'Continuar' }),
    ];
    for (let k = 1; k < ordem.length; k++) {
      expect(ordem[k - 1].compareDocumentPosition(ordem[k]) & Node.DOCUMENT_POSITION_FOLLOWING, String(k)).toBeTruthy();
    }
    expect(screen.getByRole('status').textContent).toContain('Escolha um horário para Corte.');
    expect((screen.getByRole('radio') as HTMLInputElement).name).toBe('h0');
    // O passo 0 não tem "Escolher outro dia" (a régua cumpre o papel); "Alterar serviços" fica.
    expect(screen.queryByRole('link', { name: 'Escolher outro dia' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Alterar serviços' })).toBeTruthy();
    expect(ocultos(container)).toEqual([['s', S1], ['s', S2], ['data', '2026-12-01'], ['enviado', '0']]);
    // Links de dia e de semana descartam itens, filtro e aviso (CA-7).
    for (const a of container.querySelectorAll('ol a, nav[aria-label="Semanas"] a')) {
      expect(a.getAttribute('href')).toMatch(/#reservar$/);
      expect(a.getAttribute('href')).not.toMatch(/h\d=|alterar|enviado|aviso|[?&]f=/);
    }
  });

  it('serviço 0 marcado sem horário (RN-8, C5): o dia marcado é <span aria-current>', () => {
    const { container } = montar({
      visao: servico({ indice: 0, servico: SERVICOS[0], escolhidos: [], pendentes: [1], vazio: 'calendario',
        consulta: { s: [S1, S2], data: '2026-11-30', h: [null, null] }, data: '2026-11-30',
        faixa: { ...FAIXA, selecionado: '2026-11-30' } }),
    });
    const marcado = container.querySelector('[aria-current="date"]')!;
    expect(marcado.tagName).toBe('SPAN');
    expect(marcado.textContent).toContain('Segunda-feira, 30/11/2026, sem horários');
    expect(screen.getByRole('heading', { level: 3, name: 'Nenhum horário para Corte neste dia.' })).toBeTruthy();
  });

  it('serviço com pendentes: parada "a escolher" e botão "Continuar"; filtro só com 2+ profissionais', () => {
    montar({
      visao: servico({
        indice: 0, servico: SERVICOS[0], escolhidos: [], pendentes: [1], proximoEhDados: false,
        opcoesDeFiltro: [{ id: P2, nome: 'Bia' }], profissionais: [{ id: P2, nome: 'Bia', horarios: [H2] }],
        consulta: { s: [S1, S2], data: '2026-12-01', h: [null, null] },
      }),
    });
    const paradas = within(screen.getByRole('list', { name: 'Seu dia' })).getAllByRole('listitem');
    expect(paradas.map((p) => p.getAttribute('data-estado'))).toEqual(['destaque', 'pendente']);
    expect(paradas[1].textContent).toContain('a escolher');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Filtrar por profissional' })).toBeNull();
  });

  it('"Alterar": meta "alterando", horário atual pré-selecionado e filtro que preserva o alterar', () => {
    montar({
      visao: servico({ indice: 0, servico: SERVICOS[0], escolhidos: [ESCOVA_BIA], alterando: true, preSelecionado: V1, filtro: P2,
        profissionais: [{ id: P2, nome: 'Bia', horarios: [H, H2] }], consulta: { s: [S1, S2], data: '2026-12-01', h: [V0, V1] } }),
    });
    expect(screen.getByText('alterando')).toBeTruthy();
    const marcado = (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked).map((r) => r.value);
    expect(marcado).toEqual([V1]);
    const pilulas = within(screen.getByRole('navigation', { name: 'Filtrar por profissional' })).getAllByRole('link');
    expect(pilulas.map((l) => l.getAttribute('aria-current'))).toEqual([null, null, 'true']);
    expect(pilulas[0].getAttribute('href')).toContain('alterar=0');
  });

  it('vazio por calendário e por conflito: textos exatos e sem "Continuar"', () => {
    const { unmount } = montar({ visao: servico({ vazio: 'calendario' }) });
    expect(screen.getByRole('heading', { level: 3, name: 'Nenhum horário para Escova neste dia.' })).toBeTruthy();
    expect(screen.getByText('Escolha outro dia ou altere os serviços.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continuar/ })).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    unmount();
    montar({ visao: servico({ vazio: 'conflito' }) });
    expect(screen.getByRole('heading', { level: 3, name: 'Os horários de Escova neste dia coincidem com os serviços que você já escolheu.' })).toBeTruthy();
    expect(screen.getByText('Altere o horário de outro serviço acima ou escolha outro dia.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Alterar Corte/ })).toBeTruthy();
  });

  it('avisos do passo: sem seleção nomeia o serviço; horário perdido nomeia hora e serviço (alternativa do formulário)', () => {
    const { unmount } = montar({ visao: servico({ aviso: 'sem_selecao' }) });
    expect(screen.getByRole('status').textContent).toContain('Escolha um horário para Escova.');
    unmount();
    const { container } = montar({ visao: servico({ aviso: 'horario_indisponivel', horarioPerdidoIso: H2 }) });
    expect(screen.getByRole('status').textContent).toContain('O horário das 10:00 de Escova não está mais disponível. Escolha outro.');
    expect(container.querySelector('form')?.getAttribute('method')).toBe('get');
    expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  });

  it('dados: roteiro com "Alterar" por item, total, "Alterar serviços" e o POST com todos os itens', () => {
    const { container } = montar({ visao: DADOS });
    expect(screen.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeTruthy();
    const alterar = screen.getAllByRole('link', { name: /^Alterar / });
    expect(alterar.map((l) => l.textContent)).toEqual(['Alterar Corte (09:00 com Ana)', 'Alterar Escova (10:00 com Bia)', 'Alterar serviços']);
    expect(alterar[1].getAttribute('href')).toBe(`/studio-bela?s=${S1}&s=${S2}&data=2026-12-01&h0=${enc(V0)}&h1=${enc(V1)}&alterar=1`);
    expect(container.textContent).toMatch(/TotalR\$\s120,00/);
    expect(container.textContent).not.toMatch(/Duração/);
    const form = container.querySelector('form')!;
    expect(ocultos(form).filter(([n]) => n !== 'cf-turnstile-response')).toEqual([
      ['slug', 'studio-bela'], ['s', S1], ['s', S2], ['data', '2026-12-01'], ['h0', V0], ['h1', V1],
      ['chave', '44444444-4444-4444-8444-444444444444'],
    ]);
    // Ordem de Tab (critério 14): os "Alterar" e "Alterar serviços" vêm antes do Nome.
    const focaveis = [...container.querySelectorAll('a[href], input:not([type=hidden]), button')].map(
      (e) => e.textContent?.trim() || (e as HTMLInputElement).name,
    );
    const nome = focaveis.indexOf('nome');
    expect(focaveis.slice(nome - 3, nome + 2)).toEqual(['Alterar Corte (09:00 com Ana)', 'Alterar Escova (10:00 com Bia)', 'Alterar serviços', 'nome', 'telefone']);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeTruthy();
    expect(estadoInicialReserva('x').status).toBe('editando');
    semModeloAntigo(container);
  });

  it('limitado: só o aviso de limite, sem formulário', () => {
    const { container } = montar({ visao: { passo: 'limitado' } });
    expect(screen.getByText('Muitas tentativas. Aguarde alguns minutos e tente novamente.')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
  });
});

describe('PaginaDoSalao: avaliações (D-032, CA-3, CA-15)', () => {
  it('sem a propriedade (vitrine de reserva), não há seção de avaliações', () => {
    montar();
    expect(screen.queryByRole('heading', { level: 2, name: 'Avaliações' })).toBeNull();
  });

  it('com avaliações: a seção aparece depois da equipe, com média e contagem', () => {
    montar({ avaliacoes: { total: 2, media: 4.5, itens: [{ id: 'id-1', nome: 'Maria S.', nota: 5, comentario: 'Ótimo', mesAno: 'novembro de 2026' }] } });
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titulos.indexOf('Avaliações')).toBeGreaterThan(titulos.indexOf('Equipe'));
    expect(screen.getByText('4,5')).toBeTruthy();
    expect(screen.getByText('Maria S.')).toBeTruthy();
  });

  it('sem avaliações: "Ainda sem avaliações"', () => {
    montar({ avaliacoes: { total: 0, media: null, itens: [] } });
    expect(screen.getByText('Ainda sem avaliações')).toBeTruthy();
  });
});
