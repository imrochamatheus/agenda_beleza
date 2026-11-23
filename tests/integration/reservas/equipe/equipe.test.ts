import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReservaDaEquipe } from '@/server/reservas/reserva-equipe';
import { criarReservaManual } from '@/server/reservas/reservas-equipe.acao';
import { obterPrisma } from '@/server/repos/db';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { credencialDoGestor, credencialDoProfissional } from '../../../support/auth';
import { criarSalaoCompleto } from '../../../support/factories';
import { DIA, conferirDerivados, contarLinhas, criarCenarioReserva, inserirReservaDireta, sp } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

import { AGORA, ctxProfissional, enfileirar, entradaEquipe, linha, umaLinha } from './apoio';

// D-029 (E3.4): CA-1..CA-13, CA-17 e CA-18 contra PostgreSQL real, sem mocks de banco.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const criar = (c: Awaited<ReturnType<typeof criarCenarioReserva>>, sobre: Parameters<typeof entradaEquipe>[1] = {}, deps = {}) =>
  criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, sobre), AGORA, { enfileirar, ...deps });
/** Motivos do item 0 (casos de uma linha); null se não pediu confirmação. */
const motivosDe = (r: Awaited<ReturnType<typeof criarReservaDaEquipe>>) =>
  r.resultado === 'encaixe_requer_confirmacao' ? (r.motivos.find((m) => m.indice === 0)?.motivos ?? []) : null;
/** Flag de encaixe do item 0 da reserva criada. */
const encaixeDe = (r: Awaited<ReturnType<typeof criarReservaDaEquipe>>) => (r.resultado === 'criada' ? r.reserva.itens[0].encaixe : null);

describe('CA-1/CA-2: fora da jornada', () => {
  it('sem confirmar: nada gravado e motivo fora_da_jornada; confirmando: criada, equipe, encaixe', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '18:00']] });
    const antes = await contarLinhas(c.s.salaoId);
    const r1 = await criar(c, { ...umaLinha(c, '18:30') });
    expect(motivosDe(r1)).toEqual(['fora_da_jornada']);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);

    const r2 = await criar(c, { ...umaLinha(c, '18:30'), confirmarEncaixe: 'on' });
    expect(r2.resultado).toBe('criada');
    if (r2.resultado !== 'criada') return;
    expect(r2.reserva).toMatchObject({ status: 'confirmado', origem: 'equipe' });
    expect(r2.reserva.itens.map((i) => i.encaixe)).toEqual([true]);
    const gravada = await db().reserva.findUniqueOrThrow({ where: { id: r2.reserva.id }, include: { itens: true } });
    expect(gravada).toMatchObject({ status: 'confirmado', origem: 'equipe' });
    expect(gravada.itens.map((i) => [i.encaixe, i.inicio])).toEqual([[true, sp(DIA, '18:30')]]);
    await conferirDerivados(r2.reserva.id);
  });
});

describe('CA-3: sobreposição é sempre recusada, mesmo com encaixe', () => {
  it('18:45 sobre 18:30–19:00 com confirmação: horario_indisponivel e nada novo (nem cliente, nem mensagem)', async () => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '18:30'), fim: sp(DIA, '19:00') });
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criar(c, { ...umaLinha(c, '18:45'), confirmarEncaixe: true });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01', itens: [] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('dentro do horário normal, mas ocupado: também recusado (sem confirmar)', async () => {
    const c = await criarCenarioReserva();
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    expect((await criar(c, { ...umaLinha(c, '10:15') })).resultado).toBe('horario_indisponivel');
  });
});

