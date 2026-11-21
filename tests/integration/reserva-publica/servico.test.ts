import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { VERSAO_TERMOS } from '@/config/termos';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas } from '../../support/reservas';
import {
  AGORA,
  DIA,
  criarCenarioReserva,
  definirAssinatura,
  enfileirar,
  entradaPublica,
  sp,
} from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';

// D-026 T-3: CA-4, CA-7, CA-8, CA-10, CA-11, CA-13 e cliente anonimizada, contra o PostgreSQL real.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const reservar = (e: EntradaReservaPublica) => reservarPelaPagina(e, AGORA, { enfileirar });

describe('CA-7: reserva pela página', () => {
  it('cria reserva confirmada, itens com snapshot, cliente, consentimento com a versão e confirmação na outbox', async () => {
    const c = await criarCenarioReserva();
    const telefone = '(11) 98765-4321';
    const r = await reservar(entradaPublica(c, { servicoIds: [c.A, c.B], telefone, nome: '  maria  da silva ' }));
    expect(r.resultado).toBe('confirmada');
    if (r.resultado !== 'confirmada') return;
    expect(r.repetida).toBe(false);
    expect(r.resumo).toMatchObject({
      profissionalNome: 'Ana',
      inicioIso: sp(DIA, '10:00').toISOString(),
      fuso: 'America/Sao_Paulo',
      totalCentavos: 12000,
      duracaoTotalMin: 75,
    });
    expect(r.resumo.servicos).toEqual([
      { nome: 'A', precoCentavos: 5000, duracaoMin: 30 },
      { nome: 'B', precoCentavos: 7000, duracaoMin: 45 },
    ]);

    const reserva = await db().reserva.findFirstOrThrow({
      where: { salaoId: c.s.salaoId },
      include: { itens: { orderBy: { ordem: 'asc' } }, cliente: true },
    });
    expect(reserva).toMatchObject({ status: 'confirmado', origem: 'publico', encaixe: false, profissionalId: c.ana, revisao: 0 });
    expect(reserva.itens.map((i) => [i.servicoId, i.precoCentavos, i.duracaoMin])).toEqual([
      [c.A, 5000, 30],
      [c.B, 7000, 45],
    ]);
    expect(reserva.cliente).toMatchObject({ telefoneE164: '+5511987654321', nome: 'maria da silva', salaoId: c.s.salaoId });

    const consentimentos = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId, clienteId: reserva.clienteId } });
    expect(consentimentos.map((x) => [x.finalidade, x.origem, x.versaoTermos])).toEqual([['mensagens_reserva', 'publico', VERSAO_TERMOS]]);
    const mensagens = await db().mensagem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(mensagens.map((m) => [m.tipo, m.reservaId, m.estado])).toEqual([['confirmacao', reserva.id, 'pendente']]);
  });

  it('aceitar também o convite de avaliação grava as duas finalidades', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { aceites: { mensagensReserva: true, conviteAvaliacao: true } }));
    expect(r.resultado).toBe('confirmada');
    const fin = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId }, select: { finalidade: true }, orderBy: { finalidade: 'asc' } });
    expect(fin.map((f) => f.finalidade).sort()).toEqual(['convite_avaliacao', 'mensagens_reserva']);
  });

  it('nunca grava encaixe: horário fora da jornada é "voltar ao horário", sem reserva', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { inicio: sp(DIA, '22:00').toISOString() }));
    expect(r).toEqual({ resultado: 'voltar', passo: 'horario', aviso: 'horario_indisponivel' });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('CA-8: envio duplicado', () => {
  it('mesma chave: uma só reserva e a mesma confirmação, marcada repetida', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const e = entradaPublica(c);
    const a = await reservar(e);
    const b = await reservar(e);
    expect(a.resultado).toBe('confirmada');
    expect(b).toMatchObject({ resultado: 'confirmada', repetida: true });
    if (a.resultado !== 'confirmada' || b.resultado !== 'confirmada') return;
    expect(b.resumo).toEqual(a.resumo);
    const n = await contarLinhas(c.s.salaoId);
    expect([n.reserva, n.itens, n.cliente - antes.cliente, n.mensagem]).toEqual([1, 1, 1, 1]);
  });

  it('mesma chave com outro horário: recusado, sem segunda reserva', async () => {
    const c = await criarCenarioReserva();
    const e = entradaPublica(c);
    await reservar(e);
    const r = await reservar({ ...e, inicio: sp(DIA, '11:00').toISOString() });
    expect(r.resultado).toBe('recusado');
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(1);
  });
});

