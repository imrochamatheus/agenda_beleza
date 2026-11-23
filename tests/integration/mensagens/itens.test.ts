import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro, TipoMensagem } from '@/server/mensagens/tipos';
import { criarRepos } from '@/server/repos';
import { obterPrisma } from '@/server/repos/db';

import { anonimizarCliente, chamadasDaChave, criarCenarioMensagem, lerMensagem, mensagensDaReservaDireto } from '../../support/mensagens';
import type { CenarioMensagem } from '../../support/mensagens';

import { criarPipeline, ctxDo, esperarJob, esperarMensagem, itensDa, limparFalhasForcadas, registrar } from './apoio';
import type { Pipeline } from './apoio';

// D-050 T-4: CA-37..CA-42 ponta a ponta (worker pg-boss real, WhatsApp simulado). As operações por item
// (T-6) são imitadas aqui por SQL na MESMA ordem do design §3.6: item → derivados (revisão + 1) →
// registrarMensagem → substituirNaoVigentes, numa transação; enfileirar só depois do commit.

let p: Pipeline;
beforeAll(async () => {
  p = await criarPipeline();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});
beforeEach(limparFalhasForcadas);

const MIN = 60_000;

/** Reserva com 3 itens de 3 profissionais, com início 2031-03-10 12:00Z (09:00 em São Paulo). */
async function cenarioTresItens(o: Parameters<typeof criarCenarioMensagem>[0] = {}): Promise<CenarioMensagem & { itens: string[]; nomes: string[] }> {
  const s = await criarCenarioMensagem({ servicos: ['Escova', 'Hidratação', 'Manicure'], profissionalNome: 'Ana Itens', inicio: new Date('2031-03-10T12:00:00Z'), ...o });
  const db = obterPrisma();
  const bia = await db.profissional.create({ data: { salaoId: s.salaoId, nome: 'Bia Itens' }, select: { id: true } });
  const carla = await db.profissional.create({ data: { salaoId: s.salaoId, nome: 'Carla Itens' }, select: { id: true } });
  const itens = (await itensDa(s.reservaId)).map((i) => i.id);
  // item 2 (Hidratação) às 10:00 com Bia; item 3 (Manicure) às 15:00 com Carla (horários locais).
  // o 3º sai primeiro (13:00 local, que o 2º vai ocupar).
  await db.$executeRaw`UPDATE reserva_item SET profissional_id = ${carla.id}::uuid, inicio = '2031-03-10T18:00:00Z', fim = '2031-03-10T18:30:00Z', ocupado_ate = '2031-03-10T18:30:00Z' WHERE id = ${itens[2]}::uuid`;
  await db.$executeRaw`UPDATE reserva_item SET profissional_id = ${bia.id}::uuid, inicio = '2031-03-10T13:00:00Z', fim = '2031-03-10T13:30:00Z', ocupado_ate = '2031-03-10T13:30:00Z' WHERE id = ${itens[1]}::uuid`;
  await db.$executeRaw`UPDATE reserva SET fim = '2031-03-10T18:30:00Z' WHERE id = ${s.reservaId}::uuid`;
  return { ...s, itens, nomes: [s.profissionalNome, 'Bia Itens', 'Carla Itens'] };
}

type Operacao =
  | { tipo: 'remarcar'; itemId: string; inicio: Date }
  | { tipo: 'cancelar'; itemId: string }
  | { tipo: 'cancelar_todos' };

/** Imita a T-6: grava item e derivados, registra a mensagem e substitui as não vigentes, numa transação. */
async function operar(s: CenarioMensagem, op: Operacao): Promise<ResultadoRegistro> {
  return obterPrisma().$transaction(async (tx) => {
    const r = criarRepos(tx);
    const [{ revisao }] = await tx.$queryRaw<{ revisao: number }[]>`
      UPDATE reserva SET revisao = revisao + 1 WHERE id = ${s.reservaId}::uuid RETURNING revisao`;
    if (op.tipo === 'remarcar') {
      const fim = new Date(op.inicio.getTime() + 30 * MIN);
      await tx.$executeRaw`UPDATE reserva_item SET inicio = ${op.inicio}, fim = ${fim}, ocupado_ate = ${fim}, revisao = ${revisao}
                             WHERE id = ${op.itemId}::uuid AND status = 'confirmado'`;
    } else if (op.tipo === 'cancelar') {
      await tx.$executeRaw`UPDATE reserva_item SET status = 'cancelado', revisao = ${revisao} WHERE id = ${op.itemId}::uuid`;
    } else {
      await tx.$executeRaw`UPDATE reserva_item SET status = 'cancelado', revisao = ${revisao}
                             WHERE reserva_id = ${s.reservaId}::uuid AND status = 'confirmado'`;
    }
    await tx.$executeRaw`
      UPDATE reserva r SET status = d.status::status_reserva
        FROM (SELECT CASE WHEN bool_or(status = 'confirmado') THEN 'confirmado' WHEN bool_or(status = 'concluido') THEN 'concluido'
                          WHEN bool_or(status = 'nao_compareceu') THEN 'nao_compareceu' ELSE 'cancelado' END AS status
                FROM reserva_item WHERE reserva_id = ${s.reservaId}::uuid) d
       WHERE r.id = ${s.reservaId}::uuid`;
    const tipo: TipoMensagem = op.tipo === 'remarcar' ? 'remarcacao' : 'cancelamento';
    const res = await registrarMensagem(ctxDo(s), { reservaId: s.reservaId, tipo, reservaItemId: 'itemId' in op ? op.itemId : null }, new Date(), r);
    await r.mensagens.substituirNaoVigentes(ctxDo(s), s.reservaId, new Date());
    return res;
  }, { isolationLevel: 'ReadCommitted' });
}

