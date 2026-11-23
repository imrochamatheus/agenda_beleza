import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { obterPrisma } from '@/server/repos/db';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { chaveVinculo } from '@/server/repos/servico';
import { ehConflitoDeSobreposicao } from '@/server/reservas/erros-banco';
import { contextoDeSistema } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { conferirDerivados, contarEsperando, esperarTrava } from '../../support/reservas';
import {
  conectar,
  criarCenario,
  criarCliente,
  criarProfissional,
  criarServico,
  erroSql,
  inserirReserva,
  inserirReservaComItens,
} from '../../support/sql';

// D-050 T-2: núcleo de dados sobre `reserva_item` (design §3.1, §3.3, §3.8; dba.md §6) e o suporte de
// teste compatível. PostgreSQL real, sem mocks.

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

const MIN = 60_000;
const t = (iso: string) => new Date(iso);
const mais = (d: Date, min: number) => new Date(d.getTime() + min * MIN);

type Base = { salaoId: string; profissionalId: string; clienteId: string };

async function cenario(): Promise<Base & { ctx: ReturnType<typeof contextoDeSistema>; bia: string; s1: string; s2: string; s3: string }> {
  const b = await criarCenario(c);
  return {
    ...b,
    ctx: contextoDeSistema(b.salaoId, 'teste-d050'),
    bia: await criarProfissional(c, b.salaoId),
    s1: await criarServico(c, b.salaoId),
    s2: await criarServico(c, b.salaoId),
    s3: await criarServico(c, b.salaoId),
  };
}

function novoItem(servicoId: string, profissionalId: string, inicio: Date, dur = 30, intervalo = 0, ordem = 0) {
  const fim = mais(inicio, dur);
  return { servicoId, profissionalId, ordem, inicio, fim, ocupadoAte: mais(fim, intervalo), precoCentavos: 4500, duracaoMin: dur, encaixe: false };
}

/** Cria reserva + itens pelo repositório, numa transação, como a T-5 fará. */
async function criarPeloRepo(
  x: Awaited<ReturnType<typeof cenario>>,
  itens: ReturnType<typeof novoItem>[],
  chave: string | null = null,
): Promise<{ id: string; itens: { id: string; ordem: number }[] }> {
  return emTransacao(async (r) => {
    const inicio = new Date(Math.min(...itens.map((i) => i.inicio.getTime())));
    const fim = new Date(Math.max(...itens.map((i) => i.fim.getTime())));
    const criada = await r.reservas.criar(x.ctx, { clienteId: x.clienteId, origem: 'publico', chaveRequisicao: chave, inicio, fim });
    if (!criada.criada) throw new Error('não criada');
    return { id: criada.id, itens: await r.reservas.criarItens(x.ctx, criada.id, itens) };
  });
}

