import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executarPrisma, urlDoWorker } from '../../support/db';
import { conectar, erroSql } from '../../support/sql';

// D-050 T-1: CA-46..CA-49 (RN-39) e Q9/Q15 do dba.md. Base dedicada: a base deste worker (recriada a partir do
// template no início do arquivo e apagada no fim) tem o schema public refeito do zero; as 14 migrações anteriores
// são aplicadas por `prisma migrate deploy` com um config temporário (pasta de migrações sem a D-050), os dados são
// gravados no MODELO ANTIGO, e a migração nova é aplicada pelo mesmo `migrate deploy` real.

const MIGRACAO = '20261127000000_reserva_item_autonomo';
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
const PASTA_MIGRACOES = join(RAIZ, 'prisma', 'migrations');
const SQL_MIGRACAO = readFileSync(join(PASTA_MIGRACOES, MIGRACAO, 'migration.sql'), 'utf8');

let c: pg.Client;
let dir: string;
let config: string;

function deploy() {
  return executarPrisma(['migrate', 'deploy', '--config', config], urlDoWorker());
}

/** Copia a migração da D-050 para a pasta temporária (até aqui só existiam as anteriores). */
function liberarMigracaoNova(): void {
  cpSync(join(PASTA_MIGRACOES, MIGRACAO), join(dir, 'migrations', MIGRACAO), { recursive: true });
}

/** Bloco entre os marcadores do cabeçalho, sem o prefixo "-- " (CA-48). */
function extrairReversao(sql: string): string {
  const linhas = sql.split('\n');
  const ini = linhas.findIndex((l) => l.trim() === '-- REVERSAO-INICIO');
  const fim = linhas.findIndex((l) => l.trim() === '-- REVERSAO-FIM');
  if (ini < 0 || fim <= ini) throw new Error('marcadores de reversão ausentes');
  return linhas
    .slice(ini + 1, fim)
    .map((l) => {
      if (!l.startsWith('--')) throw new Error(`linha de reversão sem comentário: ${l}`);
      return l.replace(/^-- ?/, '');
    })
    .join('\n');
}

async function linhas<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query<T>(sql, params)).rows;
}

