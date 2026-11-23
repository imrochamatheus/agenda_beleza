import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { verificarLink } from '@/server/avaliacoes/servico';

import type { SalaoCompleto } from '../../support/factories';
import { ipNovo } from '../../support/reserva-publica';
import { conferirDerivados } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { AGORA, contar, criarAvaliavel, ctxPublico, emitirLink, enviar, fotografia, salaoNovo } from './apoio';

// D-050 CA-45 (RN-34; PLAN CA-11): a avaliação continua por RESERVA e "só reservas concluídas" passa a
// ser "status DERIVADO `concluido`" (prioridade confirmado > concluido > nao_compareceu > cancelado) no
// link, no envio e na leitura pública. Reservas de vários itens com profissionais diferentes.

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await salaoNovo();
});
afterAll(async () => c.end());
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

/** Muda o status de UM item e grava o derivado na reserva (mesma regra de derivarReserva). */
async function mudarItem(reservaId: string, ordem: number, status: 'concluido' | 'nao_compareceu' | 'cancelado'): Promise<void> {
  await c.query('UPDATE reserva_item SET status = $3::status_reserva WHERE reserva_id = $1 AND ordem = $2', [reservaId, ordem, status]);
  await c.query(
    `UPDATE reserva r SET status = d.status, cancelada_em = CASE WHEN d.status = 'cancelado' THEN now() END
       FROM (SELECT CASE WHEN bool_or(status = 'confirmado') THEN 'confirmado'
                         WHEN bool_or(status = 'concluido') THEN 'concluido'
                         WHEN bool_or(status = 'nao_compareceu') THEN 'nao_compareceu'
                         ELSE 'cancelado' END::status_reserva AS status
               FROM reserva_item WHERE reserva_id = $1) d
      WHERE r.id = $1`,
    [reservaId],
  );
  await conferirDerivados(reservaId);
}

const total = async () => (await lerAvaliacoesPublicas(ctxPublico(s), 100)).total;

describe('CA-45: avaliação pelo status derivado da reserva', () => {
  it('todos os itens "não compareceu": o link responde "inválido" e nada é gravado', async () => {
    const k = await criarAvaliavel(c, s, { itens: ['concluido', 'concluido'] });
    const { token } = await emitirLink(s, k.reservaId);
    await mudarItem(k.reservaId, 0, 'nao_compareceu');
    await mudarItem(k.reservaId, 1, 'nao_compareceu');
    const antes = await fotografia(c, s.salaoId);
    expect(await verificarLink(s.slugAtual, token, ipNovo(), AGORA)).toEqual({ ok: false, motivo: 'invalido' });
    expect(await enviar(s, token)).toEqual({ resultado: 'link_invalido' });
    expect(await fotografia(c, s.salaoId)).toBe(antes);
  });

  it('um item concluído e outro "não compareceu" (de outro profissional): derivado concluído, avaliação aceita e exibida', async () => {
    const k = await criarAvaliavel(c, s, { itens: ['concluido', 'nao_compareceu'] });
    expect((await c.query('SELECT status::text AS s FROM reserva WHERE id = $1', [k.reservaId])).rows[0].s).toBe('concluido');
    const antes = await total();
    const { token } = await emitirLink(s, k.reservaId);
    expect((await verificarLink(s.slugAtual, token, ipNovo(), AGORA)).ok).toBe(true);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });
    expect(await total()).toBe(antes + 1);
    // Uma por reserva: a segunda tentativa com o mesmo link é recusada.
    expect(await enviar(s, token)).toEqual({ resultado: 'link_invalido' });
    const n = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM avaliacao WHERE reserva_id = $1', [k.reservaId]);
    expect(n.rows[0].n).toBe(1);
  });

  it('ainda há item confirmado: derivado confirmado, o link (emitido antes) é inválido', async () => {
    const k = await criarAvaliavel(c, s, { itens: ['concluido', 'concluido'] });
    const { token } = await emitirLink(s, k.reservaId);
    // Volta um item a confirmado direto no banco (a máquina não permite; aqui só prova a leitura do derivado).
    await c.query("UPDATE reserva_item SET status = 'confirmado' WHERE reserva_id = $1 AND ordem = 1", [k.reservaId]);
    await c.query("UPDATE reserva SET status = 'confirmado' WHERE id = $1", [k.reservaId]);
    expect(await enviar(s, token)).toEqual({ resultado: 'link_invalido' });
  });

  it('avaliação existente: some quando todos os itens viram "não compareceu" e volta com um item concluído', async () => {
    const k = await criarAvaliavel(c, s, { itens: ['concluido', 'concluido'] });
    const { token } = await emitirLink(s, k.reservaId);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });
    const com = await total();
    const avaliacoes = await contar(c, 'avaliacao', s.salaoId);

    await mudarItem(k.reservaId, 0, 'nao_compareceu');
    // Ainda há item concluído: continua visível.
    expect(await total()).toBe(com);
    await mudarItem(k.reservaId, 1, 'nao_compareceu');
    expect(await total()).toBe(com - 1);
    // A linha continua gravada (só deixa de ser exibida).
    expect(await contar(c, 'avaliacao', s.salaoId)).toBe(avaliacoes);

    await mudarItem(k.reservaId, 1, 'concluido');
    expect(await total()).toBe(com);
  });

  it('item cancelado não conta: concluído + cancelado é concluído; só cancelado + "não compareceu" é "não compareceu"', async () => {
    const ok = await criarAvaliavel(c, s, { itens: ['concluido', 'cancelado'] });
    const { token } = await emitirLink(s, ok.reservaId);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });

    const nc = await criarAvaliavel(c, s, { itens: ['concluido', 'cancelado'] });
    const { token: tNc } = await emitirLink(s, nc.reservaId);
    await mudarItem(nc.reservaId, 0, 'nao_compareceu');
    expect(await enviar(s, tNc)).toEqual({ resultado: 'link_invalido' });
  });
});
