import { describe, expect, it } from 'vitest';

import type { DetalheDaReserva, ItemDoDetalhe } from '@/server/agenda/tipos';

import {
  codigoPrgDeStatus,
  estadoRemarcarInicial,
  hrefCancelar,
  hrefCancelarTodos,
  hrefDoResultado,
  hrefRemarcar,
  lerAbertura,
  lerFormularioRemarcar,
  lerResultadoPrg,
  MENSAGENS_FORMULARIO_ALTERACAO,
  mensagemDaRecusaDeStatus,
  mensagemDeErro,
  mensagemDoResultado,
  NADA_ABERTO,
  paraEstadoRemarcar,
  textoConfirmarCancelamento,
  textoConfirmarCancelarTodos,
} from './estado';
import type { ValoresRemarcar } from './estado';

// D-050 web-design §5.10 e design §1.3 C2: abertura por GET, PRG com lista fechada, formulários por item.
const SP = 'America/Sao_Paulo';
const valores: ValoresRemarcar = { servicoId: 's1', profissionalId: 'p1', data: '2026-11-26', hora: '09:00', confirmarEncaixe: false };
const todas = { remarcar: true, cancelar: true, concluir: false, naoCompareceu: false };
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
  acoes: todas,
  ...p,
});
const ESCOVA = item({});
const MANICURE = item({ id: 'i3', servicoNome: 'Manicure', profissionalId: 'p3', profissionalNome: 'Bia', inicio: new Date('2026-11-26T18:00:00Z') });
const CANCELADA = item({ id: 'i2', servicoNome: 'Hidratação', status: 'cancelado', acoes: nenhuma });
const detalhe: Pick<DetalheDaReserva, 'itens' | 'fuso' | 'podeCancelarTodos'> = { itens: [ESCOVA, CANCELADA, MANICURE], fuso: SP, podeCancelarTodos: true };

describe('resultado do PRG', () => {
  it('lista fechada; parâmetros extras validados; repetidos valem como ausentes', () => {
    expect(lerResultadoPrg({ resultado: 'cancelado', item: 'i1' })).toEqual({ codigo: 'cancelado', itemId: 'i1', de: null, n: null });
    expect(lerResultadoPrg({ resultado: 'remarcado', item: 'i1', de: '09:00' })).toMatchObject({ de: '09:00' });
    expect(lerResultadoPrg({ resultado: 'todos_cancelados', n: '2' })).toMatchObject({ n: 2 });
    expect(lerResultadoPrg({ resultado: 'remarcado', item: '<b>', de: '25:00', n: '11' })).toEqual({ codigo: 'remarcado', itemId: null, de: null, n: null });
    expect(lerResultadoPrg({ resultado: '<script>' })).toBeNull();
    expect(lerResultadoPrg({ resultado: ['cancelado'] })).toBeNull();
    expect(lerResultadoPrg({})).toBeNull();
  });

  it('href com âncora #resultado; base com query (vitrine) usa &', () => {
    expect(hrefDoResultado('/r/1', { codigo: 'cancelado', itemId: 'i1' })).toBe('/r/1?resultado=cancelado&item=i1#resultado');
    expect(hrefDoResultado('/r/1', { codigo: 'remarcado', itemId: 'i1', de: '09:00' })).toBe('/r/1?resultado=remarcado&item=i1&de=09%3A00#resultado');
    expect(hrefDoResultado('/dev?vista=futura', { codigo: 'todos_cancelados', n: 2 })).toBe('/dev?vista=futura&resultado=todos_cancelados&n=2#resultado');
  });

  it('textos do web-design §5.10 a partir da leitura da página (nome e hora nunca vêm da URL)', () => {
    const r = (codigo: Parameters<typeof hrefDoResultado>[1]['codigo'], extra: object = {}) =>
      mensagemDoResultado({ codigo, itemId: 'i1', de: null, n: null, ...extra }, detalhe);
    expect(r('remarcado', { de: '08:00' })).toBe('Escova (08:00) foi remarcado para 09:00 com Ana.');
    expect(r('remarcado')).toBe('Escova foi remarcado para 09:00 com Ana.');
    expect(r('cancelado')).toBe('Escova (09:00) foi cancelado. A cliente será avisada se tiver aceitado as mensagens.');
    expect(r('concluido')).toBe('Escova marcado como concluído.');
    expect(r('nao_compareceu')).toBe('Escova marcado como não compareceu.');
    expect(r('todos_cancelados', { itemId: null, n: 2 })).toBe('2 serviços cancelados. A cliente receberá uma única mensagem.');
    expect(r('todos_cancelados', { itemId: null, n: 1 })).toBe('1 serviço cancelado. A cliente receberá uma única mensagem.');
    expect(mensagemDoResultado(null, detalhe)).toBeNull();
  });

  it('item ausente (adulterado ou de outro profissional): texto genérico', () => {
    const r = (codigo: 'remarcado' | 'cancelado' | 'concluido' | 'nao_compareceu') => mensagemDoResultado({ codigo, itemId: 'x', de: null, n: null }, detalhe);
    expect(r('remarcado')).toBe('Serviço remarcado.');
    expect(r('cancelado')).toBe('Serviço cancelado. A cliente será avisada se tiver aceitado as mensagens.');
    expect(r('concluido')).toBe('Serviço marcado como concluído.');
    expect(r('nao_compareceu')).toBe('Serviço marcado como não compareceu.');
  });
});