/** Retrato do catálogo das três tabelas tocadas: colunas (sem ordem), restrições e índices. */
async function catalogo() {
  const tabelas = ['reserva', 'reserva_item', 'mensagem'];
  return {
    colunas: await linhas(
      `SELECT table_name, column_name, data_type, datetime_precision, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY table_name, column_name`,
      [tabelas],
    ),
    restricoes: await linhas(
      `SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid::regclass::text = ANY($1) ORDER BY 1, 2`,
      [tabelas],
    ),
    indices: await linhas(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1, 2`,
      [tabelas],
    ),
  };
}

async function contagens() {
  const [r] = await linhas<{ reservas: number; itens: number; mensagens: number; avaliacoes: number }>(
    `SELECT (SELECT count(*) FROM reserva)::int AS reservas, (SELECT count(*) FROM reserva_item)::int AS itens,
            (SELECT count(*) FROM mensagem)::int AS mensagens, (SELECT count(*) FROM avaliacao)::int AS avaliacoes`,
  );
  return r;
}

const ATIVOS = "('confirmado', 'concluido', 'nao_compareceu')";

/** União das ocupações ativas por profissional, como texto (multirange normalizado). */
async function uniaoAntiga(): Promise<Record<string, string>> {
  const r = await linhas<{ p: string; u: string }>(
    `SELECT profissional_id::text AS p, range_agg(tstzrange(inicio, ocupado_ate, '[)'))::text AS u
       FROM reserva WHERE status IN ${ATIVOS} GROUP BY 1 ORDER BY 1`,
  );
  return Object.fromEntries(r.map((x) => [x.p, x.u]));
}

async function uniaoNova(): Promise<Record<string, string>> {
  const r = await linhas<{ p: string; u: string }>(
    `SELECT profissional_id::text AS p, range_agg(tstzrange(inicio, ocupado_ate, '[)'))::text AS u
       FROM reserva_item WHERE status IN ${ATIVOS} GROUP BY 1 ORDER BY 1`,
  );
  return Object.fromEntries(r.map((x) => [x.p, x.u]));
}

/** Vigência ANTIGA (D-024/D-043, `COLUNAS` de repos/agenda.ts antes da D-050). */
const VIGENCIA_ANTIGA = `
  ((m.tipo IN ('confirmacao', 'remarcacao') AND m.revisao = r.revisao AND r.status = 'confirmado')
   OR (m.tipo = 'cancelamento' AND m.revisao = r.revisao AND r.status = 'cancelado')
   OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido'))`;

/** PREDICADO_VIGENTE proposto no dba.md (Q7), aliases m e r. */
const VIGENCIA_NOVA = `
  ((m.tipo = 'confirmacao' AND r.status = 'confirmado')
   OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido')
   OR (m.tipo = 'remarcacao' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'confirmado'))
   OR (m.tipo = 'cancelamento' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'cancelado')))`;

async function vigencias(predicado: string): Promise<Record<string, boolean>> {
  const r = await linhas<{ id: string; v: boolean }>(
    `SELECT m.id::text AS id, ${predicado} AS v FROM mensagem m JOIN reserva r ON r.salao_id = m.salao_id AND r.id = m.reserva_id`,
  );
  return Object.fromEntries(r.map((x) => [x.id, x.v]));
}

type Ids = {
  salao: string;
  p1: string;
  p2: string;
  cliente: string;
  servicos: string[];
  r: Record<string, string>;
  m: Record<string, string>;
};
let ids: Ids;

async function uuid(sql: string, params: unknown[]): Promise<string> {
  return (await c.query<{ id: string }>(sql, params)).rows[0].id;
}

/** Reserva no modelo ANTIGO: N itens pela ordem, fim = inicio + soma, ocupado_ate = fim + intervalo. */
async function reservaAntiga(o: {
  prof: string;
  inicio: string;
  duracoes: number[];
  ordens?: number[];
  intervalo?: number;
  status: string;
  encaixe?: boolean;
  revisao?: number;
  canceladaEm?: string | null;
  fimForcado?: string;
  servicos?: string[];
}): Promise<string> {
  const soma = o.duracoes.reduce((a, b) => a + b, 0);
  const id = await uuid(
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem, encaixe, revisao, cancelada_em)
     VALUES ($1, $2, $3, $4::timestamptz, COALESCE($11::timestamptz, $4::timestamptz + make_interval(mins => $5::int)),
             COALESCE($11::timestamptz, $4::timestamptz + make_interval(mins => $5::int)) + make_interval(mins => $6::int),
             $7::status_reserva, 'publico', $8, $9, $10) RETURNING id`,
    [
      ids.salao,
      o.prof,
      ids.cliente,
      o.inicio,
      soma,
      o.intervalo ?? 0,
      o.status,
      o.encaixe ?? false,
      o.revisao ?? 0,
      o.canceladaEm ?? null,
      o.fimForcado ?? null,
    ],
  );
  for (let k = 0; k < o.duracoes.length; k++) {
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ids.salao, id, (o.servicos ?? ids.servicos)[k], o.ordens?.[k] ?? k, 1000 * (k + 1), o.duracoes[k]],
    );
  }
  return id;
}

async function mensagem(reserva: string, tipo: string, revisao: number, estado: string): Promise<string> {
  return uuid(
    `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado)
     VALUES ($1, $2, $3::tipo_mensagem, $4, $5::estado_mensagem) RETURNING id`,
    [ids.salao, reserva, tipo, revisao, estado],
  );
}

let antes: {
  catalogo: Awaited<ReturnType<typeof catalogo>>;
  contagens: Awaited<ReturnType<typeof contagens>>;
  uniao: Record<string, string>;
  vigencia: Record<string, boolean>;
  reservas: unknown[];
  itens: unknown[];
};

beforeAll(async () => {
  c = await conectar();
  // Base do worker (descartável): schema public refeito; pgboss e o schema de prova ficam.
  await c.query('DROP SCHEMA public CASCADE');
  await c.query('CREATE SCHEMA public');

  dir = mkdtempSync(join(tmpdir(), 'd050-migracao-'));
  const anteriores = readdirSync(PASTA_MIGRACOES).filter((n) => n !== MIGRACAO);
  for (const n of anteriores) cpSync(join(PASTA_MIGRACOES, n), join(dir, 'migrations', n), { recursive: true });
  config = join(dir, 'prisma.config.ts');
  writeFileSync(
    config,
    `export default {\n  schema: ${JSON.stringify(join(RAIZ, 'prisma', 'schema.prisma'))},\n` +
      `  migrations: { path: ${JSON.stringify(join(dir, 'migrations'))} },\n` +
      `  datasource: { url: process.env.DATABASE_URL ?? '' },\n};\n`,
  );
  const r = deploy();
  if (r.status !== 0) throw new Error(`deploy das migrações anteriores falhou:\n${r.stderr}\n${r.stdout}`);

  // Dados no modelo antigo (1 e 3 itens, todos os status, encaixe, remarcada, cancelada, ordens com lacunas).
  const salao = await uuid("INSERT INTO salao (nome, intervalo_min) VALUES ('Migração', 10) RETURNING id", []);
  ids = {
    salao,
    p1: await uuid("INSERT INTO profissional (salao_id, nome) VALUES ($1, 'P1') RETURNING id", [salao]),
    p2: await uuid("INSERT INTO profissional (salao_id, nome) VALUES ($1, 'P2') RETURNING id", [salao]),
    cliente: await uuid(
      "INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Cliente', '+5511912345678') RETURNING id",
      [salao],
    ),
    servicos: [],
    r: {},
    m: {},
  };
  for (const d of [30, 40, 50]) {
    ids.servicos.push(
      await uuid('INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, $2, 1000, $3) RETURNING id', [
        salao,
        `S${d}`,
        d,
      ]),
    );
  }
  const r1 = await reservaAntiga({ prof: ids.p1, inicio: '2026-12-01T10:00:00Z', duracoes: [30], intervalo: 10, status: 'confirmado' });
  const r2 = await reservaAntiga({
    prof: ids.p1,
    inicio: '2026-12-01T13:00:00Z',
    duracoes: [30, 40, 50],
    intervalo: 10,
    status: 'confirmado',
    encaixe: true,
    revisao: 2,
  });
  const r3 = await reservaAntiga({
    prof: ids.p2,
    inicio: '2026-12-01T13:00:00Z',
    duracoes: [50, 30, 40],
    servicos: [ids.servicos[2], ids.servicos[0], ids.servicos[1]],
    intervalo: 10,
    status: 'cancelado',
    revisao: 1,
    canceladaEm: '2026-11-30T12:00:00Z',
  });
  const r4 = await reservaAntiga({ prof: ids.p2, inicio: '2026-11-20T09:00:00Z', duracoes: [40], status: 'concluido' });
  // Ordens com lacuna (2, 5, 9): a sequência é pela ordem, não pelo valor.
  const r5 = await reservaAntiga({
    prof: ids.p1,
    inicio: '2026-11-21T09:00:00Z',
    duracoes: [40, 30, 50],
    ordens: [9, 2, 5],
    status: 'nao_compareceu',
  });
  // Adjacente a R1 depois do intervalo (10:40): a união é contínua e nada conflita.
  const r6 = await reservaAntiga({ prof: ids.p1, inicio: '2026-12-01T10:40:00Z', duracoes: [40], status: 'confirmado', encaixe: true });
  ids.r = { r1, r2, r3, r4, r5, r6 };

  ids.m = {
    r1_conf: await mensagem(r1, 'confirmacao', 0, 'pendente'),
    r2_conf: await mensagem(r2, 'confirmacao', 0, 'falhou'),
    r2_rem1: await mensagem(r2, 'remarcacao', 1, 'falhou'),
    r2_rem2: await mensagem(r2, 'remarcacao', 2, 'falhou'),
    r3_conf: await mensagem(r3, 'confirmacao', 0, 'substituida'),
    r3_rem1: await mensagem(r3, 'remarcacao', 1, 'enviada'),
    r3_canc: await mensagem(r3, 'cancelamento', 1, 'falhou'),
    r4_conf: await mensagem(r4, 'confirmacao', 0, 'enviada'),
    r4_conv: await mensagem(r4, 'convite_avaliacao', 0, 'falhou'),
    r5_conv: await mensagem(r5, 'convite_avaliacao', 0, 'pendente'),
  };
  await c.query(
    `INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, publicacao_aceita_em, versao_termos)
     VALUES ($1, $2, $3, 5, now(), 'v1')`,
    [salao, r4, ids.cliente],
  );

  antes = {
    catalogo: await catalogo(),
    contagens: await contagens(),
    uniao: await uniaoAntiga(),
    vigencia: await vigencias(VIGENCIA_ANTIGA),
    reservas: await linhas('SELECT * FROM reserva ORDER BY id'),
    itens: await linhas('SELECT * FROM reserva_item ORDER BY id'),
  };
}, 120_000);

afterAll(async () => {
  await c.end();
  rmSync(dir, { recursive: true, force: true });
});

describe('D-050: migração 20261127000000_reserva_item_autonomo', () => {
  it('CA-47 (RN-39, Q9): com dados inconsistentes o deploy falha na guarda, informa as contagens e NADA é alterado', async () => {
    // Quatro problemas, um de cada tipo.
    const semItens = await uuid(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       VALUES ($1, $2, $3, '2026-12-05T10:00:00Z', '2026-12-05T11:00:00Z', '2026-12-05T11:00:00Z', 'confirmado', 'publico') RETURNING id`,
      [ids.salao, ids.p2, ids.cliente],
    );
    const fimErrado = await reservaAntiga({
      prof: ids.p2,
      inicio: '2026-12-06T10:00:00Z',
      duracoes: [30, 40],
      status: 'confirmado',
      fimForcado: '2026-12-06T11:00:00Z',
    });
    const repetido = await reservaAntiga({
      prof: ids.p2,
      inicio: '2026-12-07T10:00:00Z',
      duracoes: [30, 30],
      servicos: [ids.servicos[0], ids.servicos[0]],
      status: 'confirmado',
    });
    const longo = await reservaAntiga({ prof: ids.p2, inicio: '2026-12-08T10:00:00Z', duracoes: [1500], status: 'cancelado' });
    const catalogoAntes = await catalogo();
    const dadosAntes = await linhas('SELECT * FROM reserva_item ORDER BY id');

    liberarMigracaoNova();
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain(
      'D-050: migração abortada sem alterar nada: 1 reserva(s) sem itens, 1 com fim <> inicio + soma das durações, ' +
        '1 com serviço repetido, 1 item(ns) com mais de 1440 min',
    );
    // Nada aplicado: catálogo e dados idênticos; a migração consta como falha (P3009 no próximo deploy).
    expect(await catalogo()).toEqual(catalogoAntes);
    expect(await linhas('SELECT * FROM reserva_item ORDER BY id')).toEqual(dadosAntes);
    expect(
      await linhas<{ ok: boolean }>(
        'SELECT finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE migration_name = $1',
        [MIGRACAO],
      ),
    ).toEqual([{ ok: false }]);
    const bloqueado = deploy();
    expect(bloqueado.status).not.toBe(0);
    expect(bloqueado.stdout + bloqueado.stderr).toContain('P3009');

    // Procedimento documentado: corrigir os dados (aqui, apagar as linhas de teste) e marcar como revertida.
    await c.query('DELETE FROM reserva_item WHERE reserva_id = ANY($1)', [[fimErrado, repetido, longo]]);
    await c.query('DELETE FROM reserva WHERE id = ANY($1)', [[semItens, fimErrado, repetido, longo]]);
    const resolve = executarPrisma(['migrate', 'resolve', '--rolled-back', MIGRACAO, '--config', config], urlDoWorker());
    expect(resolve.status).toBe(0);
  }, 120_000);

  it('CA-46 (RN-39): aplicada, cada item herda profissional/status/encaixe/revisão, fica em sequência pela ordem e a união das ocupações não muda', async () => {
    const r = deploy();
    expect(r.status, r.stderr + r.stdout).toBe(0);

    expect(await contagens()).toEqual(antes.contagens);
    expect(await uniaoNova()).toEqual(antes.uniao);

    const itens = await linhas<{
      reserva_id: string;
      ordem: number;
      duracao_min: number;
      profissional_id: string;
      status: string;
      encaixe: boolean;
      revisao: number;
      inicio: Date;
      fim: Date;
      ocupado_ate: Date;
      reserva_item_id: null;
    }>(`SELECT * FROM reserva_item ORDER BY reserva_id, ordem`);
    const reservasAntes = new Map(
      (antes.reservas as { id: string; profissional_id: string; status: string; encaixe: boolean; revisao: number; inicio: Date; ocupado_ate: Date }[]).map(
        (x) => [x.id, x],
      ),
    );
    const porReserva = new Map<string, typeof itens>();
    for (const i of itens) porReserva.set(i.reserva_id, [...(porReserva.get(i.reserva_id) ?? []), i]);
    expect(porReserva.size).toBe(6);
    for (const [reservaId, lista] of porReserva) {
      const r0 = reservasAntes.get(reservaId)!;
      let cursor = r0.inicio.getTime();
      lista.forEach((i, k) => {
        expect(i).toMatchObject({ profissional_id: r0.profissional_id, status: r0.status, encaixe: r0.encaixe, revisao: r0.revisao });
        expect(i.inicio.getTime()).toBe(cursor);
        expect(i.fim.getTime()).toBe(cursor + i.duracao_min * 60_000);
        const ultimo = k === lista.length - 1;
        expect(i.ocupado_ate.getTime()).toBe(ultimo ? r0.ocupado_ate.getTime() : i.fim.getTime());
        cursor = i.fim.getTime();
      });
    }
    // Lacunas de ordem (R5: 2, 5, 9): o primeiro é o de ordem 2 (30 min), não o de menor duração.
    const r5 = porReserva.get(ids.r.r5)!;
    expect(r5.map((i) => [i.ordem, i.duracao_min, i.inicio.toISOString()])).toEqual([
      [2, 30, '2026-11-21T09:00:00.000Z'],
      [5, 50, '2026-11-21T09:30:00.000Z'],
      [9, 40, '2026-11-21T10:20:00.000Z'],
    ]);

    // A reserva conserva o que fica (status derivado = o antigo; envelope = o antigo; revisão; cancelada_em).
    const depois = await linhas<Record<string, unknown>>('SELECT * FROM reserva ORDER BY id');
    expect(depois).toEqual(
      (antes.reservas as Record<string, unknown>[]).map((linha) =>
        Object.fromEntries(Object.entries(linha).filter(([k]) => !['profissional_id', 'ocupado_ate', 'encaixe'].includes(k))),
      ),
    );
  }, 120_000);

  it('CA-46: a constraint nova recusa uma sobreposição nova (também contra um item migrado do meio de uma reserva)', async () => {
    const reserva = await uuid(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
       VALUES ($1, $2, '2026-12-01T13:40:00Z', '2026-12-01T14:10:00Z', 'confirmado', 'equipe') RETURNING id`,
      [ids.salao, ids.cliente],
    );
    const inserir = (prof: string, inicio: string) =>
      c.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                   inicio, fim, ocupado_ate, status)
         VALUES ($1, $2, $3, $4, 0, 0, 30, $5::timestamptz, $5::timestamptz + interval '30 minutes',
                 $5::timestamptz + interval '30 minutes', 'confirmado')`,
        [ids.salao, reserva, ids.servicos[0], prof, inicio],
      );
    // R2 de P1: 13:00–13:30, 13:30–14:10, 14:10–15:00 (+10). 13:40 cai no 2º item.
    expect(await erroSql(inserir(ids.p1, '2026-12-01T13:40:00Z'))).toEqual({
      code: '23P01',
      constraint: 'reserva_item_sem_sobreposicao',
    });
    // R3 de P2 está cancelada: o mesmo horário é aceito.
    await inserir(ids.p2, '2026-12-01T13:40:00Z');
    // Limpeza: o retrato de CA-48 compara com os dados de antes da migração.
    await c.query('DELETE FROM reserva_item WHERE reserva_id = $1', [reserva]);
    await c.query('DELETE FROM reserva WHERE id = $1', [reserva]);
  });

  it('CA-49: mensagens antigas ficam sem item, no mesmo estado, e com a mesma vigência (exceto a confirmação de reserva remarcada, R-4)', async () => {
    const r = await linhas<{ id: string; estado: string; item: string | null }>(
      'SELECT id::text AS id, estado::text AS estado, reserva_item_id AS item FROM mensagem ORDER BY id',
    );
    expect(r.every((m) => m.item === null)).toBe(true);
    expect(r.find((m) => m.id === ids.m.r1_conf)?.estado).toBe('pendente');

    const nova = await vigencias(VIGENCIA_NOVA);
    expect(Object.keys(nova).sort()).toEqual(Object.keys(antes.vigencia).sort());
    const diferentes = Object.keys(nova).filter((id) => nova[id] !== antes.vigencia[id]);
    // R-4 do design (Q14): a confirmação de uma reserva remarcada volta a ser vigente; é a ÚNICA diferença.
    expect(diferentes).toEqual([ids.m.r2_conf]);
    expect(antes.vigencia[ids.m.r2_conf]).toBe(false);
    expect(nova).toMatchObject({
      [ids.m.r1_conf]: true,
      [ids.m.r2_rem1]: false,
      [ids.m.r2_rem2]: true,
      [ids.m.r3_conf]: false,
      [ids.m.r3_rem1]: false,
      [ids.m.r3_canc]: true,
      [ids.m.r4_conf]: false,
      [ids.m.r4_conv]: true,
      [ids.m.r5_conv]: false,
    });
  });

  it('CA-48 (Q15): a reversão aborta sem alterar nada se houver reserva não representável no modelo antigo', async () => {
    const reserva = await uuid(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
       VALUES ($1, $2, '2026-12-10T10:00:00Z', '2026-12-10T11:10:00Z', 'confirmado', 'equipe') RETURNING id`,
      [ids.salao, ids.cliente],
    );
    // Dois profissionais na mesma reserva: só existe no modelo novo.
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       VALUES ($1, $2, $3, $4, 0, 0, 30, '2026-12-10T10:00:00Z', '2026-12-10T10:30:00Z', '2026-12-10T10:30:00Z', 'confirmado'),
              ($1, $2, $5, $6, 1, 0, 40, '2026-12-10T10:30:00Z', '2026-12-10T11:10:00Z', '2026-12-10T11:10:00Z', 'confirmado')`,
      [ids.salao, reserva, ids.servicos[0], ids.p1, ids.servicos[1], ids.p2],
    );
    const catalogoNovo = await catalogo();
    const erro = (await erroSql(c.query(extrairReversao(SQL_MIGRACAO)))) as { code: string };
    await c.query('ROLLBACK');
    expect(erro.code).toBe('23514');
    expect(await catalogo()).toEqual(catalogoNovo);
    expect(
      await linhas<{ n: number }>('SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL', [
        MIGRACAO,
      ]),
    ).toEqual([{ n: 1 }]);
    await c.query('DELETE FROM reserva_item WHERE reserva_id = $1', [reserva]);
    await c.query('DELETE FROM reserva WHERE id = $1', [reserva]);
  });

  it('CA-48: a reversão do cabeçalho devolve o esquema anterior com os dados equivalentes, e a migração reaplica', async () => {
    // Um item remarcado por UPDATE no modelo novo, ainda representável (mesmo profissional, contíguo).
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao, estado)
       SELECT salao_id, reserva_id, id, 'remarcacao', 3, 'enviada' FROM reserva_item WHERE reserva_id = $1`,
      [ids.r.r1],
    );
    const mensagens = (await contagens()).mensagens;

    await c.query(extrairReversao(SQL_MIGRACAO));

    expect(await catalogo()).toEqual(antes.catalogo);
    expect(await linhas('SELECT * FROM reserva ORDER BY id')).toEqual(antes.reservas);
    expect(await linhas('SELECT * FROM reserva_item ORDER BY id')).toEqual(antes.itens);
    expect(await uniaoAntiga()).toEqual(antes.uniao);
    expect((await contagens()).mensagens).toBe(mensagens);
    expect(
      await linhas('SELECT 1 FROM _prisma_migrations WHERE migration_name = $1', [MIGRACAO]),
    ).toEqual([]);

    // Ida e volta: a mesma migração aplica de novo sobre os dados revertidos.
    const r = deploy();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(await uniaoNova()).toEqual(antes.uniao);
  }, 120_000);
});
