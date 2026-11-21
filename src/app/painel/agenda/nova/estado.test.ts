import { describe, expect, it } from 'vitest';

import { MENSAGEM_HORARIO_INDISPONIVEL } from '@/server/reservas/tipos';
import type { ReservaCriada, ResultadoCriarReserva } from '@/server/reservas/tipos';

import { estadoInicial, idDoCampo, lerFormularioReservaManual, MENSAGENS_FORMULARIO_RESERVA, paraEstado, valoresVazios } from './estado';

// D-029: conversão pura FormData ↔ estado (sem banco, sem next/*).
const P = { chave: 'k1', novaChave: 'k2', baseAgenda: '/painel/agenda' };
const valores = valoresVazios({ profissionalId: 'p1', data: '2026-12-01', hora: '10:00', nome: 'Ana', telefone: '11 91234-5678', servicoIds: ['s1'], mensagens: true });
const reserva = (encaixe: boolean): ReservaCriada => ({
  id: 'r', profissionalId: 'p1', clienteId: 'c', inicio: new Date(0), fim: new Date(0), ocupadoAte: new Date(0),
  status: 'confirmado', origem: 'equipe', encaixe, revisao: 0, itens: [],
});

describe('lerFormularioReservaManual', () => {
  it('lê só os nomes conhecidos; "on" confirma e só "on"', () => {
    const fd = new FormData();
    fd.append('s', 'a');
    fd.append('s', 'b');
    fd.set('profissionalId', 'p1');
    fd.set('data', '2026-12-01');
    fd.set('hora', '10:00');
    fd.set('nome', 'Ana');
    fd.set('telefone', '1');
    fd.set('consentimento_mensagens', 'on');
    fd.set('confirmarEncaixe', 'sim');
    fd.set('chave', 'k');
    fd.set('estranho', 'x');
    const { entrada, valores: v, chave } = lerFormularioReservaManual(fd);
    expect(entrada).toEqual({
      servicoIds: ['a', 'b'], profissionalId: 'p1', data: '2026-12-01', hora: '10:00', nome: 'Ana', telefone: '1',
      aceites: { mensagensReserva: 'on' }, confirmarEncaixe: 'sim', chaveRequisicao: 'k',
    });
    expect(v.mensagens).toBe(true);
    expect(v.confirmarEncaixe).toBe(false);
    expect(chave).toBe('k');
  });

  it('formulário vazio: tudo vazio, sem chave; eco cortado nos tetos', () => {
    const vazio = lerFormularioReservaManual(new FormData());
    expect(vazio.entrada.chaveRequisicao).toBeNull();
    expect(vazio.entrada.aceites).toEqual({ mensagensReserva: null });
    const fd = new FormData();
    fd.set('nome', 'n'.repeat(500));
    fd.set('telefone', '9'.repeat(500));
    fd.set('nome', 'n'.repeat(500));
    const { valores: v } = lerFormularioReservaManual(fd);
    expect(v.nome).toHaveLength(100);
    expect(v.telefone).toHaveLength(30);
  });

  it('arquivo no lugar de texto vale como vazio', () => {
    const fd = new FormData();
    fd.set('nome', new File(['x'], 'x.txt'));
    expect(lerFormularioReservaManual(fd).entrada.nome).toBe('');
  });
});

describe('paraEstado', () => {
  it('criada: chave nova, formulário limpo (mantém profissional e data) e link da agenda; encaixe e repetida', () => {
    const c = paraEstado({ resultado: 'criada', reserva: reserva(true), confirmacao: { mensagemId: 'm', estado: 'pendente' } }, valores, P);
    expect(c.chave).toBe('k2');
    expect(c.valores).toEqual(valoresVazios({ profissionalId: 'p1', data: '2026-12-01' }));
    expect(c.criada).toEqual({ encaixe: true, repetida: false, hrefAgenda: '/painel/agenda?data=2026-12-01&visao=dia&profissional=p1' });
    const rep = paraEstado({ resultado: 'repetida', reserva: reserva(false) }, valores, P);
    expect(rep.criada).toMatchObject({ encaixe: false, repetida: true });
  });

  it('encaixe_requer_confirmacao: motivos, aviso, dados e a MESMA chave', () => {
    const e = paraEstado({ resultado: 'encaixe_requer_confirmacao', motivos: ['bloqueado'] }, valores, P);
    expect(e.motivos).toEqual(['bloqueado']);
    expect(e.mensagem).toContain('confirme o encaixe');
    expect(e.valores).toBe(valores);
    expect(e.chave).toBe('k1');
    expect(e.criada).toBeNull();
  });

  it('cada desfecho de negócio vira mensagem ou erro de campo, nunca criada', () => {
    const casos: [ResultadoCriarReserva, (e: ReturnType<typeof paraEstado>) => unknown, unknown][] = [
      [{ resultado: 'horario_indisponivel', causa: '23P01' }, (e) => e.mensagem, MENSAGEM_HORARIO_INDISPONIVEL],
      [{ resultado: 'servico_indisponivel' }, (e) => e.erros.servicos, MENSAGENS_FORMULARIO_RESERVA.servicoIndisponivel],
      [{ resultado: 'profissional_indisponivel' }, (e) => e.erros.profissional, MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel],
      [{ resultado: 'chave_reutilizada' }, (e) => e.mensagem, MENSAGENS_FORMULARIO_RESERVA.chaveReutilizada],
      [{ resultado: 'salao_indisponivel' }, (e) => e.mensagem, MENSAGENS_FORMULARIO_RESERVA.salaoIndisponivel],
      [{ resultado: 'recusado', motivo: 'xis' }, (e) => e.mensagem, 'xis'],
      [{ resultado: 'consentimento_ausente', erros: {} }, (e) => e.mensagem, MENSAGENS_FORMULARIO_RESERVA.generico],
    ];
    for (const [r, ler, esperado] of casos) {
      const e = paraEstado(r, valores, P);
      expect(ler(e), r.resultado).toBe(esperado);
      expect(e.criada).toBeNull();
      expect(e.chave).toBe('k1');
    }
  });

  it('invalido: erros por campo (inicio vai para data); chave inválida vira mensagem; vazio vira genérico', () => {
    const a = paraEstado({ resultado: 'invalido', erros: { servicos: 's', inicio: 'i', nome: 'n', telefone: 't' } }, valores, P);
    expect(a.erros).toEqual({ servicos: 's', data: 'i', nome: 'n', telefone: 't' });
    expect(a.mensagem).toBeNull();
    expect(paraEstado({ resultado: 'invalido', erros: { chave: 'c' } }, valores, P).mensagem).toBe('c');
    expect(paraEstado({ resultado: 'invalido', erros: {} }, valores, P).mensagem).toBe(MENSAGENS_FORMULARIO_RESERVA.generico);
  });
});

describe('auxiliares', () => {
  it('estado inicial e id do campo', () => {
    expect(estadoInicial('k', valores)).toEqual({ mensagem: null, erros: {}, valores, chave: 'k', motivos: null, criada: null });
    expect(idDoCampo('hora')).toBe('reserva-hora');
  });
});