describe('RepoReserva.criar + criarItens', () => {
  it('grava a reserva confirmada (revisão 0) e N itens num só INSERT, com status confirmado e o snapshot', async () => {
    const x = await cenario();
    const ini = t('2027-02-02T12:00:00Z');
    const itens = [novoItem(x.s1, x.profissionalId, mais(ini, 60), 45, 15, 0), novoItem(x.s2, x.bia, ini, 30, 0, 1)];
    const { id, itens: gravados } = await criarPeloRepo(x, itens);
    expect(gravados.map((g) => g.ordem)).toEqual([0, 1]);

    const dto = await repos().reservas.buscarPorId(x.ctx, id);
    expect(dto).toMatchObject({ id, clienteId: x.clienteId, status: 'confirmado', origem: 'publico', revisao: 0, canceladaEm: null });
    expect(dto.inicio).toEqual(ini);
    expect(dto.fim).toEqual(mais(ini, 105));
    // itens por (inicio, id): o de ordem 1 (Bia, 12:00) vem primeiro
    expect(dto.itens.map((i) => [i.ordem, i.profissionalId, i.status, i.revisao, i.encaixe, i.precoCentavos, i.duracaoMin])).toEqual([
      [1, x.bia, 'confirmado', 0, false, 4500, 30],
      [0, x.profissionalId, 'confirmado', 0, false, 4500, 45],
    ]);
    expect(dto.itens[1].ocupadoAte).toEqual(mais(ini, 120));
    expect(dto.itens.map((i) => i.id).sort()).toEqual(gravados.map((g) => g.id).sort());
    expect(await conferirDerivados(id)).toBe(1);
  });

  it('lista vazia → RangeError; mesma chave → criada: false; buscarPorChave devolve a primeira', async () => {
    const x = await cenario();
    await expect(repos().reservas.criarItens(x.ctx, '00000000-0000-4000-8000-000000000000', [])).rejects.toThrow(RangeError);
    const chave = crypto.randomUUID();
    const { id } = await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, t('2027-02-03T12:00:00Z'))], chave);
    const repetida = await repos().reservas.criar(x.ctx, {
      clienteId: x.clienteId,
      origem: 'publico',
      chaveRequisicao: chave,
      inicio: t('2027-02-03T12:00:00Z'),
      fim: t('2027-02-03T12:30:00Z'),
    });
    expect(repetida).toEqual({ criada: false });
    expect((await repos().reservas.buscarPorChave(x.ctx, chave))?.id).toBe(id);
    expect(await repos().reservas.buscarPorChave(x.ctx, crypto.randomUUID())).toBeNull();
  });

  it('23P01 de reserva_item_sem_sobreposicao chega pelo Prisma (P2010) e é reconhecido; nada fica gravado', async () => {
    const x = await cenario();
    const ini = t('2027-02-04T12:00:00Z');
    await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, ini, 60)]);
    const erro = await criarPeloRepo(x, [novoItem(x.s2, x.profissionalId, mais(ini, 30), 30)]).catch((e: unknown) => e);
    expect(ehConflitoDeSobreposicao(erro)).toBe(true);
    const n = await obterPrisma().reserva.count({ where: { salaoId: x.salaoId } });
    expect(n).toBe(1);
  });

  it('o ocupadoAte (intervalo) conta na exclusion por profissional; profissionais diferentes não conflitam', async () => {
    const x = await cenario();
    const ini = t('2027-02-05T12:00:00Z');
    await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, ini, 30, 15)]);
    const erro = await criarPeloRepo(x, [novoItem(x.s2, x.profissionalId, mais(ini, 40), 30)]).catch((e: unknown) => e);
    expect(ehConflitoDeSobreposicao(erro)).toBe(true);
    await expect(criarPeloRepo(x, [novoItem(x.s2, x.bia, mais(ini, 10), 30)])).resolves.toBeDefined();
  });

  it('itens da MESMA reserva cruzados (profissionais diferentes) → 23P01 da outra exclusion, NÃO reconhecido', async () => {
    const x = await cenario();
    const ini = t('2027-02-06T12:00:00Z');
    const erro = await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, ini, 60, 0, 0), novoItem(x.s2, x.bia, mais(ini, 30), 30, 0, 1)]).catch(
      (e: unknown) => e,
    );
    expect(String((erro as Error).message)).toContain('reserva_item_mesma_reserva_sem_sobreposicao');
    expect(ehConflitoDeSobreposicao(erro)).toBe(false);
  });
});

