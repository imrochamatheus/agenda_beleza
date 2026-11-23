import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';

import { criarCenarioMensagem, criarMensagem, criarOutraReserva, lerMensagem, mudarReserva } from '../../support/mensagens';
import { conectar } from '../../support/sql';

import { itensDa } from './apoio';

// D-050 T-4 (RN-31, §3.7): `substituirNaoVigentes` = UM comando que marca `substituida` as `pendente` da
// reserva cujo PREDICADO_VIGENTE é falso. Itens e derivados são preparados por SQL (como a T-6 os grava).

const AGORA = new Date('2026-11-23T12:00:00Z');
const ctxDe = (salaoId: string) => contextoDeSistema(salaoId, 'teste');
const substituir = (salaoId: string, reservaId: string) =>
  emTransacao((r) => r.mensagens.substituirNaoVigentes(ctxDe(salaoId), reservaId, AGORA));

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function mudarItem(itemId: string, m: { status?: string; revisao?: number }) {
  await c.query(
    'UPDATE reserva_item SET status = COALESCE($2::status_reserva, status), revisao = COALESCE($3::int, revisao) WHERE id = $1',
    [itemId, m.status ?? null, m.revisao ?? null],
  );
}

describe('substituirNaoVigentes', () => {
  it('CA-39 (1ª parte): remarcar um item não substitui a confirmação pendente', async () => {
    const s = await criarCenarioMensagem();
    const [x] = await itensDa(s.reservaId);
    const conf = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0, destinatarioE164: s.telefone });
    await c.query('UPDATE reserva SET revisao = 1 WHERE id = $1', [s.reservaId]);
    await mudarItem(x.id, { revisao: 1 });
    const rem = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1 });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(0);
    expect((await lerMensagem(conf)).estado).toBe('pendente');
    expect((await lerMensagem(rem)).estado).toBe('pendente');
  });

  it('CA-40: segunda remarcação do mesmo item substitui a primeira pendente; outro item intocado', async () => {
    const s = await criarCenarioMensagem();
    const [x, y] = await itensDa(s.reservaId);
    await mudarItem(x.id, { revisao: 1 });
    const remX1 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, destinatarioE164: s.telefone });
    await mudarItem(y.id, { revisao: 2 });
    const remY2 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 2 });
    await mudarItem(x.id, { revisao: 3 });
    const remX3 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 3 });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(1);
    expect(await lerMensagem(remX1)).toMatchObject({
      estado: 'substituida',
      erroCodigo: 'substituida',
      destinatarioE164: null,
      parametros: null,
      atualizadoEm: AGORA,
    });
    expect((await lerMensagem(remY2)).estado).toBe('pendente');
    expect((await lerMensagem(remX3)).estado).toBe('pendente');
  });

  it('cancelar um item remarcado substitui a remarcação pendente dele; o cancelamento fica (vigente)', async () => {
    const s = await criarCenarioMensagem();
    const [x] = await itensDa(s.reservaId);
    await mudarItem(x.id, { revisao: 1 });
    const rem = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1 });
    await mudarItem(x.id, { revisao: 2, status: 'cancelado' });
    const canc = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 2 });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(1);
    expect((await lerMensagem(rem)).estado).toBe('substituida');
    expect((await lerMensagem(canc)).estado).toBe('pendente');
  });

  it('CA-39 (2ª parte): reserva toda cancelada substitui confirmação e remarcações pendentes; só pendentes mudam', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    const conf = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    const rem = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1 });
    const enviando = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 0, estado: 'enviando' });
    const falhou = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'convite_avaliacao', revisao: 0, estado: 'falhou' });
    await mudarReserva(s.reservaId, { status: 'cancelado', revisao: 2 });
    const todos = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 2 });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(2);
    expect((await lerMensagem(conf)).estado).toBe('substituida');
    expect((await lerMensagem(rem)).estado).toBe('substituida');
    expect((await lerMensagem(enviando)).estado).toBe('enviando');
    expect((await lerMensagem(falhou)).estado).toBe('falhou');
    expect((await lerMensagem(todos)).estado).toBe('pendente');
  });

  it('convite pendente com a reserva saindo de concluido → substituído (D-030 concluido → nao_compareceu)', async () => {
    const s = await criarCenarioMensagem({ status: 'concluido' });
    const convite = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'convite_avaliacao', revisao: 0 });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(0);
    await mudarReserva(s.reservaId, { status: 'nao_compareceu' });
    expect(await substituir(s.salaoId, s.reservaId)).toBe(1);
    expect((await lerMensagem(convite)).estado).toBe('substituida');
  });

  it('só a reserva pedida, só o salão do contexto; id malformado → NaoEncontrado', async () => {
    const s = await criarCenarioMensagem();
    const outraReserva = await criarOutraReserva(s, { status: 'cancelado' });
    const daOutra = await criarMensagem({ salaoId: s.salaoId, reservaId: outraReserva, tipo: 'confirmacao', revisao: 0 });
    const outroSalao = await criarCenarioMensagem({ status: 'cancelado' });
    const alheia = await criarMensagem({ salaoId: outroSalao.salaoId, reservaId: outroSalao.reservaId, tipo: 'confirmacao', revisao: 0 });
    await mudarReserva(s.reservaId, { status: 'cancelado' });
    const propria = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    // contexto de S tentando a reserva de outro salão: nada muda
    expect(await substituir(s.salaoId, outroSalao.reservaId)).toBe(0);
    expect((await lerMensagem(alheia)).estado).toBe('pendente');
    expect(await substituir(s.salaoId, s.reservaId)).toBe(1);
    expect((await lerMensagem(propria)).estado).toBe('substituida');
    expect((await lerMensagem(daOutra)).estado).toBe('pendente');
    await expect(repos().mensagens.substituirNaoVigentes(ctxDe(s.salaoId), 'nao-uuid', AGORA)).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });

  it('chamadas concorrentes na mesma reserva: sem impasse, cada pendente substituída uma vez', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    const ids: string[] = [];
    for (let rev = 2; rev < 12; rev++) {
      ids.push(await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: rev }));
    }
    const ns = await Promise.all(Array.from({ length: 10 }, () => substituir(s.salaoId, s.reservaId)));
    expect(ns.reduce((a, b) => a + b, 0)).toBe(10);
    for (const id of ids) expect((await lerMensagem(id)).estado).toBe('substituida');
  });
});