describe('abertura por GET', () => {
  it('só itens visíveis com a ação permitida; um formulário por vez', () => {
    expect(lerAbertura({ remarcar: 'i1' }, detalhe)).toEqual({ remarcar: 'i1', cancelar: null, cancelarTodos: false });
    expect(lerAbertura({ cancelar: 'i3' }, detalhe)).toEqual({ remarcar: null, cancelar: 'i3', cancelarTodos: false });
    expect(lerAbertura({ cancelar: 'todos' }, detalhe)).toEqual({ remarcar: null, cancelar: null, cancelarTodos: true });
    expect(lerAbertura({ remarcar: 'i1', cancelar: 'i3' }, detalhe)).toMatchObject({ remarcar: 'i1', cancelar: null });
    expect(lerAbertura({ remarcar: 'i2' }, detalhe)).toEqual(NADA_ABERTO);
    expect(lerAbertura({ cancelar: 'i2' }, detalhe)).toEqual(NADA_ABERTO);
    expect(lerAbertura({ remarcar: 'outro' }, detalhe)).toEqual(NADA_ABERTO);
    expect(lerAbertura({ remarcar: ['i1'] }, detalhe)).toEqual(NADA_ABERTO);
    expect(lerAbertura({ cancelar: 'todos' }, { ...detalhe, podeCancelarTodos: false })).toEqual(NADA_ABERTO);
  });

  it('links com a âncora do alvo', () => {
    expect(hrefRemarcar('/r/1', 'i1')).toBe('/r/1?remarcar=i1#remarcar');
    expect(hrefCancelar('/dev?vista=x', 'i1')).toBe('/dev?vista=x&cancelar=i1#cancelar');
    expect(hrefCancelarTodos('/r/1')).toBe('/r/1?cancelar=todos#cancelar-todos');
  });
});

