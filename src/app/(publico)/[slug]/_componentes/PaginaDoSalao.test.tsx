/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';
import type { PerfilPublico } from '@/server/repos/publico';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';

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
const SELECAO = { servicos: SERVICOS, duracaoTotalMin: 75, precoTotalCentavos: 12000 };

function montar(o: Partial<PaginaDoSalaoProps> = {}) {
  const props: PaginaDoSalaoProps = {
    base: '/studio-bela',
    slug: 'studio-bela',
    perfil: COMPLETO,
    fotos: [{ id: 'f1', url: '/api/fotos/f1', alt: 'Recepção', largura: 800, altura: 600 }],
    servicos: SERVICOS,
    equipe: [{ id: P1, nome: 'Ana' }],
    decisao: { disponivel: true },
    visao: { passo: 'servicos', aviso: null },
    chave: '44444444-4444-4444-8444-444444444444',
    acao: vi.fn(async (anterior) => anterior),
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

describe('PaginaDoSalao: passos', () => {
  it('serviços: checkboxes "s" por GET com preço e duração em pt-BR e o aviso', () => {
    const { container } = montar({ visao: { passo: 'servicos', aviso: 'horario_indisponivel' } });
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/studio-bela');
    const caixas = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(caixas.map((c) => [c.name, c.value])).toEqual([['s', S1], ['s', S2]]);
    expect(within(form).getByText(/R\$\s*50,00/)).toBeTruthy();
    expect(screen.getByText(/30 min/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Este horário não está mais disponível');
    // A lista só-leitura não duplica os serviços no primeiro passo.
    expect(screen.getAllByRole('heading', { level: 2, name: 'Serviços' })).toHaveLength(1);
  });

  it('profissional: "Sem preferência" marcada, serviços preservados em campos ocultos', () => {
    const visao: VisaoDoPasso = { passo: 'profissional', s: [S1, S2], selecao: SELECAO, profissionais: [{ id: P1, nome: 'Ana' }], aviso: null };
    const { container } = montar({ visao });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([['qualquer', true], [P1, false]]);
    expect([...container.querySelectorAll('input[type=hidden][name=s]')].map((i) => (i as HTMLInputElement).value)).toEqual([S1, S2]);
    expect(screen.getByText(/1 h 15 min/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alterar serviços' }).getAttribute('href')).toBe('/studio-bela');
  });

  it('data: dias com horários são links; sem horários são texto; navegação entre páginas', () => {
    const visao: VisaoDoPasso = {
      passo: 'data',
      s: [S1],
      p: 'qualquer',
      selecao: SELECAO,
      de: '2026-12-01',
      dias: [
        { data: '2026-12-01', temHorarios: true },
        { data: '2026-12-06', temHorarios: false },
      ],
      anterior: '2026-11-20',
      proxima: '2026-12-15',
      aviso: null,
    };
    montar({ visao });
    expect(screen.getByRole('link', { name: 'Terça-feira, 01/12/2026' }).getAttribute('href')).toBe(
      `/studio-bela?s=${S1}&p=qualquer&data=2026-12-01`,
    );
    expect(screen.getByText('Domingo, 06/12/2026 (sem horários)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dias anteriores' }).getAttribute('href')).toContain('de=2026-11-20');
    expect(screen.getByRole('link', { name: 'Próximos dias' }).getAttribute('href')).toContain('de=2026-12-15');
  });

  it('horário: rádios "h" no fuso do salão e campos ocultos do fluxo', () => {
    const visao: VisaoDoPasso = {
      passo: 'horario', s: [S1], p: 'qualquer', data: '2026-12-01', selecao: SELECAO, fuso: 'America/Sao_Paulo',
      horarios: [H, '2026-12-01T12:30:00.000Z'], aviso: null,
    };
    const { container } = montar({ visao });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [r.name, r.value])).toEqual([['h', H], ['h', '2026-12-01T12:30:00.000Z']]);
    expect(screen.getByText('09:00')).toBeTruthy();
    expect(screen.getByText('09:30')).toBeTruthy();
    expect(container.querySelector('input[type=hidden][name=data]')).toHaveProperty('value', '2026-12-01');
  });

  it('horário sem opções: mensagem e caminho para outro dia, sem botão de continuar', () => {
    const visao: VisaoDoPasso = { passo: 'horario', s: [S1], p: 'qualquer', data: '2026-12-01', selecao: SELECAO, fuso: 'America/Sao_Paulo', horarios: [], aviso: null };
    montar({ visao });
    expect(screen.getByText('Nenhum horário disponível neste dia.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Escolher outro dia' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  });

  it('dados: resumo no fuso do salão, campos ocultos e formulário com consentimento', () => {
    const visao: VisaoDoPasso = {
      passo: 'dados', s: [S1, S2], p: 'qualquer', data: '2026-12-01', selecao: SELECAO, fuso: 'America/Sao_Paulo',
      inicioIso: H, profissional: { id: P1, nome: 'Ana' },
    };
    const { container } = montar({ visao });
    expect(screen.getByText('Profissional: Ana')).toBeTruthy();
    expect(screen.getByText('Quando: 01/12/2026 09:00')).toBeTruthy();
    const oculto = (n: string) => (container.querySelector(`input[type=hidden][name=${n}]`) as HTMLInputElement).value;
    expect([oculto('slug'), oculto('profissionalId'), oculto('inicio'), oculto('chave'), oculto('p'), oculto('data')]).toEqual([
      'studio-bela', P1, H, '44444444-4444-4444-8444-444444444444', 'qualquer', '2026-12-01',
    ]);
    expect(screen.getByRole('textbox', { name: /Nome/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Telefone/ })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeTruthy();
    expect(estadoInicialReserva('x').status).toBe('editando');
  });
});