describe('RepoReserva: leituras', () => {
  it('listarPorPeriodo pelo envelope, ordem (inicio, id), com itens', async () => {
    const x = await cenario();
    const a = await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, t('2027-03-01T15:00:00Z'))]);
    const b = await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, t('2027-03-01T13:00:00Z'))]);
    await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, t('2027-03-02T13:00:00Z'))]);
    const lista = await repos().reservas.listarPorPeriodo(x.ctx, { de: t('2027-03-01T00:00:00Z'), ate: t('2027-03-02T00:00:00Z') });
    expect(lista.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(lista[0].itens).toHaveLength(1);
  });

  it('buscarPorId: outro salão e inexistente → NaoEncontrado', async () => {
    const x = await cenario();
    const y = await cenario();
    const { id } = await criarPeloRepo(x, [novoItem(x.s1, x.profissionalId, t('2027-03-03T12:00:00Z'))]);
    await expect(repos().reservas.buscarPorId(y.ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().reservas.buscarPorId(x.ctx, crypto.randomUUID())).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('contarFuturasDaCliente (RN-18): reserva confirmada com item confirmado futuro; ignora a chave e o passado', async () => {
    const x = await cenario();
    const agora = t('2027-04-01T12:00:00Z');
    const chave = crypto.randomUUID();
    // 1) futura, 1 item confirmado → conta
    await inserirReservaComItens(c, { salaoId: x.salaoId, clienteId: x.clienteId, itens: [{ profissionalId: x.profissionalId, inicio: '2027-04-02T12:00:00Z' }] });
    // 2) mesma chave → ignorada quando ignorarChave = chave
    await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      chaveRequisicao: chave,
      itens: [{ profissionalId: x.profissionalId, inicio: '2027-04-03T12:00:00Z' }],
    });
    // 3) item confirmado já passou e o outro foi concluído (derivado confirmado, mas nenhum futuro) → não conta
    await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-04-01T10:00:00Z' },
        { profissionalId: x.bia, inicio: '2027-04-01T10:30:00Z', status: 'concluido' },
      ],
    });
    // 4) futura toda cancelada → não conta
    await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [{ profissionalId: x.profissionalId, inicio: '2027-04-04T12:00:00Z', status: 'cancelado' }],
    });
    // 5) futura com um item cancelado e outro confirmado → conta
    await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-04-05T12:00:00Z', status: 'cancelado' },
        { profissionalId: x.bia, inicio: '2027-04-05T13:00:00Z' },
      ],
    });
    const r = repos().reservas;
    expect(await r.contarFuturasDaCliente(x.ctx, { clienteId: x.clienteId, agora, ignorarChave: null })).toBe(3);
    expect(await r.contarFuturasDaCliente(x.ctx, { clienteId: x.clienteId, agora, ignorarChave: chave })).toBe(2);
    const y = await cenario();
    expect(await r.contarFuturasDaCliente(y.ctx, { clienteId: x.clienteId, agora, ignorarChave: null })).toBe(0);
    expect(await conferirDerivados({ salaoId: x.salaoId })).toBe(5);
  });

  it('listarBloqueantesDeDesativacao: uma linha por ITEM confirmado do profissional com fim > agora', async () => {
    const x = await cenario();
    const agora = t('2027-05-01T12:00:00Z');
    const { reservaId, itemIds } = await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-05-01T11:45:00Z', servicoId: x.s1 },
        { profissionalId: x.bia, inicio: '2027-05-01T12:15:00Z', servicoId: x.s2 },
        { profissionalId: x.profissionalId, inicio: '2027-05-01T13:00:00Z', servicoId: x.s3 },
      ],
    });
    // item cancelado e item já terminado não bloqueiam
    await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-05-02T12:00:00Z', status: 'cancelado' },
        { profissionalId: x.profissionalId, inicio: '2027-05-01T10:00:00Z' },
      ],
    });
    const lista = await repos().reservas.listarBloqueantesDeDesativacao(x.ctx, x.profissionalId, agora);
    expect(lista.map((l) => [l.id, l.itemId, l.servicos])).toEqual([
      [reservaId, itemIds[0], ['Corte']],
      [reservaId, itemIds[2], ['Corte']],
    ]);
    expect(lista[0]).toMatchObject({ inicio: t('2027-05-01T11:45:00Z'), fim: t('2027-05-01T12:15:00Z'), clienteNome: 'Cliente de teste' });
    const y = await cenario();
    expect(await repos().reservas.listarBloqueantesDeDesativacao(y.ctx, x.profissionalId, agora)).toEqual([]);
  });

  it('listarConfirmadasQueCruzam: por item, [inicio, fim) && período, com e sem profissional, limite e total', async () => {
    const x = await cenario();
    const { reservaId, itemIds } = await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-06-01T12:00:00Z', intervaloMin: 30 },
        { profissionalId: x.bia, inicio: '2027-06-01T12:30:00Z' },
        { profissionalId: x.profissionalId, inicio: '2027-06-01T14:00:00Z', status: 'cancelado' },
      ],
    });
    const periodo = { de: t('2027-06-01T12:30:00Z'), ate: t('2027-06-01T15:00:00Z') };
    const r = repos().reservas;
    // item 0 termina 12:30 (ocupado até 13:00): fim exato não cruza [12:30, …)
    const todos = await r.listarConfirmadasQueCruzam(x.ctx, periodo, null, 10);
    expect(todos.total).toBe(1);
    expect(todos.reservas).toEqual([
      expect.objectContaining({ id: reservaId, itemId: itemIds[1], profissionalId: x.bia, clienteNome: 'Cliente de teste' }),
    ]);
    const daAna = await r.listarConfirmadasQueCruzam(x.ctx, { de: t('2027-06-01T11:00:00Z'), ate: periodo.ate }, x.profissionalId, 10);
    expect(daAna.reservas.map((l) => l.itemId)).toEqual([itemIds[0]]);
    const limitado = await r.listarConfirmadasQueCruzam(x.ctx, { de: t('2027-06-01T11:00:00Z'), ate: periodo.ate }, null, 1);
    expect(limitado).toMatchObject({ total: 2, reservas: [expect.objectContaining({ itemId: itemIds[0] })] });
  });
});