describe('remarcar', () => {
  it('lê só os campos conhecidos e corta o eco nos tetos; `de` só no formato HH:MM', () => {
    const fd = new FormData();
    fd.set('reservaId', 'r1');
    fd.set('itemId', 'i1');
    fd.set('servicoId', 's'.repeat(60));
    fd.set('data', '2026-12-01999');
    fd.set('hora', '10:0099');
    fd.set('confirmarEncaixe', 'on');
    fd.set('de', '09:00');
    fd.set('arquivo', new File(['x'], 'a.txt'));
    const { entrada, valores: v, itemId, de } = lerFormularioRemarcar(fd);
    expect(entrada).toMatchObject({ reservaId: 'r1', itemId: 'i1', data: '2026-12-01999', profissionalId: '', confirmarEncaixe: 'on' });
    expect(v).toEqual({ servicoId: 's'.repeat(40), profissionalId: '', data: '2026-12-01', hora: '10:00', confirmarEncaixe: true });
    expect([itemId, de]).toEqual(['i1', '09:00']);
    fd.set('de', '<b>');
    expect(lerFormularioRemarcar(fd).de).toBeNull();
    expect(lerFormularioRemarcar(new FormData()).entrada).toMatchObject({ reservaId: '', itemId: '', hora: '', confirmarEncaixe: null });
  });

  it('cada desfecho tem o seu estado, com o item e os valores preservados', () => {
    const p = (r: Parameters<typeof paraEstadoRemarcar>[0]) => paraEstadoRemarcar(r, 'i1', valores);
    expect(p({ resultado: 'atualizada', itemId: 'i1', revisao: 1, encaixe: false, mensagem: { mensagemId: 'm', estado: 'pendente' } })).toEqual(estadoRemarcarInicial('i1', valores));
    expect(p({ resultado: 'encaixe_requer_confirmacao', motivos: ['bloqueado'] })).toMatchObject({ itemId: 'i1', motivos: ['bloqueado'], valores });
    expect(p({ resultado: 'horario_indisponivel', causa: '23P01' }).mensagem).toContain('não está mais disponível');
    expect(p({ resultado: 'horario_indisponivel', causa: 'entre_itens' }).mensagem).toBe('O novo horário coincide com outro serviço desta reserva.');
    expect(p({ resultado: 'servico_indisponivel' }).erros.servico).toBe(MENSAGENS_FORMULARIO_ALTERACAO.servicoIndisponivel);
    expect(p({ resultado: 'profissional_indisponivel' }).erros.profissional).toBe(MENSAGENS_FORMULARIO_ALTERACAO.profissionalIndisponivel);
    expect(p({ resultado: 'invalido', erros: { inicio: 'x', servico: 'y', data: 'z' } })).toMatchObject({ erros: { hora: 'x', servico: 'y', data: 'z' }, mensagem: null });
    expect(p({ resultado: 'invalido', erros: {} }).mensagem).toBeTruthy();
    expect(p({ resultado: 'invalido', erros: { profissional: 'Escolha a profissional.' } }).erros).toEqual({ profissional: 'Escolha a profissional.' });
    expect(p({ resultado: 'recusado', motivo: 'sem_alteracao' }).mensagem).toContain('Nenhuma alteração');
    expect(p({ resultado: 'recusado', motivo: 'data_diferente' }).mensagem).toContain('a data não pode mudar');
    expect(p({ resultado: 'recusado', motivo: 'servico_repetido' }).mensagem).toBe('Este serviço já faz parte desta reserva.');
  });
});

describe('situação, cancelar e erros', () => {
  it('código do PRG pelo status gravado; recusas e erros uniformes', () => {
    const r = (status: 'cancelado' | 'concluido' | 'nao_compareceu') =>
      codigoPrgDeStatus({ resultado: 'atualizada', itemId: 'i1', status, statusReserva: status, revisao: 0, mensagens: [] });
    expect([r('cancelado'), r('concluido'), r('nao_compareceu')]).toEqual(['cancelado', 'concluido', 'nao_compareceu']);
    expect(mensagemDaRecusaDeStatus('ja_terminada')).toBe('Este serviço já terminou e não pode mais ser cancelado.');
    expect(mensagemDaRecusaDeStatus('ainda_nao_iniciada')).toBe('Só é possível marcar o resultado depois do início do serviço.');
    expect(mensagemDaRecusaDeStatus('item_final')).toBe('Este serviço está cancelado.');
    expect([mensagemDeErro('acesso_negado'), mensagemDeErro('nao_encontrado'), mensagemDeErro('nao_autenticado')]).toEqual([
      'Acesso negado.',
      'Reserva não encontrada.',
      'Não foi possível concluir a ação. Tente de novo.',
    ]);
  });

  it('textos das confirmações (web-design §5.10)', () => {
    expect(textoConfirmarCancelamento(ESCOVA, SP)).toBe(
      'Cancelar Escova (09:00 com Ana)? O horário será liberado e a cliente será avisada, se tiver aceitado as mensagens. Os outros serviços continuam marcados.',
    );
    expect(textoConfirmarCancelarTodos([ESCOVA, MANICURE], SP)).toBe(
      'Cancelar os 2 serviços que ainda podem ser cancelados (Escova 09:00, Manicure 15:00)? Serviços concluídos ou já terminados ficam como estão. A cliente recebe uma única mensagem.',
    );
    expect(textoConfirmarCancelarTodos([ESCOVA], SP)).toMatch(/^Cancelar o serviço que ainda pode ser cancelado \(Escova 09:00\)\?/);
  });
});
