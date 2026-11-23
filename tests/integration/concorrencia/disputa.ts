import type pg from 'pg';

import { nomeDoWorker } from '../../support/db';
import { criarPoolPg } from '../../support/sql';

// Apoio dos dois arquivos de concorrência do CA-6 (não é arquivo de teste). Usa o pool `pg` do harness
// (err.code e err.constraint sem embrulho) e respeita a regra A-7: os dados são preparados ANTES pelas
// fábricas (1–2 conexões do Prisma), e só então o pool de N conexões dispara as transações.
//
// Achado da T-5 (registrado em dev.md): com N transações abertas inserindo ao mesmo tempo no mesmo
// profissional, a exclusion `reserva_sem_sobreposicao` (D-050: `reserva_item_sem_sobreposicao`) faz cada INSERT esperar pelas outras transações em
// curso que conflitam com ele; duas que esperam uma pela outra formam um deadlock, que o PostgreSQL
// desfaz após `deadlock_timeout` (1 s) abortando uma com 40P01. Medido: ~50% das execuções com 12
// transações idênticas tiveram 40P01 em vez de 23P01. A garantia (nunca duas aceitas) se mantém; o CÓDIGO
// da recusa e o tempo, não. Por isso o modo `travarProfissional` trava a linha do profissional
// (`FOR NO KEY UPDATE`) antes do INSERT: as transações continuam concorrentes, a recusa continua sendo da
// exclusion (23P01), mas sem deadlock. O modo sem trava fica para provar a garantia em si.

export type Tentativa = {
  salaoId: string;
  profissionalId: string;
  clienteId: string;
  servicoId: string;
  inicio: Date;
  duracaoMin: number;
};

export type Resultado = { aceita: true; reservaId: string } | { aceita: false; code: string; constraint?: string };

/**
 * Abre N conexões, inicia N transações e só então dispara, ao mesmo tempo, o INSERT da reserva e do item
 * em cada uma; confirma as que passam e desfaz as recusadas. Devolve o resultado de cada tentativa.
 */
export async function disputar(
  tentativas: readonly Tentativa[],
  opcoes: { travarProfissional: boolean },
): Promise<Resultado[]> {
  const pool = criarPoolPg(tentativas.length);
  const clientes: pg.PoolClient[] = [];
  try {
    for (let i = 0; i < tentativas.length; i++) clientes.push(await pool.connect());
    // Todas as transações abertas antes do disparo: nenhuma começa "atrasada".
    await Promise.all(clientes.map((c) => c.query('BEGIN')));
    return await Promise.all(tentativas.map((t, i) => reservar(clientes[i], t, opcoes.travarProfissional)));
  } finally {
    for (const c of clientes) c.release();
    await pool.end();
  }
}

async function reservar(c: pg.PoolClient, t: Tentativa, travar: boolean): Promise<Resultado> {
  const fim = new Date(t.inicio.getTime() + t.duracaoMin * 60_000);
  try {
    if (travar) {
      await c.query('SELECT 1 FROM profissional WHERE salao_id = $1 AND id = $2 FOR NO KEY UPDATE', [
        t.salaoId,
        t.profissionalId,
      ]);
    }
    // D-050: a reserva guarda o envelope derivado; o item tem profissional, período e status, e é ele
    // que a exclusion `reserva_item_sem_sobreposicao` confere.
    const r = await c.query<{ id: string }>(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
       VALUES ($1, $2, $3, $4, 'confirmado', 'equipe') RETURNING id`,
      [t.salaoId, t.clienteId, t.inicio, fim],
    );
    const reservaId = r.rows[0].id;
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       VALUES ($1, $2, $3, $4, 0, 8000, $5, $6, $7, $7, 'confirmado')`,
      [t.salaoId, reservaId, t.servicoId, t.profissionalId, t.duracaoMin, t.inicio, fim],
    );
    await c.query('COMMIT');
    return { aceita: true, reservaId };
  } catch (e) {
    await c.query('ROLLBACK');
    const erro = e as pg.DatabaseError;
    if (typeof erro.code !== 'string') throw e;
    return { aceita: false, code: erro.code, constraint: erro.constraint };
  }
}

export function aceitas(resultados: readonly Resultado[]): Extract<Resultado, { aceita: true }>[] {
  return resultados.filter((r): r is Extract<Resultado, { aceita: true }> => r.aceita);
}

/** Identificação do worker para o registro do CA-6 (VITEST_POOL_ID e base). */
export function registroDoWorker(arquivo: string): { arquivo: string; poolId: string | undefined; base: string } {
  const registro = { arquivo, poolId: process.env.VITEST_POOL_ID, base: nomeDoWorker() };
  console.info(`[CA-6] arquivo=${registro.arquivo} VITEST_POOL_ID=${registro.poolId} base=${registro.base}`);
  return registro;
}
