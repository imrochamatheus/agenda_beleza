import { describe, expect, it } from 'vitest';

import type { ResultadoReservaEquipe } from '@/server/reservas/reserva-equipe';
import type { ReservaCriada } from '@/server/reservas/tipos';

import {
  aplicarLinha,
  estadoInicial,
  idDaLinha,
  idDoCampo,
  lerFormularioReservaManual,
  MAXIMO_LINHAS,
  MENSAGENS_FORMULARIO_RESERVA,
  paraEstado,
  textoDosMotivos,
  valoresVazios,
} from './estado';
import type { ValoresReservaManual } from './estado';

// D-029 / D-050 §3.11: conversão pura FormData ↔ estado de N linhas (sem banco, sem next/*).
const P = { chave: 'k1', novaChave: 'k2', baseAgenda: '/painel/agenda' };
const valores: ValoresReservaManual = valoresVazios({
  data: '2026-12-01',
  itens: [
    { servicoId: 's1', profissionalId: 'p1', hora: '09:00' },
    { servicoId: 's2', profissionalId: 'p2', hora: '10:00' },
    { servicoId: 's3', profissionalId: 'p3', hora: '13:00' },
  ],
  nome: 'Ana',
  telefone: '11 91234-5678',
  mensagens: true,
  confirmarEncaixe: true,
});
const item = (servicoId: string, profissionalId: string, h: number, encaixe = false) => ({
  id: `i-${servicoId}`, servicoId, profissionalId, ordem: 0,
  inicio: new Date(Date.UTC(2026, 11, 1, h)), fim: new Date(Date.UTC(2026, 11, 1, h + 1)), ocupadoAte: new Date(Date.UTC(2026, 11, 1, h + 1)),
  precoCentavos: 5000, duracaoMin: 60, encaixe, status: 'confirmado' as const,
});
const reserva = (itens: ReservaCriada['itens']): ReservaCriada => ({
  id: 'r', clienteId: 'c', inicio: itens[0].inicio, fim: itens[itens.length - 1].fim, status: 'confirmado', origem: 'equipe', revisao: 0, itens,
});

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

describe('lerFormularioReservaManual', () => {
  it('lê data, a quantidade de linhas e os campos item-<n>-*; "on" confirma e só "on"', () => {
    const fd = formulario({
      data: '2026-12-01', itens: '2',
      'item-1-servico': 'a', 'item-1-profissional': 'p1', 'item-1-hora': '09:00',
      'item-2-servico': 'b', 'item-2-profissional': 'p2', 'item-2-hora': '10:00',
      'item-3-servico': 'ignorado',
      nome: 'Ana', telefone: '1', consentimento_mensagens: 'on', confirmarEncaixe: 'sim', chave: 'k', estranho: 'x',
    });
    const { entrada, valores: v, chave, linha } = lerFormularioReservaManual(fd);
    expect(entrada).toEqual({
      data: '2026-12-01',
      itens: [
        { servicoId: 'a', profissionalId: 'p1', hora: '09:00' },
        { servicoId: 'b', profissionalId: 'p2', hora: '10:00' },
      ],
      nome: 'Ana', telefone: '1', aceites: { mensagensReserva: 'on' }, confirmarEncaixe: 'sim', chaveRequisicao: 'k',
    });
    expect(v.itens).toHaveLength(2);
    expect(v.mensagens).toBe(true);
    expect(v.confirmarEncaixe).toBe(false);
    expect(chave).toBe('k');
    expect(linha).toBeNull();
  });

  it.each([
    ['', 1], ['0', 1], ['abc', 1], ['99', MAXIMO_LINHAS], ['3', 3], ['123', 1],
  ])('quantidade %j → %i linha(s)', (itens, n) => {
    expect(lerFormularioReservaManual(formulario({ itens })).entrada.itens).toHaveLength(n);
  });

  it.each([
    ['adicionar', '1', { tipo: 'adicionar' }],
    ['remover:2', '3', { tipo: 'remover', indice: 1 }],
    ['remover:4', '3', null],
    ['remover:0', '3', null],
    ['remover:x', '3', null],
    ['outra', '3', null],
  ])('linha=%j com %s linhas → %j', (l, itens, esperado) => {
    expect(lerFormularioReservaManual(formulario({ linha: l, itens })).linha).toEqual(esperado);
  });

  it('formulário vazio: uma linha vazia, sem chave; eco cortado nos tetos; arquivo vale como vazio', () => {
    const vazio = lerFormularioReservaManual(new FormData());
    expect(vazio.entrada.chaveRequisicao).toBeNull();
    expect(vazio.entrada.aceites).toEqual({ mensagensReserva: null });
    expect(vazio.valores.itens).toEqual([{ servicoId: '', profissionalId: '', hora: '' }]);
    const fd = formulario({ nome: 'n'.repeat(500), telefone: '9'.repeat(500), 'item-1-hora': '123456', 'item-1-servico': 'x'.repeat(90) });
    fd.set('data', new File(['x'], 'x.txt'));
    const { valores: v, entrada } = lerFormularioReservaManual(fd);
    expect(v.nome).toHaveLength(100);
    expect(v.telefone).toHaveLength(30);
    expect(v.itens[0].hora).toBe('12345');
    expect(v.itens[0].servicoId).toHaveLength(40);
    expect(entrada.data).toBe('');
  });
});