describe('RepoServico.travarParaItens', () => {
  it('trava os serviços do salão (ordem de id) e devolve os vínculos dos pares em minúsculas', async () => {
    const x = await cenario();
    const y = await cenario();
    await c.query('UPDATE servico SET ativo = false WHERE id = $1', [x.s3]);
    await c.query('INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3), ($1, $4, $5)', [
      x.salaoId,
      x.s1,
      x.profissionalId,
      x.s2,
      x.bia,
    ]);
    const t1 = await emTransacao((r) =>
      r.servicos.travarParaItens(x.ctx, [x.s2.toUpperCase(), x.s1, x.s3, y.s1, 'abc', x.s1], [
        { servicoId: x.s1.toUpperCase(), profissionalId: x.profissionalId },
        { servicoId: x.s2, profissionalId: x.profissionalId },
        { servicoId: x.s2, profissionalId: x.bia.toUpperCase() },
        { servicoId: y.s1, profissionalId: x.bia },
        { servicoId: 'abc', profissionalId: x.bia },
      ]),
    );
    expect(t1.map((s) => s.id)).toEqual([x.s1, x.s2, x.s3].sort());
    expect(t1.find((s) => s.id === x.s3)?.ativo).toBe(false);
    expect(t1[0]).toMatchObject({ nome: 'Corte', precoCentavos: 8000, duracaoMin: 60 });
    expect([...t1.vinculados].sort()).toEqual([chaveVinculo(x.s1, x.profissionalId), chaveVinculo(x.s2, x.bia)].sort());
  });

  it('sem pares consultáveis → vinculados vazio', async () => {
    const x = await cenario();
    const t1 = await emTransacao((r) => r.servicos.travarParaItens(x.ctx, [x.s1], []));
    expect(t1).toHaveLength(1);
    expect(t1.vinculados.size).toBe(0);
  });

  it('FOR SHARE OF s: espera a edição do serviço (FOR NO KEY UPDATE) terminar', async () => {
    const x = await cenario();
    const outra = await conectar();
    try {
      await outra.query('BEGIN');
      await outra.query('SELECT 1 FROM servico s WHERE s.id = $1 FOR NO KEY UPDATE OF s', [x.s1]);
      const p = emTransacao((r) => r.servicos.travarParaItens(x.ctx, [x.s1], []));
      await esperarTrava(c, 'FOR SHARE OF s');
      await outra.query('COMMIT');
      expect(await p).toHaveLength(1);
    } finally {
      await outra.end();
    }
  });
});