describe('CA-10: validação por campo, sem gravar', () => {
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
    expect(typeof r.erros[campo]).toBe('string');
    expect(r.erros[campo]).toMatch(/\S/);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('todos os erros juntos: nome, telefone e aceite de uma vez', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { nome: 'A', telefone: '1', aceites: {} }));
    expect(r.resultado).toBe('invalido');
    if (r.resultado === 'invalido') expect(Object.keys(r.erros).sort()).toEqual(['mensagensReserva', 'nome', 'telefone']);
  });

  it('horário malformado: erro geral, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { inicio: 'amanhã' }));
    expect(r).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('CA-4: salão sem condição de receber reservas (POST direto)', () => {
  const casos: [string, (salaoId: string) => Promise<void>][] = [
    ['suspenso manualmente', async (id) => void (await db().salao.update({ where: { id }, data: { suspensoManualEm: AGORA } }))],
    ['assinatura pendente', (id) => definirAssinatura(id, 'pendente')],
    ['assinatura suspensa', (id) => definirAssinatura(id, 'suspensa')],
    ['assinatura encerrada', (id) => definirAssinatura(id, 'encerrada')],
    ['cancelada sem acesso', (id) => definirAssinatura(id, 'cancelada', new Date(AGORA.getTime() - 1000))],
    ['sem serviço ofertável', async (id) => void (await db().servico.updateMany({ where: { salaoId: id }, data: { ativo: false } }))],
  ];
  it.each(casos)('%s: indisponivel e nada gravado', async (_n, preparar) => {
    const c = await criarCenarioReserva();
    await preparar(c.s.salaoId);
    const antes = await contarLinhas(c.s.salaoId);
    expect(await reservar(entradaPublica(c))).toEqual({ resultado: 'indisponivel' });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it.each(['em_teste', 'ativa', 'em_carencia'] as const)('assinatura %s permite reservar', async (estado) => {
    const c = await criarCenarioReserva();
    await definirAssinatura(c.s.salaoId, estado);
    expect((await reservar(entradaPublica(c))).resultado).toBe('confirmada');
  });

  it('cancelada com acesso futuro permite reservar (a mais recente vale, a encerrada antiga não pesa)', async () => {
    const c = await criarCenarioReserva();
    await definirAssinatura(c.s.salaoId, 'suspensa');
    await db().assinatura.updateMany({ where: { salaoId: c.s.salaoId }, data: { estado: 'encerrada' } });
    await definirAssinatura(c.s.salaoId, 'cancelada', new Date(AGORA.getTime() + 86_400_000));
    expect((await reservar(entradaPublica(c))).resultado).toBe('confirmada');
  });
});

describe('CA-11: dados inexistentes, de outro salão ou desativados depois da escolha', () => {
  it('slug inexistente, malformado ou reservado: inválido genérico, sem vazar', async () => {
    const c = await criarCenarioReserva();
    for (const slug of ['nao-existe-xyz', 'Maiusculas', 'api', '', '../x']) {
      expect(await reservar(entradaPublica(c, { slug })), slug).toMatchObject({ resultado: 'invalido' });
    }
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('serviço de outro salão é como inexistente', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { servicoIds: [outro.A] }));
    expect(r).toEqual({ resultado: 'voltar', passo: 'servicos', aviso: 'servico_indisponivel' });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
    expect((await contarLinhas(outro.s.salaoId)).reserva).toBe(0);
  });

  it('profissional de outro salão ou UUID malformado: volta ao profissional', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    for (const profissionalId of [outro.ana, 'x', '00000000-0000-4000-8000-000000000000']) {
      const r = await reservar(entradaPublica(c, { profissionalId }));
      expect(r, profissionalId).toEqual({ resultado: 'voltar', passo: 'profissional', aviso: 'profissional_indisponivel' });
    }
  });

  it('serviço ou profissional desativados depois da escolha', async () => {
    const c = await criarCenarioReserva();
    await db().servico.update({ where: { id: c.B }, data: { ativo: false } });
    expect(await reservar(entradaPublica(c, { servicoIds: [c.A, c.B] }))).toMatchObject({ resultado: 'voltar', passo: 'servicos' });
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    expect(await reservar(entradaPublica(c, { profissionalId: c.bia }))).toMatchObject({ resultado: 'voltar', passo: 'profissional' });
  });

  it('serviço sem vínculo com o profissional (Bia só faz A): volta ao profissional', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { servicoIds: [c.A, c.B], profissionalId: c.bia }));
    expect(r).toMatchObject({ resultado: 'voltar', passo: 'profissional' });
  });

  it('antecedência vencida: o horário já não é oferecido', async () => {
    const c = await criarCenarioReserva();
    const quaseAgora = new Date(AGORA.getTime() + 30 * 60_000).toISOString();
    expect(await reservar(entradaPublica(c, { inicio: quaseAgora }))).toMatchObject({ resultado: 'voltar', passo: 'horario' });
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

describe('CA-13: isolamento entre salões', () => {
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

describe('cliente anonimizada com o mesmo telefone', () => {
  it('a anonimização limpa o telefone: a nova reserva cria outra cliente e não reutiliza a anonimizada', async () => {
    const c = await criarCenarioReserva();
    const telefone = '(11) 98765-4321';
    expect((await reservar(entradaPublica(c, { telefone }))).resultado).toBe('confirmada');
    const antiga = await db().cliente.findFirstOrThrow({ where: { salaoId: c.s.salaoId, telefoneE164: '+5511987654321' } });
    await db().cliente.update({ where: { id: antiga.id }, data: { nome: null, telefoneE164: null, anonimizadaEm: AGORA } });

    expect((await reservar(entradaPublica(c, { telefone, inicio: sp(DIA, '11:00').toISOString() }))).resultado).toBe('confirmada');
    const nova = await db().cliente.findFirstOrThrow({ where: { salaoId: c.s.salaoId, telefoneE164: '+5511987654321' } });
    expect(nova.id).not.toBe(antiga.id);
    expect(nova.anonimizadaEm).toBeNull();
    const intacta = await db().cliente.findUniqueOrThrow({ where: { id: antiga.id } });
    expect(intacta).toMatchObject({ nome: null, telefoneE164: null });
    expect(await db().reserva.count({ where: { clienteId: antiga.id } })).toBe(1);
  });
});