const enfileirar = (rs: ResultadoRegistro[]) => enfileirarMensagens(rs, { enfileirar: p.enfileirar });

describe('CA-37: confirmação consolidada', () => {
  it('1 confirmação enviada com salao, data e itens (3, por início, hora + serviço + profissional), sem quebra de linha', async () => {
    const s = await cenarioTresItens();
    const r = await registrar(s, 'confirmacao');
    await enfileirar([r]);
    await esperarMensagem(r.mensagemId, 'enviada');
    const chamadas = await chamadasDaChave(`${s.reservaId}:confirmacao:0`);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].parametros).toEqual({
      salao: s.salaoNome,
      data: '10/03/2031',
      itens: `09:00 Escova com ${s.nomes[0]}; 10:00 Hidratação com Bia Itens; 15:00 Manicure com Carla Itens`,
    });
    expect(chamadas[0].parametros.itens).not.toMatch(/[\r\n]/);
    expect((await mensagensDaReservaDireto(s.reservaId)).filter((m) => m.tipo === 'confirmacao')).toHaveLength(1);
  });
});

describe('CA-38: cancelar X e depois Y', () => {
  it('dois cancelamentos (revisões 1 e 2), sem colisão de chave, cada um citando o próprio item', async () => {
    const s = await cenarioTresItens();
    const c1 = await operar(s, { tipo: 'cancelar', itemId: s.itens[0] });
    await enfileirar([c1]);
    const c2 = await operar(s, { tipo: 'cancelar', itemId: s.itens[1] });
    await enfileirar([c2]);
    await esperarMensagem(c1.mensagemId, 'enviada');
    await esperarMensagem(c2.mensagemId, 'enviada');
    expect([c1.revisao, c2.revisao]).toEqual([1, 2]);
    expect(c1.chave).not.toBe(c2.chave);
    const [k1] = await chamadasDaChave(c1.chave);
    const [k2] = await chamadasDaChave(c2.chave);
    expect(k1.parametros).toEqual({ salao: s.salaoNome, servicos: 'Escova', data: '10/03/2031', horario: '09:00' });
    expect(k2.parametros).toEqual({ salao: s.salaoNome, servicos: 'Hidratação', data: '10/03/2031', horario: '10:00' });
    const linhas = await obterPrisma().mensagem.findMany({ where: { reservaId: s.reservaId, tipo: 'cancelamento' }, orderBy: { revisao: 'asc' } });
    expect(linhas.map((m) => m.reservaItemId)).toEqual([s.itens[0], s.itens[1]]);
  });
});

