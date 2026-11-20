import type pg from 'pg';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';

// Apoio local aos testes de tests/integration/jornadas (D-015). Não é arquivo de teste (o glob do
// Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

export const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

export type LinhaJornada = { id: string; dia_semana: number; inicio_min: number; fim_min: number };

/** Faixas "HH:MM" por dia (0 = domingo). */
export type SemanaTexto = Partial<Record<number, [string, string][]>>;

/** Entrada da ação com os 7 dias explícitos (D-15): os omitidos são folga (`intervalos: []`). */
export function semana(profissionalId: unknown, dias: SemanaTexto = {}) {
  return {
    profissionalId,
    dias: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
      diaSemana,
      intervalos: (dias[diaSemana] ?? []).map(([inicio, fim]) => ({ inicio, fim })),
    })),
  };
}

/** Linhas de jornada do profissional, ordenadas por dia, início e id. */
export async function linhasJornada(c: pg.Client, profissionalId: string): Promise<LinhaJornada[]> {
  const { rows } = await c.query<LinhaJornada>(
    `SELECT id::text AS id, dia_semana, inicio_min, fim_min FROM jornada
      WHERE profissional_id = $1 ORDER BY dia_semana, inicio_min, id`,
    [profissionalId],
  );
  return rows;
}

/** As linhas sem os ids: [dia, início, fim]. */
export async function faixasJornada(c: pg.Client, profissionalId: string): Promise<[number, number, number][]> {
  return (await linhasJornada(c, profissionalId)).map((l) => [l.dia_semana, l.inicio_min, l.fim_min]);
}

/** Todas as linhas de jornada do salão, como JSON ordenado (prova de "nada mudou"). */
export async function jornadaDoSalao(c: pg.Client, salaoId: string): Promise<unknown[]> {
  const { rows } = await c.query<{ j: unknown }>(
    'SELECT to_jsonb(j) AS j FROM jornada j WHERE salao_id = $1 ORDER BY profissional_id, dia_semana, inicio_min, id',
    [salaoId],
  );
  return rows.map((r) => r.j);
}

/** Apaga a jornada do profissional (cenário "sem jornada"). */
export async function apagarJornada(c: pg.Client, profissionalId: string): Promise<void> {
  await c.query('DELETE FROM jornada WHERE profissional_id = $1', [profissionalId]);
}

/** reserva e reserva_item do salão, byte a byte (to_jsonb), para provar a RN-9. */
export async function fotografiaReservas(c: pg.Client, salaoId: string): Promise<{ reservas: unknown[]; itens: unknown[] }> {
  const reservas = await c.query<{ j: unknown }>('SELECT to_jsonb(r) AS j FROM reserva r WHERE salao_id = $1 ORDER BY id', [
    salaoId,
  ]);
  const itens = await c.query<{ j: unknown }>('SELECT to_jsonb(i) AS j FROM reserva_item i WHERE salao_id = $1 ORDER BY id', [
    salaoId,
  ]);
  return { reservas: reservas.rows.map((r) => r.j), itens: itens.rows.map((r) => r.j) };
}

/** Linhas de `mensagem` (toda a base deste worker). */
export async function contarMensagens(c: pg.Client): Promise<number> {
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM mensagem');
  return rows[0].n;
}
