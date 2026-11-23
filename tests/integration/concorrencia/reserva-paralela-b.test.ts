import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nomeDoWorker } from '../../support/db';
import { criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { aceitas, disputar, registroDoWorker } from './disputa';
import type { Tentativa } from './disputa';

// CA-6 (arquivo B): 12 transações concorrentes no MESMO profissional com horários DESLOCADOS que se
// sobrepõem dois a dois (início a cada 5 min, 60 min de duração). Exatamente uma é aceita; as outras 11
// são recusadas por `reserva_item_sem_sobreposicao` (23P01, D-050). Controle: profissionais diferentes no mesmo
// horário são todos aceitos (a exclusion é por profissional). Roda em paralelo com o arquivo A.
// Sobre a trava do profissional e o caso sem trava, ver o comentário de ./disputa.ts.

const N = 12;
let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

function tentativa(profissionalId: string, inicio: Date): Tentativa {
  return {
    salaoId: s.salaoId,
    profissionalId,
    clienteId: s.clientes.ativaId,
    servicoId: s.servicos.ativos[0],
    inicio,
    duracaoMin: 60,
  };
}

function deslocadas(base: Date, n: number): Tentativa[] {
  return Array.from({ length: n }, (_, i) =>
    tentativa(s.profissional.profissionalId, new Date(base.getTime() + i * 5 * 60_000)),
  );
}

async function idsNoIntervalo(de: Date, horas: number): Promise<string[]> {
  const r = await c.query<{ id: string }>(
    'SELECT DISTINCT reserva_id AS id FROM reserva_item WHERE salao_id = $1 AND profissional_id = $2 AND inicio >= $3 AND inicio < $4',
    [s.salaoId, s.profissional.profissionalId, de, new Date(de.getTime() + horas * 60 * 60_000)],
  );
  return r.rows.map((x) => x.id);
}

describe('CA-6 (B): disputa por horários sobrepostos em transações concorrentes', () => {
  it('CA-6: o arquivo roda na base do próprio worker (registro de VITEST_POOL_ID e base)', async () => {
    const reg = registroDoWorker('reserva-paralela-b');
    expect(Number(reg.poolId)).toBeGreaterThanOrEqual(1);
    const r = await c.query<{ b: string }>('SELECT current_database() AS b');
    expect(r.rows[0].b).toBe(nomeDoWorker());
  });

  it(`CA-6: ${N} reservas simultâneas sobrepostas → exatamente 1 aceita e ${N - 1} recusadas por 23P01`, async () => {
    const base = instanteFuturo(11, 14);
    const resultados = await disputar(deslocadas(base, N), { travarProfissional: true });
    const aceita = aceitas(resultados);
    expect(aceita).toHaveLength(1);
    expect(resultados.filter((r) => !r.aceita)).toEqual(
      Array.from({ length: N - 1 }, () => ({ aceita: false, code: '23P01', constraint: 'reserva_item_sem_sobreposicao' })),
    );
    expect(await idsNoIntervalo(base, 2)).toEqual([aceita[0].reservaId]);
  });

  it('CA-6: controle: profissionais diferentes no mesmo horário, ao mesmo tempo → todos aceitos', async () => {
    const inicio = instanteFuturo(12, 14);
    const profissionais = [s.profissional.profissionalId, s.gestor.profissionalId as string];
    const resultados = await disputar(
      profissionais.map((p) => tentativa(p, inicio)),
      { travarProfissional: true },
    );
    expect(resultados.map((r) => r.aceita)).toEqual([true, true]);
  });

  it(
    'CA-6: sem trava, a exclusion ainda garante exatamente 1 aceita; as recusas são 23P01 ou deadlock (40P01)',
    async () => {
      const base = instanteFuturo(13, 14);
      const resultados = await disputar(deslocadas(base, 6), { travarProfissional: false });
      const aceita = aceitas(resultados);
      expect(aceita).toHaveLength(1);
      for (const r of resultados.filter((x) => !x.aceita)) {
        expect([
          { aceita: false, code: '23P01', constraint: 'reserva_item_sem_sobreposicao' },
          { aceita: false, code: '40P01' },
        ]).toContainEqual(r);
      }
      expect(await idsNoIntervalo(base, 2)).toEqual([aceita[0].reservaId]);
    },
    60_000,
  );

  it('CA-6: a base deste worker contém só o salão criado por este arquivo', async () => {
    const r = await c.query<{ id: string }>('SELECT id FROM salao');
    expect(r.rows).toEqual([{ id: s.salaoId }]);
  });
});
