import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { VERSAO_TERMOS } from '@/config/termos';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';
import { MENSAGENS_RESERVA } from '@/server/reservas/tipos';

import { conferirDerivados, contarLinhas } from '../../support/reservas';
import {
  AGORA,
  DIA,
  criarCenarioReserva,
  definirAssinatura,
  enfileirar,
  entradaPublica,
  itemPublico,
  sp,
} from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';
import { criarCenarioTres } from './apoio';

// D-026 T-3 e D-050 T-10: a reserva pela página com N itens (serviço, profissional e horário por item),
// contra o PostgreSQL real. CA-6 (servidor), CA-5/CA-7 forjados, CA-14, CA-16 (ver protecao/), CA-50.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const reservar = (e: EntradaReservaPublica) => reservarPelaPagina(e, AGORA, { enfileirar });

describe('CA-6: reserva com um profissional e um horário por serviço', () => {
  it('3 itens em 3 profissionais (manhã e tarde): 1 reserva, 3 itens com profissional, início, fim e snapshot; resumo por início', async () => {
    const c = await criarCenarioTres();
    const telefone = '(11) 98765-4321';
    // Ordem de escolha C, A, B: o resumo sai por início (A 09:00, B 10:00, C 15:00).
    const itens = [
      itemPublico(c.C, c.carla, sp(DIA, '15:00')),
      itemPublico(c.A, c.ana, sp(DIA, '09:00')),
      itemPublico(c.B, c.bia, sp(DIA, '10:00')),
    ];
    const r = await reservar(entradaPublica(c, { itens, telefone, nome: '  maria  da silva ' }));
    expect(r.resultado).toBe('confirmada');
    if (r.resultado !== 'confirmada') return;
    expect(r.repetida).toBe(false);
    expect(r.resumo).toEqual({
      fuso: 'America/Sao_Paulo',
      data: '2026-12-01',
      itens: [
        { servicoNome: 'A', profissionalNome: 'Ana', inicioIso: sp(DIA, '09:00').toISOString(), fimIso: sp(DIA, '09:30').toISOString(), precoCentavos: 5000, duracaoMin: 30 },
        { servicoNome: 'B', profissionalNome: 'Bia', inicioIso: sp(DIA, '10:00').toISOString(), fimIso: sp(DIA, '10:45').toISOString(), precoCentavos: 7000, duracaoMin: 45 },
        { servicoNome: 'C', profissionalNome: 'Carla', inicioIso: sp(DIA, '15:00').toISOString(), fimIso: sp(DIA, '15:45').toISOString(), precoCentavos: 4000, duracaoMin: 45 },
      ],
      totalCentavos: 16000,
    });

    const reserva = await db().reserva.findFirstOrThrow({
      where: { salaoId: c.s.salaoId },
      include: { itens: { orderBy: { ordem: 'asc' } }, cliente: true },
    });
    expect(reserva).toMatchObject({ status: 'confirmado', origem: 'publico', revisao: 0, inicio: sp(DIA, '09:00'), fim: sp(DIA, '15:45') });
    expect(reserva.itens.map((i) => [i.ordem, i.servicoId, i.profissionalId, i.inicio, i.fim, i.status, i.encaixe, i.precoCentavos, i.duracaoMin])).toEqual([
      [0, c.C, c.carla, sp(DIA, '15:00'), sp(DIA, '15:45'), 'confirmado', false, 4000, 45],
      [1, c.A, c.ana, sp(DIA, '09:00'), sp(DIA, '09:30'), 'confirmado', false, 5000, 30],
      [2, c.B, c.bia, sp(DIA, '10:00'), sp(DIA, '10:45'), 'confirmado', false, 7000, 45],
    ]);
    expect(reserva.cliente).toMatchObject({ telefoneE164: '+5511987654321', nome: 'maria da silva', salaoId: c.s.salaoId });
    expect(await conferirDerivados({ salaoId: c.s.salaoId })).toBe(1); // lança se divergir

    // Um consentimento por finalidade POR RESERVA (não por item) e UMA confirmação.
    const consentimentos = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId, clienteId: reserva.clienteId } });
    expect(consentimentos.map((x) => [x.finalidade, x.origem, x.versaoTermos])).toEqual([['mensagens_reserva', 'publico', VERSAO_TERMOS]]);
    const mensagens = await db().mensagem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(mensagens.map((m) => [m.tipo, m.reservaId, m.estado, m.reservaItemId])).toEqual([['confirmacao', reserva.id, 'pendente', null]]);
  });

  it('o mesmo profissional em dois itens consecutivos (adjacentes) é aceito', async () => {
    const c = await criarCenarioReserva();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '10:00')), itemPublico(c.B, c.ana, sp(DIA, '10:30'))];
    const r = await reservar(entradaPublica(c, { itens }));
    expect(r).toMatchObject({ resultado: 'confirmada', resumo: { totalCentavos: 12000 } });
    const n = await contarLinhas(c.s.salaoId);
    expect([n.reserva, n.itens, n.mensagem]).toEqual([1, 2, 1]);
  });

  it('aceitar também o convite de avaliação grava as duas finalidades', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { aceites: { mensagensReserva: true, conviteAvaliacao: true } }));
    expect(r.resultado).toBe('confirmada');
    const fin = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId }, select: { finalidade: true } });
    expect(fin.map((f) => f.finalidade).sort()).toEqual(['convite_avaliacao', 'mensagens_reserva']);
  });

  it('nunca grava encaixe: item fora da jornada vira reescolha daquele item, sem reserva', async () => {
    const c = await criarCenarioReserva();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '10:00')), itemPublico(c.B, c.ana, sp(DIA, '22:00'))];
    expect(await reservar(entradaPublica(c, { itens }))).toEqual({ resultado: 'reescolher', itens: [1] });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('envios forjados (CA-5, CA-7)', () => {
  it('CA-5: B começa dentro de A (mesma cliente): nada gravado, reescolha do item B', async () => {
    const c = await criarCenarioTres();
    const antes = await contarLinhas(c.s.salaoId);
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '09:15'))];
    expect(await reservar(entradaPublica(c, { itens }))).toEqual({ resultado: 'reescolher', itens: [1] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('CA-7: item em outra data é recusado sem gravar, com o erro no item', async () => {
    const c = await criarCenarioTres();
    const antes = await contarLinhas(c.s.salaoId);
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp({ ano: 2026, mes: 12, dia: 2 }, '10:00'))];
    const r = await reservar(entradaPublica(c, { itens }));
    expect(r).toMatchObject({ resultado: 'invalido', erros: { porItem: { 1: { inicio: MENSAGENS_RESERVA.dataDiferente } } } });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('itens desalinhados de `s`, vazios ou com serviço repetido: inválido genérico, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const um = itemPublico(c.A, c.ana, sp(DIA, '10:00'));
    for (const sobre of [
      { servicoIds: [c.A, c.B], itens: [um] },
      { servicoIds: [c.B], itens: [um] },
      { servicoIds: [], itens: [] },
      { servicoIds: [c.A, c.A], itens: [um, um] },
      { servicoIds: [c.A], itens: 'x' as unknown as EntradaReservaPublica['itens'] },
    ]) {
      expect(await reservar(entradaPublica(c, sobre)), JSON.stringify(sobre)).toMatchObject({ resultado: 'invalido', erros: { itens: expect.any(String) } });
    }
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('horário malformado: erro no item, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { inicio: 'amanhã' }));
    expect(r).toEqual({ resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA.inicio, porItem: { 0: { inicio: MENSAGENS_RESERVA.inicio } } } });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('envio duplicado (D-026 CA-8)', () => {
  it('mesma chave: uma só reserva e a mesma confirmação, marcada repetida', async () => {
    const c = await criarCenarioTres();
    const antes = await contarLinhas(c.s.salaoId);
    const e = entradaPublica(c, { itens: [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.C, c.carla, sp(DIA, '15:00'))] });
    const a = await reservar(e);
    const b = await reservar(e);
    expect(a.resultado).toBe('confirmada');
    expect(b).toMatchObject({ resultado: 'confirmada', repetida: true });
    if (a.resultado !== 'confirmada' || b.resultado !== 'confirmada') return;
    expect(b.resumo).toEqual(a.resumo);
    const n = await contarLinhas(c.s.salaoId);
    expect([n.reserva, n.itens, n.cliente - antes.cliente, n.mensagem]).toEqual([1, 2, 1, 1]);
  });

  it('mesma chave com outro horário: recusado, sem segunda reserva', async () => {
    const c = await criarCenarioReserva();
    const e = entradaPublica(c);
    await reservar(e);
    const r = await reservar({ ...e, itens: [itemPublico(c.A, c.ana, sp(DIA, '11:00'))] });
    expect(r.resultado).toBe('recusado');
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(1);
  });
});

describe('validação por campo, sem gravar (D-026 CA-10)', () => {
  it.each([
    ['telefone não brasileiro', { telefone: '+1 415 555 0100' }, 'telefone'],
    ['telefone inválido', { telefone: '123' }, 'telefone'],
    ['nome curto', { nome: 'A' }, 'nome'],
    ['sem consentimento', { aceites: { mensagensReserva: false, conviteAvaliacao: true } }, 'mensagensReserva'],
    ['consentimento ausente', { aceites: {} }, 'mensagensReserva'],
  ] as const)('%s', async (_nome, sobre, campo) => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const r = await reservar(entradaPublica(c, sobre));
    expect(r.resultado).toBe('invalido');
    if (r.resultado !== 'invalido') return;
    expect(r.erros[campo]).toMatch(/\S/);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('todos os erros juntos: nome, telefone e aceite de uma vez', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { nome: 'A', telefone: '1', aceites: {} }));
    expect(r.resultado).toBe('invalido');
    if (r.resultado === 'invalido') expect(Object.keys(r.erros).sort()).toEqual(['mensagensReserva', 'nome', 'telefone']);
  });
});

describe('CA-14: salão sem condição de receber reservas (POST direto)', () => {
  const casos: [string, (salaoId: string) => Promise<void>][] = [
    ['suspenso manualmente', async (id) => void (await db().salao.update({ where: { id }, data: { suspensoManualEm: AGORA } }))],
    ['assinatura pendente', (id) => definirAssinatura(id, 'pendente')],
    ['assinatura suspensa', (id) => definirAssinatura(id, 'suspensa')],
    ['assinatura encerrada', (id) => definirAssinatura(id, 'encerrada')],
    ['cancelada sem acesso', (id) => definirAssinatura(id, 'cancelada', new Date(AGORA.getTime() - 1000))],
    ['sem serviço ofertável', async (id) => void (await db().servico.updateMany({ where: { salaoId: id }, data: { ativo: false } }))],
  ];
  it.each(casos)('%s: indisponivel e nada gravado', async (_n, preparar) => {
    const c = await criarCenarioTres();
    await preparar(c.s.salaoId);
    const antes = await contarLinhas(c.s.salaoId);
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.C, c.carla, sp(DIA, '15:00'))];
    expect(await reservar(entradaPublica(c, { itens }))).toEqual({ resultado: 'indisponivel' });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it.each(['em_teste', 'ativa', 'em_carencia'] as const)('assinatura %s permite reservar', async (estado) => {
    const c = await criarCenarioReserva();
    await definirAssinatura(c.s.salaoId, estado);
    expect((await reservar(entradaPublica(c))).resultado).toBe('confirmada');
  });
});

describe('CA-50: dados inexistentes, de outro salão ou desativados depois da escolha', () => {
  it('slug inexistente, malformado ou reservado: inválido genérico, sem vazar', async () => {
    const c = await criarCenarioReserva();
    for (const slug of ['nao-existe-xyz', 'Maiusculas', 'api', '', '../x']) {
      expect(await reservar(entradaPublica(c, { slug })), slug).toMatchObject({ resultado: 'invalido' });
    }
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('serviço de outro salão é como inexistente: volta aos serviços, nada gravado nos dois salões', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(outro.B, c.ana, sp(DIA, '10:00'))];
    expect(await reservar(entradaPublica(c, { itens }))).toEqual({ resultado: 'voltar', passo: 'servicos', aviso: 'servico_indisponivel' });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
    expect((await contarLinhas(outro.s.salaoId)).reserva).toBe(0);
  });

  it('profissional de outro salão ou UUID malformado: volta ao passo daquele item', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    for (const profissionalId of [outro.ana, 'x', '00000000-0000-4000-8000-000000000000']) {
      const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, profissionalId, sp(DIA, '10:00'))];
      expect(await reservar(entradaPublica(c, { itens })), profissionalId).toEqual({
        resultado: 'voltar',
        passo: 'servico',
        indice: 1,
        aviso: 'profissional_indisponivel',
      });
    }
    expect((await contarLinhas(outro.s.salaoId)).reserva).toBe(0);
  });

  it('serviço ou profissional desativados depois da escolha', async () => {
    const c = await criarCenarioTres();
    await db().servico.update({ where: { id: c.C }, data: { ativo: false } });
    const comC = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.C, c.carla, sp(DIA, '15:00'))];
    expect(await reservar(entradaPublica(c, { itens: comC }))).toMatchObject({ resultado: 'voltar', passo: 'servicos' });
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    const comBia = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '10:00'))];
    expect(await reservar(entradaPublica(c, { itens: comBia }))).toEqual({ resultado: 'voltar', passo: 'servico', indice: 1, aviso: 'profissional_indisponivel' });
  });

  it('profissional sem vínculo com o serviço do item (Carla não faz A): volta ao passo do item', async () => {
    const c = await criarCenarioTres();
    const itens = [itemPublico(c.A, c.carla, sp(DIA, '09:00'))];
    expect(await reservar(entradaPublica(c, { itens }))).toEqual({ resultado: 'voltar', passo: 'servico', indice: 0, aviso: 'profissional_indisponivel' });
  });

  it('antecedência vencida: o horário já não é oferecido (reescolha)', async () => {
    const c = await criarCenarioReserva();
    const quaseAgora = new Date(AGORA.getTime() + 30 * 60_000).toISOString();
    expect(await reservar(entradaPublica(c, { inicio: quaseAgora }))).toEqual({ resultado: 'reescolher', itens: [0] });
  });

  it('a reserva e a cliente ficam só no salão do slug, mesmo com o mesmo telefone', async () => {
    const a = await criarCenarioReserva();
    const b = await criarCenarioReserva();
    const telefone = telefoneNovo();
    expect((await reservar(entradaPublica(a, { telefone }))).resultado).toBe('confirmada');
    expect((await reservar(entradaPublica(b, { telefone }))).resultado).toBe('confirmada');
    expect((await contarLinhas(a.s.salaoId)).reserva).toBe(1);
    expect((await contarLinhas(b.s.salaoId)).reserva).toBe(1);
    const clientes = await db().cliente.findMany({ where: { telefoneE164: { not: null }, salaoId: { in: [a.s.salaoId, b.s.salaoId] } } });
    expect(new Set(clientes.map((x) => x.salaoId))).toEqual(new Set([a.s.salaoId, b.s.salaoId]));
  });
});