describe('RepoProfissional.travarVariosParaReserva (A-10/Q12)', () => {
  it('trava ids distintos em ordem crescente (minúsculas), um comando por id; ausentes e malformados → null', async () => {
    const x = await cenario();
    const y = await cenario();
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [x.bia]);
    const travas = await emTransacao((r) =>
      r.profissionais.travarVariosParaReserva(x.ctx, [x.bia.toUpperCase(), x.profissionalId, x.bia, y.profissionalId, 'abc']),
    );
    const esperado = [x.bia, x.profissionalId, y.profissionalId, 'abc'].sort();
    expect([...travas.keys()]).toEqual(esperado);
    expect(travas.get(x.bia)).toEqual({ ativo: false });
    expect(travas.get(x.profissionalId)).toEqual({ ativo: true });
    expect(travas.get(y.profissionalId)).toBeNull();
    expect(travas.get('abc')).toBeNull();
  });

  it('ordem fixa: duas transações com {P1, P2} em ordens opostas serializam sem impasse', async () => {
    const x = await cenario();
    const [menor, maior] = [x.profissionalId, x.bia].sort();
    const outra = await conectar();
    try {
      // Segura o MAIOR: quem entrar trava o menor e fica esperando no maior (nunca o contrário).
      await outra.query('BEGIN');
      await outra.query('SELECT 1 FROM profissional p WHERE p.id = $1 FOR NO KEY UPDATE OF p', [maior]);
      const ordem: string[] = [];
      const a = emTransacao(async (r) => {
        await r.profissionais.travarVariosParaReserva(x.ctx, [maior, menor]);
        ordem.push('a');
      });
      await esperarTrava(c, 'FOR NO KEY UPDATE OF p');
      // `a` já segura o menor: uma terceira transação pedindo [menor, maior] espera no menor.
      const b = emTransacao(async (r) => {
        await r.profissionais.travarVariosParaReserva(x.ctx, [menor, maior]);
        ordem.push('b');
      });
      await esperarTrava(c, 'FOR NO KEY UPDATE OF p', 2);
      expect(await contarEsperando(c, 'FOR NO KEY UPDATE OF p')).toBe(2);
      await outra.query('COMMIT');
      await Promise.all([a, b]);
      expect(ordem).toEqual(['a', 'b']);
    } finally {
      await outra.end();
    }
  });
});

