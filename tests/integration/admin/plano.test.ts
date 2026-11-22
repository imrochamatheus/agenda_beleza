import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';
import { consultaDaAuditoria } from '@/server/repos/auditoria';
import type { FiltrosAuditoriaRepo } from '@/server/repos/auditoria';
import { consultaDaFila } from '@/server/repos/admin-mensagens';
import type { FiltrosFila } from '@/server/repos/admin-mensagens';
import { obterPrisma } from '@/server/repos/db';

import { adminDeTeste } from '../../support/admin-saloes';
import { criarCenarioMensagem } from '../../support/mensagens';
import type { CenarioMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// D-045 CA-15: plano e tempo das listas globais com volume (≈100 mil mensagens e 200 mil auditorias), no
// PostgreSQL real, usando EXATAMENTE a instrução do repositório (`consulta…`). Sem migração (parecer do DBA):
// o limiar é o do parecer (200 ms; aqui 300 ms de folga para máquina de CI). Imprime `[CA-15]`.
const LIMIAR_MS = 300;
let c: pg.Client;
const cen: CenarioMensagem[] = [];
let adminId: string;

beforeAll(async () => {
  c = await conectar();
  adminId = (await adminDeTeste()).usuarioId;
  for (let i = 0; i < 3; i++) cen.push(await criarCenarioMensagem());
  for (const s of cen) {
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, destinatario_e164, criado_em, atualizado_em)
       SELECT $1, $2, t.tipo, g,
              (ARRAY['enviada','enviada','enviada','pendente','falhou','nao_enviada','substituida'])[1 + (g % 7)]::estado_mensagem,
              $3, now() - ((g * 4 + t.ord) * interval '7 seconds'), now()
         FROM unnest(ARRAY['confirmacao','remarcacao','cancelamento','convite_avaliacao']::tipo_mensagem[]) WITH ORDINALITY t(tipo, ord)
        CROSS JOIN generate_series(0, 8333) g`,
      [s.salaoId, s.reservaId, s.telefone],
    );
  }
  await c.query(
    `INSERT INTO auditoria (ator_id, ator_email_informado, acao, entidade, entidade_id, salao_id, resultado, ocorrido_em)
     SELECT CASE WHEN g % 10 = 0 THEN NULL ELSE $1::uuid END,
            CASE WHEN g % 10 = 0 THEN 'x' || (g % 50) || '@exemplo.com.br' END,
            (ARRAY['salao.suspender','salao.reativar','salao.atualizar','login.sucesso','login.falha_senha','mensagem.reenviar'])[1 + (g % 6)],
            'salao', 'x',
            CASE WHEN g % 3 = 0 THEN NULL ELSE (ARRAY[$2, $3, $4])[1 + (g % 3)]::uuid END,
            'sucesso', now() - (g * interval '157 seconds')
       FROM generate_series(1, 200000) g`,
    [adminId, cen[0].salaoId, cen[1].salaoId, cen[2].salaoId],
  );
  await c.query('ANALYZE mensagem');
  await c.query('ANALYZE auditoria');
}, 300_000);
afterAll(async () => {
  await c?.end();
});

async function plano(sql: Prisma.Sql): Promise<{ ms: number; texto: string }> {
  const r = await obterPrisma().$queryRaw<{ 'QUERY PLAN': { 'Execution Time': number }[] }[]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  const json = r[0]['QUERY PLAN'];
  return { ms: json[0]['Execution Time'], texto: JSON.stringify(json) };
}

const SEM = { estado: null, tipo: null, salaoId: null } satisfies FiltrosFila;

describe('CA-15: fila de mensagens com ~100 mil linhas', () => {
  it('contagem do volume', async () => {
    const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM mensagem');
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(100_000);
  });

  it.each<[string, FiltrosFila, number]>([
    ['sem filtro, p1', SEM, 0],
    ['estado=falhou, p1', { ...SEM, estado: 'falhou' }, 0],
    ['tipo=cancelamento + estado=enviada, p500', { ...SEM, tipo: 'cancelamento', estado: 'enviada' }, 9980],
    ['salão, p1', { ...SEM, salaoId: '__SALAO0__' }, 0],
  ])('%s: tempo abaixo do limiar, sem janela sobre o JOIN, uma instrução', async (nome, f, off) => {
    const filtros = f.salaoId === '__SALAO0__' ? { ...f, salaoId: cen[0].salaoId } : f;
    const { ms, texto } = await plano(consultaDaFila(filtros, off));
    console.info(`[CA-15] fila ${nome}: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(LIMIAR_MS);
    expect(texto).not.toContain('WindowAgg');
  });
});

const SEMA: FiltrosAuditoriaRepo = { salaoId: null, ator: null, acao: null, resultado: null, de: null, ate: null };

describe('CA-15: auditoria com ~200 mil linhas', () => {
  it.each<[string, FiltrosAuditoriaRepo, number, boolean]>([
    ['sem filtro, p1', SEMA, 0, false],
    ['dia civil', { ...SEMA, de: new Date(Date.now() - 20 * 86_400_000), ate: new Date(Date.now() - 19 * 86_400_000) }, 0, true],
    ['salão', { ...SEMA, salaoId: '__SALAO0__' }, 0, false],
    ['ação, p500', { ...SEMA, acao: 'salao.suspender' }, 9980, false],
    ['ator por e-mail', { ...SEMA, ator: 'x7@exemplo.com.br' }, 0, false],
    ['ação + 7 dias', { ...SEMA, acao: 'salao.atualizar', de: new Date(Date.now() - 7 * 86_400_000) }, 0, true],
  ])('%s: tempo abaixo do limiar', async (nome, f, off, esperaIndice) => {
    const filtros = f.salaoId === '__SALAO0__' ? { ...f, salaoId: cen[0].salaoId } : f;
    const { ms, texto } = await plano(consultaDaAuditoria(filtros, off));
    console.info(`[CA-15] auditoria ${nome}: ${ms.toFixed(1)} ms${texto.includes('auditoria_ocorrido_em_idx') ? ' (índice ocorrido_em)' : ''}`);
    expect(ms).toBeLessThan(LIMIAR_MS);
    if (esperaIndice) expect(texto).toContain('auditoria_ocorrido_em_idx');
  });
});