describe('aplicarLinha (sem gravar, CA-36)', () => {
  it('adicionar: uma linha vazia a mais, tudo preservado, status e foco na nova linha; confirmação desmarcada', () => {
    const e = aplicarLinha(valores, 'k', { tipo: 'adicionar' });
    expect(e.valores.itens).toEqual([...valores.itens, { servicoId: '', profissionalId: '', hora: '' }]);
    expect(e.valores).toMatchObject({ data: '2026-12-01', nome: 'Ana', telefone: '11 91234-5678', mensagens: true, confirmarEncaixe: false });
    expect(e.statusLinha).toBe('Linha de serviço adicionada.');
    expect(e.foco).toBe(3);
    expect(e.chave).toBe('k');
    expect(e.encaixe).toBeNull();
  });

  it('adicionar com 10 linhas não passa de 10', () => {
    const cheio = { ...valores, itens: Array.from({ length: 10 }, (_, k) => ({ servicoId: `s${k}`, profissionalId: 'p', hora: '09:00' })) };
    const e = aplicarLinha(cheio, 'k', { tipo: 'adicionar' });
    expect(e.valores.itens).toHaveLength(10);
    expect(e.statusLinha).toBeNull();
  });

  it('remover a linha 2: as outras ficam, renumeradas; status "Serviço 2 removido." e foco na legenda anterior', () => {
    const e = aplicarLinha(valores, 'k', { tipo: 'remover', indice: 1 });
    expect(e.valores.itens.map((l) => l.servicoId)).toEqual(['s1', 's3']);
    expect(e.statusLinha).toBe('Serviço 2 removido.');
    expect(e.foco).toBe(0);
    expect(aplicarLinha(valores, 'k', { tipo: 'remover', indice: 0 }).foco).toBe(0);
  });

  it('com uma linha só, remover não faz nada', () => {
    const um = { ...valores, itens: [valores.itens[0]] };
    const e = aplicarLinha(um, 'k', { tipo: 'remover', indice: 0 });
    expect(e.valores.itens).toEqual(um.itens);
    expect(e.statusLinha).toBeNull();
  });
});