describe('suporte compatível (tests/support)', () => {
  it('inserirReserva antigo cria reserva + 1 item com derivados coerentes, aceitando servicoId, encaixe e ocupadoAte', async () => {
    const x = await cenario();
    const id = await inserirReserva(c, {
      salaoId: x.salaoId,
      profissionalId: x.profissionalId,
      clienteId: x.clienteId,
      inicio: '2027-07-01T12:00:00Z',
      fim: '2027-07-01T13:00:00Z',
      ocupadoAte: '2027-07-01T13:15:00Z',
      encaixe: true,
      servicoId: x.s1,
    });
    const dto = await repos().reservas.buscarPorId(x.ctx, id);
    expect(dto.itens).toEqual([
      expect.objectContaining({ servicoId: x.s1, profissionalId: x.profissionalId, encaixe: true, duracaoMin: 60, status: 'confirmado' }),
    ]);
    expect(dto.itens[0].ocupadoAte).toEqual(t('2027-07-01T13:15:00Z'));
    expect(await conferirDerivados(id)).toBe(1);
    const cancelada = await inserirReserva(c, {
      salaoId: x.salaoId,
      profissionalId: x.profissionalId,
      clienteId: await criarCliente(c, x.salaoId),
      inicio: '2027-07-01T12:00:00Z',
      fim: '2027-07-01T12:30:00Z',
      status: 'cancelado',
    });
    expect(await conferirDerivados(cancelada)).toBe(1);
  });

  it('inserirReserva: sobreposição devolve 23P01 com o nome novo e não deixa reserva órfã', async () => {
    const x = await cenario();
    const base = { salaoId: x.salaoId, profissionalId: x.profissionalId, clienteId: x.clienteId };
    await inserirReserva(c, { ...base, inicio: '2027-07-02T12:00:00Z', fim: '2027-07-02T13:00:00Z' });
    expect(await erroSql(inserirReserva(c, { ...base, inicio: '2027-07-02T12:30:00Z', fim: '2027-07-02T13:30:00Z' }))).toEqual({
      code: '23P01',
      constraint: 'reserva_item_sem_sobreposicao',
    });
    const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva WHERE salao_id = $1', [x.salaoId]);
    expect(rows[0].n).toBe(1);
    await expect(inserirReserva(c, { ...base, inicio: '2027-07-02T12:00:00Z', fim: '2027-07-02T12:00:30Z' })).rejects.toThrow(RangeError);
  });

  it('conferirDerivados acusa status, envelope, cancelada_em e reserva sem itens divergentes', async () => {
    const x = await cenario();
    const { reservaId } = await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-08-01T12:00:00Z', status: 'cancelado' },
        { profissionalId: x.bia, inicio: '2027-08-01T13:00:00Z', status: 'concluido' },
      ],
    });
    expect(await conferirDerivados(reservaId)).toBe(1);
    const linha = await c.query<{ status: string; inicio: Date }>('SELECT status, inicio FROM reserva WHERE id = $1', [reservaId]);
    expect(linha.rows[0]).toEqual({ status: 'concluido', inicio: t('2027-08-01T13:00:00Z') });

    await c.query("UPDATE reserva SET status = 'confirmado' WHERE id = $1", [reservaId]);
    await expect(conferirDerivados(reservaId)).rejects.toThrow(/status confirmado ≠ concluido/);
    await c.query("UPDATE reserva SET status = 'concluido', inicio = inicio - interval '1 hour' WHERE id = $1", [reservaId]);
    await expect(conferirDerivados(reservaId)).rejects.toThrow(/inicio/);
    await c.query("UPDATE reserva SET inicio = inicio + interval '1 hour', fim = fim + interval '5 minutes' WHERE id = $1", [reservaId]);
    await expect(conferirDerivados(reservaId)).rejects.toThrow(/fim/);
    await c.query("UPDATE reserva SET fim = fim - interval '5 minutes', cancelada_em = now() WHERE id = $1", [reservaId]);
    await expect(conferirDerivados(reservaId)).rejects.toThrow(/cancelada_em preenchido/);

    const vazia = await c.query<{ id: string }>(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem) VALUES ($1, $2, now(), now() + interval '1 hour', 'confirmado', 'equipe') RETURNING id`,
      [x.salaoId, x.clienteId],
    );
    await expect(conferirDerivados(vazia.rows[0].id)).rejects.toThrow(/sem itens/);
    await expect(conferirDerivados(crypto.randomUUID())).rejects.toThrow(/não existe/);
  });

  it('inserirReservaComItens: serviços novos por item, ordem do array, revisão do item e intervalo', async () => {
    const x = await cenario();
    const { reservaId, itemIds } = await inserirReservaComItens(c, {
      salaoId: x.salaoId,
      clienteId: x.clienteId,
      revisao: 2,
      origem: 'equipe',
      itens: [
        { profissionalId: x.profissionalId, inicio: '2027-09-01T14:00:00Z', duracaoMin: 45, intervaloMin: 10, revisao: 1 },
        { profissionalId: x.bia, inicio: '2027-09-01T13:00:00Z', encaixe: true, precoCentavos: 0 },
      ],
    });
    const dto = await repos().reservas.buscarPorId(x.ctx, reservaId);
    expect(dto).toMatchObject({ revisao: 2, origem: 'equipe' });
    expect(dto.itens.map((i) => [i.id, i.ordem, i.revisao, i.encaixe, i.precoCentavos])).toEqual([
      [itemIds[1], 1, 2, true, 0],
      [itemIds[0], 0, 1, false, 5000],
    ]);
    expect(dto.itens[1].ocupadoAte).toEqual(t('2027-09-01T14:55:00Z'));
    expect(new Set(dto.itens.map((i) => i.servicoId)).size).toBe(2);
    await expect(inserirReservaComItens(c, { salaoId: x.salaoId, clienteId: x.clienteId, itens: [] })).rejects.toThrow(RangeError);
  });
});

describe('literais no SQL (design §4.5)', () => {
  it("criar, criarItens, contarFuturas e listarConfirmadasQueCruzam mantêm 'confirmado' e a tstzrange da exclusion no texto", async () => {
    const { readFile } = await import('node:fs/promises');
    const fonte = await readFile(new URL('../../../src/server/repos/reserva.ts', import.meta.url), 'utf8');
    const trecho = (de: string, ate: string) => fonte.slice(fonte.indexOf(de), fonte.indexOf(ate, fonte.indexOf(de)));
    expect(trecho('async criarItens', 'RETURNING')).toMatch(/x\.ocupado_ate, 'confirmado', x\.encaixe/);
    expect(trecho('async criar(ctx', 'RETURNING')).toContain("'confirmado'");
    expect(trecho('async contarFuturasDaCliente', 'return Number')).toMatch(/r\.status = 'confirmado'[\s\S]*i\.status = 'confirmado'/);
    const cruzam = trecho('export function consultaReservasQueCruzam', 'LIMIT');
    expect(cruzam).toContain("i.status = 'confirmado'");
    expect(cruzam).toContain("tstzrange(i.inicio, i.ocupado_ate, '[)') &&");
  });
});