describe('CA-4/CA-17: papel e isolamento', () => {
  it('profissional cria para si; para outra profissional do salão: AcessoNegado; de outro salão: NaoEncontrado', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarSalaoCompleto();
    const ctxP = ctxProfissional(c);
    const ok = await criarReservaDaEquipe(ctxP, entradaEquipe(c), AGORA, { enfileirar });
    expect(ok.resultado).toBe('criada');

    const antes = await contarLinhas(c.s.salaoId);
    await expect(criarReservaDaEquipe(ctxP, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: c.bia })), AGORA, { enfileirar })).rejects.toBeInstanceOf(AcessoNegado);
    await expect(
      criarReservaDaEquipe(ctxP, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: outro.profissional.profissionalId })), AGORA, { enfileirar }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('gestor: profissional ou serviço de outro salão nunca é aceito; malformado é 404', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarSalaoCompleto();
    await expect(
      criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: outro.profissional.profissionalId })), AGORA, { enfileirar }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: 'x' })), AGORA, { enfileirar })).rejects.toBeInstanceOf(NaoEncontrado);
    const doOutro = await contarLinhas(outro.salaoId);
    const r = await criar(c, umaLinha(c, '10:00', { servicoId: outro.servicos.ativos[0] }));
    expect(r.resultado).toBe('servico_indisponivel');
    expect(await contarLinhas(outro.salaoId)).toEqual(doOutro);
  });

  it('a cliente é do salão da sessão: o mesmo telefone em outro salão é outra cliente', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const a = await criar(c, { telefone });
    const b = await criarReservaDaEquipe(outro.ctxEquipe, entradaEquipe(outro, { telefone }), AGORA, { enfileirar });
    expect(a.resultado === 'criada' && b.resultado === 'criada' && a.reserva.clienteId !== b.reserva.clienteId).toBe(true);
  });

  it('a ação: gestor e profissional pela sessão real; sem a matriz, 403', async () => {
    const c = await criarCenarioReserva();
    const gestor = await credencialDoGestor(c.s);
    const prof = await credencialDoProfissional(c.s);
    const g = await criarReservaManual.executar(gestor, entradaEquipe(c), { agora: AGORA });
    expect(g.ok && g.dados.resultado).toBe('criada');
    const p = await criarReservaManual.executar(prof, entradaEquipe(c, umaLinha(c, '11:00')), { agora: AGORA });
    expect(p.ok && p.dados.resultado).toBe('criada');
    const negado = await criarReservaManual.executar(prof, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: c.bia })), { agora: AGORA });
    expect(negado).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    const outro = await criarSalaoCompleto();
    const naoAchou = await criarReservaManual.executar(gestor, entradaEquipe(c, umaLinha(c, '10:00', { profissionalId: outro.profissional.profissionalId })), { agora: AGORA });
    expect(naoAchou.ok).toBe(false);
    expect(!naoAchou.ok && naoAchou.status).toBe(404);
    const semSessao = await criarReservaManual.executar({ token: 'invalido' }, entradaEquipe(c), { agora: AGORA });
    expect(semSessao).toMatchObject({ ok: false, status: 401 });
  });
});

describe('CA-5: mensagens e consentimento declarados pela equipe', () => {
  it('sem declarar mensagens_reserva: criada, sem consentimento, mensagem nao_enviada e nenhum job', async () => {
    const c = await criarCenarioReserva();
    const fila = vi.fn(enfileirar);
    const r = await criar(c, { aceites: {} }, { enfileirar: fila });
    expect(r.resultado).toBe('criada');
    expect(r.resultado === 'criada' && r.confirmacao.estado).toBe('nao_enviada');
    expect(fila).not.toHaveBeenCalled();
    expect(await db().consentimento.count({ where: { salaoId: c.s.salaoId } })).toBe(0);
    const m = await db().mensagem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(m.map((x) => x.estado)).toEqual(['nao_enviada']);
  });

  it('declarando: consentimento origem equipe, confirmação pendente e job só depois do commit', async () => {
    const c = await criarCenarioReserva();
    const vistos: number[] = [];
    const fila = vi.fn(async () => {
      vistos.push(await db().reserva.count({ where: { salaoId: c.s.salaoId } }));
      return { criado: true as const, id: 'job' };
    });
    const r = await criar(c, { aceites: { mensagensReserva: 'on', conviteAvaliacao: true } }, { enfileirar: fila });
    expect(r.resultado === 'criada' && r.confirmacao.estado).toBe('pendente');
    expect(fila).toHaveBeenCalledTimes(1);
    expect(vistos).toEqual([1]);
    const cs = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId } });
    expect(cs.map((x) => [x.finalidade, x.origem])).toEqual([['mensagens_reserva', 'equipe']]);
  });

  it('a falha da fila nunca desfaz a reserva', async () => {
    const c = await criarCenarioReserva();
    const r = await criar(c, {}, { enfileirar: async () => { throw new Error('fila fora'); } });
    expect(r.resultado).toBe('criada');
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });
});

describe('CA-6: bloqueio', () => {
  it('próprio: recusa sem confirmar; confirmando cria com encaixe', async () => {
    const c = await criarCenarioReserva();
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '14:00'), fim: sp(DIA, '15:00') } });
    expect(motivosDe(await criar(c, { ...umaLinha(c, '14:00') }))).toEqual(['bloqueado']);
    const r = await criar(c, { ...umaLinha(c, '14:00'), confirmarEncaixe: true });
    expect(encaixeDe(r)).toBe(true);
  });

  it('do salão inteiro vale para todos; o de outro profissional não vale', async () => {
    const c = await criarCenarioReserva();
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: null, inicio: sp(DIA, '12:00'), fim: sp(DIA, '13:00') } });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.bia, inicio: sp(DIA, '16:00'), fim: sp(DIA, '17:00') } });
    expect(motivosDe(await criar(c, { ...umaLinha(c, '12:30') }))).toEqual(['bloqueado']);
    expect((await criar(c, { ...umaLinha(c, '16:00') })).resultado).toBe('criada');
  });

  it('bloqueio de outro salão não conta', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    await db().bloqueio.create({ data: { salaoId: outro.s.salaoId, profissionalId: null, inicio: sp(DIA, '12:00'), fim: sp(DIA, '13:00') } });
    expect((await criar(c, { ...umaLinha(c, '12:00') })).resultado).toBe('criada');
  });
});