describe('paraEstado', () => {
  it('criada: chave nova, formulário limpo (data e profissional da 1ª linha), itens do roteiro e link da agenda', () => {
    const r: ResultadoReservaEquipe = {
      resultado: 'criada',
      reserva: reserva([item('s1', 'p1', 12), item('s2', 'p2', 13, true)]),
      confirmacao: { mensagemId: 'm', estado: 'pendente' },
    };
    const c = paraEstado(r, valores, P);
    expect(c.chave).toBe('k2');
    expect(c.valores).toEqual(valoresVazios({ data: '2026-12-01', itens: [{ servicoId: '', profissionalId: 'p1', hora: '' }] }));
    expect(c.criada).toEqual({
      repetida: false,
      encaixes: 1,
      hrefAgenda: '/painel/agenda?data=2026-12-01&visao=dia',
      itens: [
        { servicoId: 's1', profissionalId: 'p1', inicioIso: '2026-12-01T12:00:00.000Z', fimIso: '2026-12-01T13:00:00.000Z', duracaoMin: 60, encaixe: false },
        { servicoId: 's2', profissionalId: 'p2', inicioIso: '2026-12-01T13:00:00.000Z', fimIso: '2026-12-01T14:00:00.000Z', duracaoMin: 60, encaixe: true },
      ],
    });
    const rep = paraEstado({ resultado: 'repetida', reserva: reserva([item('s1', 'p1', 12)]) }, valores, P);
    expect(rep.criada).toMatchObject({ repetida: true, encaixes: 0, hrefAgenda: '/painel/agenda?data=2026-12-01&visao=dia&profissional=p1' });
  });

  it('encaixe_requer_confirmacao: itens com motivo, dados e a MESMA chave', () => {
    const e = paraEstado({ resultado: 'encaixe_requer_confirmacao', motivos: [{ indice: 1, motivos: ['bloqueado'] }] }, valores, P);
    expect(e.encaixe).toEqual([{ indice: 1, motivos: ['bloqueado'] }]);
    expect(e.valores).toBe(valores);
    expect(e.chave).toBe('k1');
    expect(e.criada).toBeNull();
    expect(e.mensagem).toBeNull();
  });

  it('horário ocupado e profissional indisponível vão para a linha; sem índice, mensagem geral', () => {
    const a = paraEstado({ resultado: 'horario_indisponivel', causa: 'revalidacao', itens: [0, 2] }, valores, P);
    expect(a.errosPorLinha).toEqual({ 0: { hora: MENSAGENS_FORMULARIO_RESERVA.ocupado }, 2: { hora: MENSAGENS_FORMULARIO_RESERVA.ocupado } });
    expect(paraEstado({ resultado: 'horario_indisponivel', causa: '23P01', itens: [] }, valores, P).mensagem).toBe(MENSAGENS_FORMULARIO_RESERVA.ocupadoGeral);
    const p = paraEstado({ resultado: 'profissional_indisponivel', itens: [1] }, valores, P);
    expect(p.errosPorLinha).toEqual({ 1: { profissional: MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel } });
    expect(paraEstado({ resultado: 'profissional_indisponivel', itens: [] }, valores, P).mensagem).toBe(MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel);
  });

  it('cada desfecho geral vira mensagem, nunca criada, com a mesma chave', () => {
    const casos: [ResultadoReservaEquipe, string][] = [
      [{ resultado: 'servico_indisponivel' }, MENSAGENS_FORMULARIO_RESERVA.servicoIndisponivel],
      [{ resultado: 'chave_reutilizada' }, MENSAGENS_FORMULARIO_RESERVA.chaveReutilizada],
      [{ resultado: 'salao_indisponivel' }, MENSAGENS_FORMULARIO_RESERVA.salaoIndisponivel],
      [{ resultado: 'recusado', motivo: 'xis' }, 'xis'],
      [{ resultado: 'consentimento_ausente', erros: {} }, MENSAGENS_FORMULARIO_RESERVA.generico],
    ];
    for (const [r, esperado] of casos) {
      const e = paraEstado(r, valores, P);
      expect(e.mensagem, r.resultado).toBe(esperado);
      expect(e.criada).toBeNull();
      expect(e.chave).toBe('k1');
    }
  });

  it('invalido: gerais e por linha (inicio → hora); chave inválida vira mensagem; vazio vira genérico', () => {
    const a = paraEstado(
      {
        resultado: 'invalido',
        erros: { data: 'd', itens: 'q', nome: 'n', telefone: 't', porItem: { 1: { servico: 's', profissional: 'p', inicio: 'i' }, 2: {} } },
      },
      valores,
      P,
    );
    expect(a.erros).toEqual({ data: 'd', itens: 'q', nome: 'n', telefone: 't' });
    expect(a.errosPorLinha).toEqual({ 1: { servico: 's', profissional: 'p', hora: 'i' }, 2: {} });
    expect(a.mensagem).toBeNull();
    expect(paraEstado({ resultado: 'invalido', erros: { chave: 'c' } }, valores, P).mensagem).toBe('c');
    expect(paraEstado({ resultado: 'invalido', erros: {} }, valores, P).mensagem).toBe(MENSAGENS_FORMULARIO_RESERVA.generico);
  });
});

describe('auxiliares', () => {
  it('estado inicial, ids, textos com plural por regra e motivos curtos', () => {
    expect(estadoInicial('k', valores)).toEqual({
      mensagem: null, statusLinha: null, erros: {}, errosPorLinha: {}, valores, chave: 'k', encaixe: null, criada: null, foco: null,
    });
    expect(idDoCampo('data')).toBe('reserva-data');
    expect(idDaLinha(1, 'hora')).toBe('item-2-hora');
    expect(MENSAGENS_FORMULARIO_RESERVA.criadaEncaixe(1)).toBe('Reserva registrada com encaixe em 1 serviço.');
    expect(MENSAGENS_FORMULARIO_RESERVA.criadaEncaixe(2)).toBe('Reserva registrada com encaixe em 2 serviços.');
    expect(textoDosMotivos(['bloqueado', 'fora_do_funcionamento'])).toBe('horário bloqueado; fora do funcionamento.');
    expect(MENSAGENS_FORMULARIO_RESERVA.ajudaLinhas).not.toContain('mesmo profissional');
  });
});
