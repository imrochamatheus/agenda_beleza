import { describe, expect, it } from 'vitest';

import type { DetalheDaReserva, ItemDoDetalhe } from '@/server/agenda/tipos';

import { NADA_ABERTO } from './estado';
import { montarAcoes } from './montagem';

// D-050 web-design §5.10: props do roteiro interativo a partir do detalhe (pura, compartilhada com a vitrine).
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
const reserva = (itens: ItemDoDetalhe[], p: Partial<DetalheDaReserva> = {}): DetalheDaReserva => ({
  id: 'r1',
  clienteId: 'c1',
  fuso: 'America/Sao_Paulo',
  clienteNome: 'Maria',
  anonimizada: false,
  contato: null,
  data: { ano: 2026, mes: 11, dia: 26 },
  status: 'confirmado',
  origem: 'equipe',
  temFalhaDeMensagem: false,
  itens,
  total: { centavos: 9000, servicos: 1, rotulo: 'reserva' },
  temItemCancelado: false,
  podeCancelarTodos: false,
  papel: 'gestor',
  ...p,
});

describe('montarAcoes', () => {
  it('nada aberto: sem formulário de remarcar nem textos de confirmação; itens com a hora local', () => {
    const d = montarAcoes({ reserva: reserva([item({})]), abrir: NADA_ABERTO, servicos: [], profissionais: [] });
    expect(d.remarcar).toBeNull();
    expect(d.textos).toEqual({ cancelarItem: null, cancelarTodos: null });
    expect(d.itens).toEqual([{ id: 'i1', servico: 'Escova', hora: '09:00', acoes: item({}).acoes }]);
    expect(d.paradas.map((p) => p.estado)).toEqual(['escolhida']);
  });

  it('remarcar: o serviço atual aparece mesmo inativo ou fora da lista; inativos e repetidos de outros itens ficam fora', () => {
    const itens = [item({}), item({ id: 'i2', servicoId: 's2', status: 'cancelado' })];
    const servicos = [
      { id: 's1', nome: 'Escova', ativo: false, precoCentavos: 9000, duracaoMin: 60 },
      { id: 's2', nome: 'Hidratação', ativo: true, precoCentavos: 7500, duracaoMin: 40 },
      { id: 's3', nome: 'Velho', ativo: false, precoCentavos: 1000, duracaoMin: 30 },
      { id: 's4', nome: 'Corte', ativo: true, precoCentavos: 8000, duracaoMin: 60 },
    ];
    const d = montarAcoes({ reserva: reserva(itens), abrir: { ...NADA_ABERTO, remarcar: 'i1' }, servicos, profissionais: [{ id: 'p1', nome: 'Ana' }] });
    expect(d.remarcar!.servicos.map((s) => s.valor)).toEqual(['s1', 's4']);
    expect(d.remarcar!.servicos[0].rotulo).toMatch(/^Escova · 1 h · R\$\s*90,00 \(inativo\)$/);
    // Só o item cancelado além dele: a data é campo (RN-22 conta só os não cancelados).
    expect(d.remarcar!.dataFixa).toBeNull();
    expect(d.remarcar!.valores).toEqual({ servicoId: 's1', profissionalId: 'p1', data: '2026-11-26', hora: '09:00', confirmarEncaixe: false });
    expect(d.paradas.map((p) => p.estado)).toEqual(['destaque', 'cancelada']);
    const fora = montarAcoes({ reserva: reserva([item({})]), abrir: { ...NADA_ABERTO, remarcar: 'i1' }, servicos: [], profissionais: [] });
    expect(fora.remarcar!.servicos).toEqual([{ valor: 's1', rotulo: 'Escova' }]);
  });

  it('DEF-1: gestor com o profissional atual inativo começa sem seleção e recebe o nome para a ajuda', () => {
    const d = montarAcoes({
      reserva: reserva([item({ profissionalAtivo: false, profissionalNome: 'Bia' })]),
      abrir: { ...NADA_ABERTO, remarcar: 'i1' },
      servicos: [],
      profissionais: [{ id: 'p2', nome: 'Ana' }],
    });
    expect(d.remarcar).toMatchObject({ profissionalInativo: 'Bia', valores: { profissionalId: '' } });
    const ativo = montarAcoes({ reserva: reserva([item({})]), abrir: { ...NADA_ABERTO, remarcar: 'i1' }, servicos: [], profissionais: [] });
    expect(ativo.remarcar).toMatchObject({ profissionalInativo: null, valores: { profissionalId: 'p1' } });
  });

  it('profissional: sem opções de profissional e sem id enviado; cancelar aberto destaca o item e monta o texto', () => {
    const d = montarAcoes({ reserva: reserva([item({})], { papel: 'profissional' }), abrir: { ...NADA_ABERTO, remarcar: 'i1' }, servicos: [], profissionais: [{ id: 'p9', nome: 'X' }] });
    expect(d.remarcar).toMatchObject({ profissionais: null, profissionalFixo: 'Ana', valores: { profissionalId: '' } });
    const c = montarAcoes({ reserva: reserva([item({})], { podeCancelarTodos: true }), abrir: { ...NADA_ABERTO, cancelar: 'i1' }, servicos: [], profissionais: [] });
    expect(c.paradas[0].estado).toBe('destaque');
    expect(c.textos.cancelarItem).toMatch(/^Cancelar Escova \(09:00 com Ana\)\?/);
    expect(c.textos.cancelarTodos).toMatch(/^Cancelar o serviço que ainda pode ser cancelado \(Escova 09:00\)/);
  });
});