describe('CA-7: funcionamento', () => {
  it('definido sem sábado: motivo; confirmando cria com encaixe; não informado não é motivo', async () => {
    const c = await criarCenarioReserva({ funcionamento: { 1: [['08:00', '20:00']], 2: [['08:00', '20:00']] } });
    expect(motivosDe(await criar(c, { data: '2026-12-05' }))).toEqual(['fora_do_funcionamento']);
    const r = await criar(c, { data: '2026-12-05', confirmarEncaixe: true });
    expect(encaixeDe(r)).toBe(true);
    expect((await criar(c, { data: '2026-12-01' })).resultado).toBe('criada');

    const livre = await criarCenarioReserva();
    const l = await criar(livre, { data: '2026-12-05' });
    expect(encaixeDe(l)).toBe(false);
  });

  it('coexistem os três motivos e a resposta lista todos', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '12:00']], funcionamento: { 1: [['08:00', '20:00']] } });
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: null, inicio: sp(DIA, '15:00'), fim: sp(DIA, '16:00') } });
    expect(motivosDe(await criar(c, { ...umaLinha(c, '15:00') }))).toEqual(['fora_da_jornada', 'bloqueado', 'fora_do_funcionamento']);
  });
});

describe('CA-8: horário normal', () => {
  it('fora da grade e dentro das 2 h de antecedência: encaixe = false, sem pedir confirmação, mesmo se marcado', async () => {
    const c = await criarCenarioReserva({ gradeMin: 30 });
    const a = await criar(c, { ...umaLinha(c, '10:07') });
    expect(encaixeDe(a)).toBe(false);
    // AGORA é 09:00 local em 20/11; 10:00 do mesmo dia está dentro da antecedência (2 h) e continua aceito.
    const b = await criar(c, { data: '2026-11-20', ...umaLinha(c, '10:00'), confirmarEncaixe: true });
    expect(encaixeDe(b)).toBe(false);
    const linhas = await db().reservaItem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas.map((l) => l.encaixe)).toEqual([false, false]);
  });
});

describe('CA-9: passado', () => {
  it('com ou sem confirmação: invalido no campo inicio e nada gravado', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    for (const confirmarEncaixe of [undefined, true]) {
      const r = await criar(c, { data: '2026-11-20', ...umaLinha(c, '08:00'), confirmarEncaixe });
      expect(r).toEqual({ resultado: 'invalido', erros: { porItem: { 0: { inicio: 'O horário não pode estar no passado.' } } } });
    }
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('data ou hora ilegível: invalido (data e hora da linha) sem 500, junto dos erros de nome e telefone', async () => {
    const c = await criarCenarioReserva();
    const r = await criar(c, { data: '2026-02-30', ...umaLinha(c, '25:00'), nome: '', telefone: '123' });
    expect(r.resultado === 'invalido' && Object.keys(r.erros).sort()).toEqual(['data', 'nome', 'porItem', 'telefone']);
    expect(r.resultado === 'invalido' && r.erros.porItem).toEqual({ 0: { inicio: 'Informe a hora no formato HH:MM.' } });
  });

  it('telefone não brasileiro: erro de campo, nunca 500', async () => {
    const c = await criarCenarioReserva();
    const r = await criar(c, { telefone: '+1 415 555 2671' });
    expect(r.resultado === 'invalido' && Object.keys(r.erros)).toEqual(['telefone']);
  });
});

describe('CA-10: sem limite de futuras por número', () => {
  it('a quarta reserva manual do mesmo telefone é aceita', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    for (const hora of ['09:00', '10:00', '11:00', '12:00']) {
      expect((await criar(c, { telefone, ...umaLinha(c, hora) })).resultado).toBe('criada');
    }
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(4);
  });
});

