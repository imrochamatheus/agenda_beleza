import type pg from 'pg';

import { telefoneNovo } from '../../support/sql';

export { credGestor, credProfissional, ctxDoGestor, ctxDoProfissional, MANAUS, SP, UUID_INEXISTENTE } from '../salao/apoio';
export { ACESSO_NEGADO, NAO_AUTENTICADO, NAO_ENCONTRADO } from '../salao/apoio';

// Apoio local aos testes de tests/integration/clientes (D-022). Não é arquivo de teste. SQL direto pelo
// driver `pg` na base deste worker, sem mocks de banco.

/** Cliente ativa; devolve o id. */
export async function inserirCliente(c: pg.Client, salaoId: string, nome: string, telefone = telefoneNovo()): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id::text AS id',
    [salaoId, nome, telefone],
  );
  return rows[0].id;
}

/** Anonimiza pelo SQL (a ação é da E5.2): nome e telefone nulos e `anonimizada_em`. */
export async function anonimizarPorSql(c: pg.Client, clienteId: string): Promise<void> {
  await c.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [clienteId]);
}

/** Linha inteira da cliente (to_jsonb): prova byte a byte de "nada mudou". */
export async function linhaCliente(c: pg.Client, id: string): Promise<Record<string, unknown>> {
  const { rows } = await c.query<{ j: Record<string, unknown> }>('SELECT to_jsonb(t) AS j FROM cliente t WHERE id = $1', [id]);
  return rows[0].j;
}

export async function contarClientes(c: pg.Client, salaoId: string, telefone?: string): Promise<number> {
  const { rows } =
    telefone === undefined
      ? await c.query<{ n: string }>('SELECT count(*) AS n FROM cliente WHERE salao_id = $1', [salaoId])
      : await c.query<{ n: string }>('SELECT count(*) AS n FROM cliente WHERE salao_id = $1 AND telefone_e164 = $2', [salaoId, telefone]);
  return Number(rows[0].n);
}

export type ReservaComPreco = {
  salaoId: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  status: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  itens: { servicoId: string; precoCentavos: number; duracaoMin: number }[];
};

/** Reserva com itens de snapshot explícito. Devolve o id. */
export async function inserirReservaComPreco(c: pg.Client, r: ReservaComPreco): Promise<string> {
  const minutos = r.itens.reduce((t, i) => t + i.duracaoMin, 0);
  const fim = new Date(r.inicio.getTime() + minutos * 60_000);
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'equipe') RETURNING id::text AS id`,
    [r.salaoId, r.profissionalId, r.clienteId, r.inicio, fim, r.status],
  );
  for (const [ordem, i] of r.itens.entries()) {
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.salaoId, rows[0].id, i.servicoId, ordem, i.precoCentavos, i.duracaoMin],
    );
  }
  return rows[0].id;
}

/** Fotografia (to_jsonb) de reserva, reserva_item e mensagem do salão (RN-13). */
export async function fotografiaReservas(c: pg.Client, salaoId: string): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const tabela of ['reserva', 'reserva_item', 'mensagem']) {
    const { rows } = await c.query<{ j: unknown }>(`SELECT to_jsonb(t) AS j FROM ${tabela} t WHERE salao_id = $1 ORDER BY id`, [salaoId]);
    r[tabela] = rows.map((l) => l.j);
  }
  return r;
}