describe('slug histórico', () => {
  it('a ação resolve de novo: slug_mudou com o slug atual e nada gravado', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { slug: c.s.slugHistorico }));
    expect(r).toEqual({ resultado: 'slug_mudou', slugAtual: c.s.slugAtual });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('cliente anonimizada com o mesmo telefone', () => {
  it('a nova reserva cria outra cliente e não reutiliza a anonimizada', async () => {
    const c = await criarCenarioReserva();
    const telefone = '(11) 98765-4321';
    expect((await reservar(entradaPublica(c, { telefone }))).resultado).toBe('confirmada');
    const antiga = await db().cliente.findFirstOrThrow({ where: { salaoId: c.s.salaoId, telefoneE164: '+5511987654321' } });
    await db().cliente.update({ where: { id: antiga.id }, data: { nome: null, telefoneE164: null, anonimizadaEm: AGORA } });

    expect((await reservar(entradaPublica(c, { telefone, inicio: sp(DIA, '11:00').toISOString() }))).resultado).toBe('confirmada');
    const nova = await db().cliente.findFirstOrThrow({ where: { salaoId: c.s.salaoId, telefoneE164: '+5511987654321' } });
    expect(nova.id).not.toBe(antiga.id);
    expect(await db().reserva.count({ where: { clienteId: antiga.id } })).toBe(1);
  });
});
