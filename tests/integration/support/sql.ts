import { randomInt, randomUUID } from 'node:crypto';

import pg from 'pg';

import { urlBancoDeTeste } from './banco';

// Helpers mínimos dos testes de banco da D-004 (SQL direto pelo driver pg: err.code e
// err.constraint chegam sem embrulho). As fábricas completas de dois salões são da E0.5.
// Cada chamada gera UUIDs e telefones novos: nenhuma asserção depende de contagem global.

/** Abre uma conexão com a base de TEST_DATABASE_URL (validada pela guarda). */
export async function conectar(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: urlBancoDeTeste() });
  await c.connect();
  return c;
}

export type ErroSql = { code: string; constraint?: string };

/** Executa e devolve o erro do driver; falha o teste se a instrução for aceita. */
export async function erroSql(p: Promise<unknown>): Promise<ErroSql> {
  try {
    await p;
  } catch (e) {
    const erro = e as pg.DatabaseError;
    if (typeof erro.code !== 'string') throw e;
    return { code: erro.code, constraint: erro.constraint };
  }
  throw new Error('A instrução SQL foi aceita, mas era esperada uma rejeição');
}

/** Celular E.164 BR novo a cada chamada: +55 11 9XXXXXXXX. */
export function telefoneNovo(): string {
  return `+55119${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

/** Slug válido e único. */
export function slugNovo(): string {
  return `salao-${randomUUID().slice(0, 8)}`;
}

/** E-mail minúsculo e único. */
export function emailNovo(): string {
  return `u-${randomUUID()}@exemplo.com.br`;
}

async function id(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const r = await c.query<{ id: string }>(sql, params);
  return r.rows[0].id;
}

export async function criarSalao(c: pg.Client): Promise<string> {
  return id(c, 'INSERT INTO salao (nome) VALUES ($1) RETURNING id', ['Salão de teste']);
}

export async function criarProfissional(c: pg.Client, salaoId: string): Promise<string> {
  return id(c, 'INSERT INTO profissional (salao_id, nome) VALUES ($1, $2) RETURNING id', [
    salaoId,
    'Profissional de teste',
  ]);
}

export async function criarCliente(c: pg.Client, salaoId: string, telefone = telefoneNovo()): Promise<string> {
  return id(c, 'INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id', [
    salaoId,
    'Cliente de teste',
    telefone,
  ]);
}

export async function criarServico(c: pg.Client, salaoId: string): Promise<string> {
  return id(
    c,
    'INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, $2, $3, $4) RETURNING id',
    [salaoId, 'Corte', 8000, 60],
  );
}

export type NovaReserva = {
  salaoId: string;
  profissionalId: string;
  clienteId: string;
  inicio: string;
  fim: string;
  /** Padrão: igual a `fim` (intervalo 0). */
  ocupadoAte?: string;
  status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  chaveRequisicao?: string | null;
};

export async function inserirReserva(c: pg.Client, r: NovaReserva): Promise<string> {
  return id(
    c,
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem, chave_requisicao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'publico', $8) RETURNING id`,
    [
      r.salaoId,
      r.profissionalId,
      r.clienteId,
      r.inicio,
      r.fim,
      r.ocupadoAte ?? r.fim,
      r.status ?? 'confirmado',
      r.chaveRequisicao ?? null,
    ],
  );
}

/** Salão com um profissional e uma cliente, todos novos. */
export async function criarCenario(
  c: pg.Client,
): Promise<{ salaoId: string; profissionalId: string; clienteId: string }> {
  const salaoId = await criarSalao(c);
  return {
    salaoId,
    profissionalId: await criarProfissional(c, salaoId),
    clienteId: await criarCliente(c, salaoId),
  };
}