describe('CA-11: idempotência', () => {
  it('mesma chave duas vezes: uma reserva, a segunda repetida; chave reutilizada com outro pedido é recusada', async () => {
    const c = await criarCenarioReserva();
    const chaveRequisicao = randomUUID();
    const telefone = telefoneNovo();
    const a = await criar(c, { chaveRequisicao, telefone });
    const b = await criar(c, { chaveRequisicao, telefone });
    expect(a.resultado).toBe('criada');
    expect(b.resultado).toBe('repetida');
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
    expect((await criar(c, { chaveRequisicao, telefone, ...umaLinha(c, '15:00') })).resultado).toBe('chave_reutilizada');
  });

  it('o aviso de encaixe não consome a chave: reenviar com confirmação cria', async () => {
    const c = await criarCenarioReserva({ jornada: [['09:00', '18:00']] });
    const chaveRequisicao = randomUUID();
    const telefone = telefoneNovo();
    expect((await criar(c, { chaveRequisicao, telefone, ...umaLinha(c, '19:00') })).resultado).toBe('encaixe_requer_confirmacao');
    expect((await criar(c, { chaveRequisicao, telefone, ...umaLinha(c, '19:00'), confirmarEncaixe: 'on' })).resultado).toBe('criada');
  });
});

describe('CA-12: serviço e profissional', () => {
  it('serviço que a Ana não executa (Bia faz só A), serviço inativo e profissional inativo: recusa sem gravar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    // A Bia não faz B: profissional_indisponivel com o índice da linha (a casca mostra o erro nela).
    expect(await criar(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.B, c.bia, '11:00')] })).toEqual({
      resultado: 'profissional_indisponivel',
      itens: [1],
    });
    await db().servico.update({ where: { id: c.B }, data: { ativo: false } });
    expect((await criar(c, umaLinha(c, '10:00', { servicoId: c.B }))).resultado).toBe('servico_indisponivel');
    expect(await criar(c, umaLinha(c, '10:00', { profissionalId: c.s.profissionalInativoId }))).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('sem linha, linha sem serviço ou serviço repetido: invalido no campo da linha, nada gravado', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    expect(await criar(c, { itens: [] })).toEqual({ resultado: 'invalido', erros: { itens: 'Inclua de um a dez serviços.' } });
    expect(await criar(c, umaLinha(c, '10:00', { servicoId: '' }))).toEqual({ resultado: 'invalido', erros: { porItem: { 0: { servico: 'Escolha o serviço.' } } } });
    expect(await criar(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.A, c.bia, '11:00')] })).toEqual({
      resultado: 'invalido',
      erros: { porItem: { 1: { servico: 'Este serviço já está no Serviço 1.' } } },
    });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });
});

describe('CA-13: política', () => {
  it('política negando agendar: AcessoNegado e nada gravado', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    await expect(
      criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c), AGORA, { enfileirar, politica: () => ({ permitido: false, motivo: 'suspenso' }) }),
    ).rejects.toBeInstanceOf(AcessoNegado);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('a ação com a política de operação negando: 403', async () => {
    const c = await criarCenarioReserva();
    const gestor = await credencialDoGestor(c.s);
    const r = await criarReservaManual.executar(gestor, entradaEquipe(c), {
      agora: AGORA,
      politica: () => ({ permitido: false, motivo: 'suspenso' }),
    });
    expect(r).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('CA-18: fuso do salão', () => {
  it('10:00 em Manaus é 14:00Z e a jornada vale no fuso do salão', async () => {
    const c = await criarCenarioReserva({ fuso: 'America/Manaus' });
    const r = await criar(c, { ...umaLinha(c, '10:00') });
    expect(r.resultado === 'criada' && r.reserva.inicio.toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(encaixeDe(r)).toBe(false);
    expect(motivosDe(await criar(c, { ...umaLinha(c, '19:00') }))).toEqual(['fora_da_jornada']);
  });

  it('virada de dia: terminar depois da meia-noite local é fora da jornada', async () => {
    const c = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    expect(motivosDe(await criar(c, { ...umaLinha(c, '23:45') }))).toEqual(['fora_da_jornada']);
    expect((await criar(c, { ...umaLinha(c, '23:30') })).resultado).toBe('criada');
  });

  it('hora inexistente (horário de verão em Santiago) é gravada no instante da transição', async () => {
    const c = await criarCenarioReserva({ fuso: 'America/Santiago', jornada: [['00:00', '24:00']] });
    const r = await criar(c, { data: '2027-09-05', ...umaLinha(c, '00:30'), confirmarEncaixe: true });
    expect(r.resultado).toBe('criada');
    if (r.resultado === 'criada') {
      // 00:00–01:00 locais não existem; o instante resolvido é o da transição (01:00 local, UTC-3).
      expect(r.reserva.inicio.toISOString()).toBe('2027-09-05T04:00:00.000Z');
    }
  });
});