describe('CA-39: confirmação pendente e operações por item', () => {
  it('remarcar X com a confirmação pendente: a confirmação é enviada com o horário novo de X e a remarcação também', async () => {
    const s = await cenarioTresItens();
    await p.parar();
    const conf = await registrar(s, 'confirmacao');
    await enfileirar([conf]);
    const rem = await operar(s, { tipo: 'remarcar', itemId: s.itens[0], inicio: new Date('2031-03-10T15:00:00Z') });
    await enfileirar([rem]);
    expect((await lerMensagem(conf.mensagemId)).estado).toBe('pendente');
    await p.iniciar();
    await esperarMensagem(conf.mensagemId, 'enviada');
    await esperarMensagem(rem.mensagemId, 'enviada');
    const [kc] = await chamadasDaChave(conf.chave);
    expect(kc.parametros.itens).toBe(`10:00 Hidratação com Bia Itens; 12:00 Escova com ${s.nomes[0]}; 15:00 Manicure com Carla Itens`);
    const [kr] = await chamadasDaChave(rem.chave);
    expect(kr.parametros).toEqual({ salao: s.salaoNome, servicos: 'Escova', profissional: s.nomes[0], data: '10/03/2031', horario: '12:00' });
  }, 40_000);

  it('cancelar todos com a confirmação pendente: a confirmação fica substituida e não é enviada; 1 cancelamento sem item', async () => {
    const s = await cenarioTresItens();
    await p.parar();
    const conf = await registrar(s, 'confirmacao');
    await enfileirar([conf]);
    const jobConf = p.jobs.at(-1)!;
    const todos = await operar(s, { tipo: 'cancelar_todos' });
    await enfileirar([todos]);
    expect((await lerMensagem(conf.mensagemId)).estado).toBe('substituida');
    await p.iniciar();
    await esperarMensagem(todos.mensagemId, 'enviada');
    expect((await esperarJob(p, 'whatsapp-reserva', jobConf)).state).toBe('completed');
    expect(await chamadasDaChave(conf.chave)).toEqual([]);
    expect((await lerMensagem(conf.mensagemId)).estado).toBe('substituida');
    const [k] = await chamadasDaChave(todos.chave);
    expect(k.parametros).toEqual({ salao: s.salaoNome, servicos: 'Escova, Hidratação e Manicure', data: '10/03/2031', horario: '09:00' });
    const linha = await obterPrisma().mensagem.findUniqueOrThrow({ where: { id: todos.mensagemId } });
    expect(linha.reservaItemId).toBeNull();
  }, 40_000);
});

describe('CA-40: X remarcado duas vezes com a primeira pendente', () => {
  it('só a segunda é enviada', async () => {
    const s = await cenarioTresItens();
    await p.parar();
    const r1 = await operar(s, { tipo: 'remarcar', itemId: s.itens[2], inicio: new Date('2031-03-10T19:00:00Z') });
    await enfileirar([r1]);
    const r2 = await operar(s, { tipo: 'remarcar', itemId: s.itens[2], inicio: new Date('2031-03-10T20:00:00Z') });
    await enfileirar([r2]);
    expect((await lerMensagem(r1.mensagemId)).estado).toBe('substituida');
    await p.iniciar();
    await esperarMensagem(r2.mensagemId, 'enviada');
    expect(await chamadasDaChave(r1.chave)).toEqual([]);
    const [k] = await chamadasDaChave(r2.chave);
    expect(k.parametros).toMatchObject({ servicos: 'Manicure', profissional: 'Carla Itens', horario: '17:00' });
  }, 40_000);
});

describe('CA-41: sem duplicação', () => {
  it('registrar duas vezes o mesmo evento e enfileirar o mesmo job duas vezes → 1 linha e 1 chamada', async () => {
    const s = await cenarioTresItens();
    const a = await registrar(s, 'confirmacao');
    const b = await registrar(s, 'confirmacao');
    expect(b).toMatchObject({ criada: false, mensagemId: a.mensagemId, chave: a.chave });
    await enfileirar([a]);
    await enfileirar([{ ...a }]);
    await esperarMensagem(a.mensagemId, 'enviada');
    // reprocessar o mesmo job depois de enviada não chama o adaptador de novo
    const antes = p.jobs.length;
    await enfileirar([{ ...a }]);
    if (p.jobs.length > antes) expect((await esperarJob(p, 'whatsapp-reserva', p.jobs.at(-1)!)).state).toBe('completed');
    expect(await chamadasDaChave(a.chave)).toHaveLength(1);
    expect((await mensagensDaReservaDireto(s.reservaId)).filter((m) => m.tipo === 'confirmacao')).toHaveLength(1);
  });
});

describe('CA-42: cliente anonimizada', () => {
  it('cancelar e remarcar item funcionam e não registram mensagem enviável', async () => {
    const s = await cenarioTresItens();
    await anonimizarCliente(s.clienteId);
    const rem = await operar(s, { tipo: 'remarcar', itemId: s.itens[0], inicio: new Date('2031-03-10T16:00:00Z') });
    const canc = await operar(s, { tipo: 'cancelar', itemId: s.itens[1] });
    for (const r of [rem, canc]) {
      expect(r).toMatchObject({ estado: 'cancelada_anonimizacao', precisaEnfileirar: false });
      expect(await lerMensagem(r.mensagemId)).toMatchObject({ destinatarioE164: null, parametros: null });
    }
    const itens = await itensDa(s.reservaId);
    expect(itens.map((i) => i.status).sort()).toEqual(['cancelado', 'confirmado', 'confirmado']);
  });
});
