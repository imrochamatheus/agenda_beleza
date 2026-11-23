import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';
import { conferirVigencia } from '@/server/mensagens/elegibilidade';
import type { TipoMensagem } from '@/server/mensagens/tipos';
import { obterPrisma } from '@/server/repos/db';
import { PREDICADO_VIGENTE } from '@/server/repos/mensagem';
import type { StatusReserva } from '@/server/repos/tipos';

import { criarCenarioMensagem } from '../../support/mensagens';
import type { CenarioMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// D-050 T-4 (§3.7, dba.md M-4): paridade entre PREDICADO_VIGENTE (SQL, fonte única) e conferirVigencia
// (pura, usada no envio e no reenvio), por enumeração exaustiva: 4 status da reserva × listas de 0, 1 e 2
// itens (revisão 0..2 × 4 status) × 4 tipos × revisão da mensagem 0..2.

const STATUS: StatusReserva[] = ['confirmado', 'cancelado', 'concluido', 'nao_compareceu'];
const TIPOS: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
const REVISOES = [0, 1, 2];
type ItemCfg = { revisao: number; status: StatusReserva };

const OPCOES: ItemCfg[] = REVISOES.flatMap((revisao) => STATUS.map((status) => ({ revisao, status })));
const LISTAS: ItemCfg[][] = [
  [],
  ...OPCOES.map((a) => [a]),
  ...OPCOES.flatMap((a, i) => OPCOES.slice(i).map((b) => [a, b])),
];

let c: pg.Client;
let s: CenarioMensagem;
let servico3: string;

beforeAll(async () => {
  c = await conectar();
  s = await criarCenarioMensagem();
  servico3 = (
    await c.query<{ id: string }>(
      "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, 'Terceiro', 5000, 30) RETURNING id::text AS id",
      [s.salaoId],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await c.end();
});

describe('PREDICADO_VIGENTE × conferirVigencia (paridade obrigatória, M-4)', () => {
  it('mesmo veredito em todas as combinações; cada tipo tem casos vigentes e obsoletos', async () => {
    const DIA = 86_400_000;
    const base = Date.UTC(2031, 0, 1, 12);
    const reservas: { chave: string; status: StatusReserva; itens: ItemCfg[]; dia: number }[] = [];
    let dia = 0;
    for (const lista of LISTAS) {
      for (const status of STATUS) {
        reservas.push({ chave: `par-${dia}`, status, itens: lista, dia });
        dia += 1;
      }
    }
    const inicio = (r: { dia: number }) => new Date(base + r.dia * DIA);
    const ins = await c.query<{ id: string; chave: string }>(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, chave_requisicao)
       SELECT $1, $2, x.inicio, x.inicio + interval '2 hours', x.status::status_reserva, 'equipe', x.chave
         FROM unnest($3::timestamptz[], $4::text[], $5::text[]) AS x(inicio, status, chave)
       RETURNING id::text AS id, chave_requisicao AS chave`,
      [s.salaoId, s.clienteId, reservas.map(inicio), reservas.map((r) => r.status), reservas.map((r) => r.chave)],
    );
    const idDa = new Map(ins.rows.map((l) => [l.chave, l.id]));
    const servicos = [s.servicoIds[0], s.servicoIds[1] ?? servico3];
    const itens = reservas.flatMap((r) =>
      r.itens.map((it, ordem) => ({
        reservaId: idDa.get(r.chave)!,
        servicoId: servicos[ordem],
        ordem,
        inicio: new Date(inicio(r).getTime() + ordem * 3_600_000),
        ...it,
      })),
    );
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate,
                                 status, revisao, preco_centavos, duracao_min)
       SELECT $1, x.reserva_id, x.servico_id, $2, x.ordem, x.inicio, x.inicio + interval '30 minutes',
              x.inicio + interval '30 minutes', x.status::status_reserva, x.revisao, 5000, 30
         FROM unnest($3::uuid[], $4::uuid[], $5::int[], $6::timestamptz[], $7::text[], $8::int[])
              AS x(reserva_id, servico_id, ordem, inicio, status, revisao)`,
      [
        s.salaoId,
        s.profissionalId,
        itens.map((i) => i.reservaId),
        itens.map((i) => i.servicoId),
        itens.map((i) => i.ordem),
        itens.map((i) => i.inicio),
        itens.map((i) => i.status),
        itens.map((i) => i.revisao),
      ],
    );
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado)
       SELECT r.salao_id, r.id, t.tipo::tipo_mensagem, g.rev, 'enviada'
         FROM reserva r CROSS JOIN unnest($2::text[]) AS t(tipo) CROSS JOIN generate_series(0, 2) AS g(rev)
        WHERE r.salao_id = $1 AND r.chave_requisicao LIKE 'par-%'`,
      [s.salaoId, TIPOS],
    );

    const linhas = await obterPrisma().$queryRaw<{ chave: string; tipo: TipoMensagem; revisao: number; vigente: boolean }[]>(
      Prisma.sql`SELECT r.chave_requisicao AS chave, m.tipo::text AS tipo, m.revisao, ${PREDICADO_VIGENTE} AS vigente
                   FROM mensagem m
                   JOIN reserva r ON r.salao_id = m.salao_id AND r.id = m.reserva_id
                  WHERE m.salao_id = ${s.salaoId}::uuid AND r.chave_requisicao LIKE 'par-%'`,
    );
    expect(linhas).toHaveLength(reservas.length * TIPOS.length * REVISOES.length);
    const porChave = new Map(reservas.map((r) => [r.chave, r]));
    const divergencias: string[] = [];
    const contagem = new Map<string, number>();
    for (const l of linhas) {
      const r = porChave.get(l.chave)!;
      const pura = conferirVigencia(l.tipo, { revisao: l.revisao }, { status: r.status, itens: r.itens }) === 'vigente';
      contagem.set(`${l.tipo}:${pura}`, (contagem.get(`${l.tipo}:${pura}`) ?? 0) + 1);
      if (pura !== l.vigente) divergencias.push(`${l.tipo} m.rev=${l.revisao} r=${JSON.stringify(r)} sql=${l.vigente} pura=${pura}`);
    }
    expect(divergencias).toEqual([]);
    for (const tipo of TIPOS) {
      expect(contagem.get(`${tipo}:true`), `${tipo} vigente`).toBeGreaterThan(0);
      expect(contagem.get(`${tipo}:false`), `${tipo} obsoleta`).toBeGreaterThan(0);
    }
  });
});

describe('PREDICADO_VIGENTE: fonte única e literais (M-4, §4.5)', () => {
  it('tipos, status e aliases fixos são literais no texto; nenhum parâmetro', () => {
    expect(PREDICADO_VIGENTE.values).toEqual([]);
    const sql = PREDICADO_VIGENTE.sql;
    for (const literal of ["m.tipo = 'confirmacao'", "r.status = 'confirmado'", "m.tipo = 'convite_avaliacao'", "r.status = 'concluido'",
      "m.tipo = 'remarcacao'", "vi.status = 'confirmado'", "m.tipo = 'cancelamento'", "vi.status = 'cancelado'"]) {
      expect(sql).toContain(literal);
    }
    expect(sql).not.toContain('reserva_item_id');
  });

  it('o predicado de vigência por item não é copiado em outro arquivo de src (T-7 importa o fragmento)', () => {
    const achados: string[] = [];
    const visitar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) {
          if (nome !== 'generated') visitar(caminho);
        } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && readFileSync(caminho, 'utf8').includes('vi.revisao = m.revisao')) {
          achados.push(caminho.replace(/\\/g, '/'));
        }
      }
    };
    visitar('src');
    expect(achados).toEqual(['src/server/repos/mensagem.ts']);
  });
});
