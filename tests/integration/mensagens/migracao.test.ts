import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NaoImplementado } from '@/server/integrations/nao-implementado';
import { MODELOS_WHATSAPP, validarEnvioModelo } from '@/server/integrations/whatsapp/port';
import { criarWhatsAppReal } from '@/server/integrations/whatsapp/real';
import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';

import { conectar, telefoneNovo } from '../../support/sql';

// D-024 T-7: CA-23 (porta × enum do banco) e CA-24 (a consulta do repositório usa o índice parcial).
// O esquema em si (migrações, drift) é do DBA: tests/integration/db/mensagem-reconciliacao.test.ts.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

describe('CA-23: MODELOS_WHATSAPP é o enum tipo_mensagem do banco', () => {
  it('mesmos valores, na mesma ordem do enum', async () => {
    const r = await c.query<{ v: string }>(
      "SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'tipo_mensagem' ORDER BY e.enumsortorder",
    );
    expect(r.rows.map((x) => x.v)).toEqual([...MODELOS_WHATSAPP]);
    expect(MODELOS_WHATSAPP).toContain('convite_avaliacao');
  });

  it('validarEnvioModelo aceita o 4º modelo e o simulado o envia e registra', async () => {
    const envio = { destinatarioE164: telefoneNovo(), modelo: 'convite_avaliacao' as const, parametros: { salao: 'S', link: 'https://x.test/a' }, chaveIdempotencia: `r:convite_avaliacao:0:${Date.now()}` };
    expect(validarEnvioModelo(envio)).toBeNull();
    const sim = criarWhatsAppSimulado();
    const r = await sim.enviarModelo(envio);
    expect(r.provedorMensagemId).toMatch(/^wamid\.SIM\./);
    const [chamada] = await sim.listarChamadas({ chaveIdempotencia: envio.chaveIdempotencia });
    expect(chamada).toMatchObject({ modelo: 'convite_avaliacao', resultado: 'sucesso' });
  });

  it('o adaptador real continua NaoImplementado(E7.2) para o 4º modelo', async () => {
    const real = criarWhatsAppReal();
    await expect(real.enviarModelo({ destinatarioE164: telefoneNovo(), modelo: 'convite_avaliacao', parametros: {}, chaveIdempotencia: 'k' })).rejects.toBeInstanceOf(NaoImplementado);
  });
});

describe('CA-24: a reconciliação usa o índice parcial (consultas com literais)', () => {
  it('pendentes e enviando antigas: Index Scan em mensagem_reconciliacao_idx, sem Seq Scan nem Sort, com volume', async () => {
    const salao = (await c.query<{ id: string }>("INSERT INTO salao (nome) VALUES ('Volume') RETURNING id")).rows[0].id;
    const prof = (await c.query<{ id: string }>('INSERT INTO profissional (salao_id, nome) VALUES ($1, $2) RETURNING id', [salao, 'P'])).rows[0].id;
    const cli = (await c.query<{ id: string }>('INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id', [salao, 'C', telefoneNovo()])).rows[0].id;
    const reserva = (
      await c.query<{ id: string }>(
        "INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, origem) VALUES ($1, $2, $3, '2031-02-01T13:00:00Z', '2031-02-01T14:00:00Z', '2031-02-01T14:00:00Z', 'equipe') RETURNING id",
        [salao, prof, cli],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, atualizado_em)
       SELECT $1, $2, 'remarcacao', g,
              CASE WHEN g % 100 = 0 THEN 'pendente' WHEN g % 100 = 1 THEN 'enviando' ELSE 'enviada' END::estado_mensagem,
              now() - make_interval(secs => g)
         FROM generate_series(1, 6000) g`,
      [salao, reserva],
    );
    await c.query('ANALYZE mensagem');
    for (const estado of ['pendente', 'enviando']) {
      // O mesmo formato das consultas de repos/mensagem-sistema.ts: literal no estado, nunca parâmetro.
      const r = await c.query<Record<string, string>>(
        `EXPLAIN SELECT id, salao_id, reserva_id, tipo, revisao FROM mensagem
          WHERE estado = '${estado}' AND atualizado_em < now() - interval '5 minutes'
          ORDER BY atualizado_em, id LIMIT 100`,
      );
      const plano = r.rows.map((x) => x['QUERY PLAN']).join('\n');
      expect(plano).toContain('mensagem_reconciliacao_idx');
      expect(plano).not.toMatch(/Seq Scan/);
    }
  });
});
