import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarMensagensDaReserva } from '@/server/mensagens/consultar-por-reserva';

import { criarMensagem } from '../../support/mensagens';
import { definirAssinatura } from '../../support/reserva-publica';
import { instalarContadorDeComandos } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';
import { UUID_INEXISTENTE, anonimizarPorSql, criarCenario, ctxDaAna, hora, inserirCliente, reservar } from '../agenda/apoio';

// D-043 T-3: situação de envio para a equipe (CA-1, 2, 3, 5, 6, 11, 12, 13), PostgreSQL real.

let c: pg.Client;
let x: CenarioReserva;
let y: CenarioReserva;

beforeAll(async () => {
  c = await conectar();
  x = await criarCenario();
  y = await criarCenario();
});
afterAll(async () => {
  await c.end();
});

const t = (min: number) => new Date(Date.UTC(2026, 10, 22, 17, min));

describe('consultarMensagensDaReserva', () => {
  it('CA-1/CA-2: falha com data e motivo mapeado; enviada; gestor e profissional dono veem o mesmo', async () => {
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('10:00') });
    const falhou = await criarMensagem({
      salaoId: x.s.salaoId, reservaId: id, tipo: 'confirmacao', revisao: 0, estado: 'falhou', erroCodigo: 'resultado_incerto',
      atualizadoEm: t(1), tentativas: [{ resultado: 'falha', iniciadaEm: t(1) }, { resultado: 'falha', iniciadaEm: t(5) }],
    });
    const enviada = await criarMensagem({
      salaoId: x.s.salaoId, reservaId: id, tipo: 'cancelamento', revisao: 0, estado: 'enviada', atualizadoEm: t(9),
      tentativas: [{ resultado: 'sucesso', iniciadaEm: t(9) }],
    });
    const esperado = [
      { id: falhou, estado: 'falhou', rotulo: 'Falha ao enviar confirmação por WhatsApp', motivo: 'Não foi possível confirmar se a mensagem foi entregue.', tentativas: 2, ultimaTentativaEm: t(5) },
      { id: enviada, estado: 'enviada', rotulo: 'Cancelamento enviado', motivo: null, tentativas: 1, ultimaTentativaEm: t(9) },
    ];
    expect(await consultarMensagensDaReserva(x.ctxEquipe, id)).toEqual(esperado);
    expect(await consultarMensagensDaReserva(ctxDaAna(x), id)).toEqual(esperado);
  });

  it('CA-6: reserva remarcada 2 vezes lista as 3 em ordem de criação, com Remarcação 1 e 2', async () => {
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('12:00') });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: id, tipo: 'confirmacao', revisao: 0, estado: 'substituida', atualizadoEm: t(1) });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: id, tipo: 'remarcacao', revisao: 1, estado: 'substituida', atualizadoEm: t(2) });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: id, tipo: 'remarcacao', revisao: 2, estado: 'pendente', atualizadoEm: t(3) });
    const lista = await consultarMensagensDaReserva(x.ctxEquipe, id);
    expect(lista.map((m) => m.rotulo)).toEqual([
      'Confirmação substituída por remarcação posterior',
      'Remarcação 1 substituída por remarcação posterior',
      'Remarcação 2 aguardando envio',
    ]);
  });

  it('CA-13: reserva sem mensagens devolve lista vazia', async () => {
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('13:00') });
    expect(await consultarMensagensDaReserva(x.ctxEquipe, id)).toEqual([]);
  });

  it('CA-3: reserva de outro profissional, inexistente, malformada e de outro salão são idênticas (404)', async () => {
    const daBia = await reservar(c, x, { profissionalId: x.bia, inicio: hora('14:00') });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: daBia, estado: 'enviada' });
    const doOutroSalao = await reservar(c, y, { profissionalId: y.ana, inicio: hora('14:00') });
    const casos: [string, () => Promise<unknown>][] = [
      ['profissional A, reserva de B', () => consultarMensagensDaReserva(ctxDaAna(x), daBia)],
      ['id inexistente', () => consultarMensagensDaReserva(x.ctxEquipe, UUID_INEXISTENTE)],
      ['id malformado', () => consultarMensagensDaReserva(x.ctxEquipe, 'nao-uuid')],
      ['id não texto', () => consultarMensagensDaReserva(x.ctxEquipe, { toString: () => daBia })],
      ['gestor de outro salão', () => consultarMensagensDaReserva(y.ctxEquipe, daBia)],
      ['profissional de outro salão', () => consultarMensagensDaReserva(ctxDaAna(y), daBia)],
      ['reserva de outro salão no salão errado', () => consultarMensagensDaReserva(x.ctxEquipe, doOutroSalao)],
    ];
    const erros: string[] = [];
    for (const [nome, f] of casos) {
      const e = await f().then(() => null, (err: unknown) => err);
      expect(e, nome).toMatchObject({ name: 'NaoEncontrado' });
      erros.push(`${(e as Error).name}|${(e as Error).message}`);
    }
    expect(new Set(erros).size).toBe(1);
  });

  it('CA-5: nenhum valor sentinela (destinatário, provedor, erroCodigo bruto, erro_detalhe) sai no JSON', async () => {
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('15:00') });
    const m = await criarMensagem({
      salaoId: x.s.salaoId, reservaId: id, tipo: 'confirmacao', estado: 'falhou', erroCodigo: 'SENTINELA_CODIGO',
      destinatarioE164: '+5511987650999', provedorMensagemId: 'wamid.SENTINELA_PROVEDOR', tentativas: [{ resultado: 'falha', erroCodigo: 'SENTINELA_CODIGO' }],
    });
    await c.query(`UPDATE mensagem SET parametros = '["SENTINELA_PARAMETRO"]'::jsonb WHERE id = $1`, [m]);
    await c.query(`UPDATE mensagem_tentativa SET erro_detalhe = 'SENTINELA_DETALHE' WHERE mensagem_id = $1`, [m]);
    const lista = await consultarMensagensDaReserva(x.ctxEquipe, id);
    expect(lista).toHaveLength(1);
    expect(lista[0].motivo).toBeNull();
    const json = JSON.stringify(lista);
    for (const s of ['SENTINELA', '987650999', 'wamid', 'erroCodigo', 'destinatario', 'parametros']) {
      expect(json, s).not.toContain(s);
    }
    expect(Object.keys(lista[0]).sort()).toEqual(['estado', 'id', 'motivo', 'rotulo', 'tentativas', 'ultimaTentativaEm']);
  });

  it('CA-11: salão suspenso continua lendo as mensagens', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00') });
    await criarMensagem({ salaoId: s.s.salaoId, reservaId: id, estado: 'enviada' });
    await definirAssinatura(s.s.salaoId, 'suspensa');
    expect((await consultarMensagensDaReserva(s.ctxEquipe, id)).map((m) => m.rotulo)).toEqual(['Confirmação enviada']);
  });

  it('CA-12: cliente anonimizada continua listada, sem nome nem telefone', async () => {
    const cli = await inserirCliente(c, x.s.salaoId, 'Fulana Sumida', '+5511977770099');
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('16:00'), clienteId: cli });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: id, estado: 'cancelada_anonimizacao' });
    await anonimizarPorSql(c, cli);
    const lista = await consultarMensagensDaReserva(x.ctxEquipe, id);
    expect(lista).toHaveLength(1);
    expect(lista[0].rotulo).toBe('Confirmação não enviada');
    expect(lista[0].motivo).toBe('Cliente removida; a mensagem foi cancelada.');
    expect(JSON.stringify(lista)).not.toMatch(/Fulana|977770099/);
  });

  it('um comando SQL por chamada, só leitura (sem FOR nem escrita)', async () => {
    const id = await reservar(c, x, { profissionalId: x.ana, inicio: hora('17:00') });
    await criarMensagem({ salaoId: x.s.salaoId, reservaId: id, estado: 'enviada' });
    const contador = instalarContadorDeComandos();
    try {
      await consultarMensagensDaReserva(x.ctxEquipe, id);
      expect(contador.contar()).toBe(1);
    } finally {
      await contador.encerrar();
    }
    const fonte = (await import('node:fs')).readFileSync('src/server/repos/mensagem.ts', 'utf8');
    const trecho = fonte.slice(fonte.indexOf('async listarDaReservaDaEquipe'));
    expect(trecho).not.toMatch(/\bFOR (UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b|\bINSERT\b|\bUPDATE mensagem\b|\bDELETE\b/);
  });
});
