import { randomInt, randomUUID } from 'node:crypto';

import pg from 'pg';

import { derivarReserva } from '@/server/reservas/itens';

import { urlDoWorker } from './db';

// Helpers mínimos dos testes de banco da D-004 (SQL direto pelo driver pg: err.code e
// err.constraint chegam sem embrulho). As fábricas completas de dois salões são da T-5 (E0.5).
// Cada chamada gera UUIDs e telefones novos: nenhuma asserção depende de contagem global.

/** Abre uma conexão com a base deste worker (recriada no início do arquivo). Feche com `end()`. */
export async function conectar(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: urlDoWorker() });
  await c.connect();
  return c;
}

/** Tamanho padrão de `criarPoolPg`: as 12 requisições paralelas do CA-6 (A-7 do DBA). */
export const POOL_PG_PADRAO = 12;

/**
 * Pool `pg` na base deste worker, para testes de concorrência que precisam de `err.code`/`err.constraint`
 * sem embrulho. Feche com `end()`.
 *
 * Regra do orçamento de conexões (dba.md §2.4, A-7): um arquivo não satura o pool do Prisma
 * (POOL_MAX_TESTES) e este pool ao mesmo tempo. Prepare os dados antes do disparo concorrente.
 */
export function criarPoolPg(max = POOL_PG_PADRAO): pg.Pool {
  return new pg.Pool({ connectionString: urlDoWorker(), max });
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

type StatusReservaSql = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
type Instante = string | Date;

const iso = (t: Instante): string => (t instanceof Date ? t : new Date(t)).toISOString();
const MIN_MS = 60_000;

/**
 * Reserva de UM item no formato antigo (D-050 R-12, compatível com os testes anteriores): grava a
 * reserva e um item com o profissional, `[inicio, fim)`, `ocupadoAte` (padrão `fim`), status e encaixe
 * dados, derivados coerentes (status/inicio/fim da reserva = os do item; `cancelada_em` só se
 * `cancelado`). `servicoId` ausente → cria um serviço "Serviço de teste" no salão. `fim - inicio` deve
 * ser um número inteiro de minutos de 1 a 1440 (reserva_item_fim_chk/duracao_teto_chk).
 */
export type NovaReserva = {
  salaoId: string;
  profissionalId: string;
  clienteId: string;
  inicio: Instante;
  fim: Instante;
  /** Padrão: igual a `fim` (intervalo 0). */
  ocupadoAte?: Instante;
  status?: StatusReservaSql;
  chaveRequisicao?: string | null;
  encaixe?: boolean;
  servicoId?: string;
  /** Revisão da reserva e do item (padrão 0). */
  revisao?: number;
};

/**
 * Insere a reserva e o item num ÚNICO comando (CTEs): um 23P01 de `reserva_item_sem_sobreposicao` (ou
 * outro erro) não deixa reserva órfã. Devolve o id da reserva.
 */
export async function inserirReserva(c: pg.Client, r: NovaReserva): Promise<string> {
  const dur = (new Date(iso(r.fim)).getTime() - new Date(iso(r.inicio)).getTime()) / MIN_MS;
  if (!Number.isInteger(dur)) throw new RangeError('inserirReserva: fim - inicio deve ser um número inteiro de minutos');
  const status = r.status ?? 'confirmado';
  return id(
    c,
    `WITH s AS (
       INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min)
       SELECT $1, 'Serviço de teste', 5000, GREATEST($10::int, 1) WHERE $9::uuid IS NULL
       RETURNING id
     ), r AS (
       INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, chave_requisicao, revisao, cancelada_em)
       VALUES ($1, $3, $4::timestamptz, $5::timestamptz, $7::status_reserva, 'publico', $8, $11,
               CASE WHEN $7::status_reserva = 'cancelado' THEN now() END)
       RETURNING id
     ), i AS (
       INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status, encaixe, revisao)
       SELECT $1, r.id, COALESCE($9::uuid, (SELECT id FROM s)), $2, 0, 5000, $10, $4::timestamptz, $5::timestamptz,
              $6::timestamptz, $7::status_reserva, $12, $11
         FROM r
       RETURNING reserva_id
     )
     SELECT reserva_id AS id FROM i`,
    [
      r.salaoId,
      r.profissionalId,
      r.clienteId,
      iso(r.inicio),
      iso(r.fim),
      iso(r.ocupadoAte ?? r.fim),
      status,
      r.chaveRequisicao ?? null,
      r.servicoId ?? null,
      dur,
      r.revisao ?? 0,
      r.encaixe ?? false,
    ],
  );
}

/** Item de `inserirReservaComItens`. `fim = inicio + duracaoMin`; `ocupadoAte = fim + intervaloMin`. */
export type NovoItemSql = {
  profissionalId: string;
  inicio: Instante;
  /** Padrão 30. */
  duracaoMin?: number;
  /** Padrão 0. */
  intervaloMin?: number;
  status?: StatusReservaSql;
  encaixe?: boolean;
  /** Ausente → cria um serviço novo no salão (a UNIQUE (salao, reserva, servico) exige serviços distintos). */
  servicoId?: string;
  precoCentavos?: number;
  /** Revisão do item (padrão: a da reserva). */
  revisao?: number;
};

/**
 * Reserva com N itens (D-050) gravada por SQL direto: derivados (status, inicio, fim, cancelada_em) pela
 * MESMA regra de `derivarReserva` (reservas/itens.ts) e itens num único comando com a reserva (CTE).
 * `ordem` = posição no array. Devolve o id da reserva e os ids dos itens na ordem do array.
 */
export async function inserirReservaComItens(
  c: pg.Client,
  r: {
    salaoId: string;
    clienteId: string;
    itens: NovoItemSql[];
    origem?: 'publico' | 'equipe';
    revisao?: number;
    chaveRequisicao?: string | null;
  },
): Promise<{ reservaId: string; itemIds: string[] }> {
  if (r.itens.length === 0) throw new RangeError('inserirReservaComItens: ao menos um item');
  const servicos: string[] = [];
  for (const it of r.itens) {
    servicos.push(it.servicoId ?? (await criarServico(c, r.salaoId)));
  }
  const revisao = r.revisao ?? 0;
  const itens = r.itens.map((it) => {
    const inicio = new Date(iso(it.inicio));
    const dur = it.duracaoMin ?? 30;
    const fim = new Date(inicio.getTime() + dur * MIN_MS);
    return {
      ...it,
      inicio,
      fim,
      dur,
      ocupadoAte: new Date(fim.getTime() + (it.intervaloMin ?? 0) * MIN_MS),
      status: it.status ?? ('confirmado' as const),
    };
  });
  const d = derivarReserva(itens, null, new Date());
  const res = await c.query<{ reserva_id: string; id: string; ordem: number }>(
    `WITH r AS (
       INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, chave_requisicao, revisao, cancelada_em)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::status_reserva, $6::origem_reserva, $7, $8, $9::timestamptz)
       RETURNING id
     )
     INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                               inicio, fim, ocupado_ate, status, encaixe, revisao)
     SELECT $1, r.id, x.servico, x.prof, x.ordem, x.preco, x.dur, x.ini, x.fim, x.ocup, x.st, x.enc, x.rev
       FROM r, unnest($10::uuid[], $11::uuid[], $12::int[], $13::int[], $14::int[], $15::timestamptz[], $16::timestamptz[],
                      $17::timestamptz[], $18::status_reserva[], $19::bool[], $20::int[])
            AS x(servico, prof, ordem, preco, dur, ini, fim, ocup, st, enc, rev)
     RETURNING reserva_id, id, ordem`,
    [
      r.salaoId,
      r.clienteId,
      d.inicio.toISOString(),
      d.fim.toISOString(),
      d.status,
      r.origem ?? 'publico',
      r.chaveRequisicao ?? null,
      revisao,
      d.canceladaEm?.toISOString() ?? null,
      servicos,
      itens.map((i) => i.profissionalId),
      itens.map((_, k) => k),
      itens.map((i) => i.precoCentavos ?? 5000),
      itens.map((i) => i.dur),
      itens.map((i) => i.inicio.toISOString()),
      itens.map((i) => i.fim.toISOString()),
      itens.map((i) => i.ocupadoAte.toISOString()),
      itens.map((i) => i.status),
      itens.map((i) => i.encaixe ?? false),
      itens.map((i) => i.revisao ?? revisao),
    ],
  );
  const porOrdem = [...res.rows].sort((a, b) => a.ordem - b.ordem);
  return { reservaId: porOrdem[0].reserva_id, itemIds: porOrdem.map((x) => x.id) };
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
