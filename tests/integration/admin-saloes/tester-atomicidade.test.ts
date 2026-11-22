import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { editarSalao, estenderTeste, reativarSalao, suspenderSalao } from '@/server/admin/saloes';
import { encerrarPrisma } from '@/server/repos/db';

import { DEPS, DIA_MS, adminDeTeste, assinaturaNoBanco, entradaIgual, salaoComAssinatura, salaoEmTeste, salaoNoBanco, sessoesAtivas, usuarioNoBanco } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { conectar } from '../../support/sql';
import { lerSalao } from '@/server/admin/saloes';

// Teste independente do tester (D-044): falha da auditoria dentro da transação REVERTE a mutação.
// A falha é injetada por um gatilho de banco que recusa gravar a auditoria de sucesso de uma ação.
let c: pg.Client;
let adm: AdminDeTeste;
const AGORA = new Date('2027-05-10T12:00:00Z');

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
  await c.query(`
    CREATE TABLE IF NOT EXISTS tester_alvo (salao_id text);
    CREATE OR REPLACE FUNCTION tester_recusa_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.resultado = 'sucesso' AND EXISTS (SELECT 1 FROM tester_alvo t WHERE t.salao_id = NEW.salao_id::text) THEN
        RAISE EXCEPTION 'auditoria recusada (teste)';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS tester_recusa ON auditoria;
    CREATE TRIGGER tester_recusa BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION tester_recusa_auditoria();`);
});
afterAll(async () => {
  await c.query('DROP TRIGGER IF EXISTS tester_recusa ON auditoria');
  await c.end();
  await encerrarPrisma();
});

async function recusarPara(salaoId: string | null) {
  await c.query('DELETE FROM tester_alvo');
  if (salaoId !== null) await c.query('INSERT INTO tester_alvo VALUES ($1)', [salaoId]);
}

describe('atomicidade com a auditoria', () => {
  it('suspender: a auditoria falha, o salão continua não suspenso', async () => {
    const s = await salaoComAssinatura('ativa');
    await recusarPara(s.salaoId);
    try {
      await expect(suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'motivo valido', etapa: 'confirmar' }, AGORA)).rejects.toThrow();
    } finally {
      await recusarPara(null);
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
  });

  it('reativar: a auditoria falha, o salão continua suspenso', async () => {
    const s = await salaoComAssinatura('ativa');
    expect((await suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'motivo valido', etapa: 'confirmar' }, AGORA)).resultado).toBe('suspenso');
    await recusarPara(s.salaoId);
    try {
      await expect(reativarSalao(adm.ctx, { salaoId: s.salaoId }, AGORA)).rejects.toThrow();
    } finally {
      await recusarPara(null);
    }
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).not.toBeNull();
  });

  it('editar (nome, slug, regras, e-mail do gestor): a auditoria falha e NADA muda (nem sessões, nem e-mail, nem slug)', async () => {
    const s = await salaoComAssinatura(null);
    const d = await lerSalao(adm.ctx, s.salaoId);
    const antesSalao = await salaoNoBanco(c, s.salaoId);
    const antesGestor = await usuarioNoBanco(c, s.gestor.usuarioId);
    const sessoes = await sessoesAtivas(c, s.gestor.usuarioId);
    const slugsAntes = (await c.query(`SELECT slug, atual FROM salao_slug WHERE salao_id = $1 ORDER BY slug`, [s.salaoId])).rows;
    await recusarPara(s.salaoId);
    try {
      await expect(
        editarSalao(adm.ctx, entradaIgual(d, { nome: 'Outro nome atomico', slug: `${d.slug}-novo`, grade: '30', gestorEmail: `novo-${Date.now()}@exemplo.com.br` }), AGORA, DEPS),
      ).rejects.toThrow();
    } finally {
      await recusarPara(null);
    }
    expect(await salaoNoBanco(c, s.salaoId)).toEqual(antesSalao);
    expect(await usuarioNoBanco(c, s.gestor.usuarioId)).toEqual(antesGestor);
    expect(await sessoesAtivas(c, s.gestor.usuarioId)).toBe(sessoes);
    const slugs = await c.query(`SELECT slug, atual FROM salao_slug WHERE salao_id = $1 ORDER BY slug`, [s.salaoId]);
    expect(slugs.rows).toEqual(slugsAntes);
  });

  it('estender: a auditoria de sucesso falha depois do provedor: teste_fim_em intacto', async () => {
    const s = await salaoEmTeste();
    const D = s.fim!;
    await recusarPara(s.salaoId);
    try {
      await expect(
        estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '5', testeFimEmEsperado: D.toISOString(), etapa: 'confirmar' }, new Date(), DEPS),
      ).rejects.toThrow();
    } finally {
      await recusarPara(null);
    }
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(D);
    expect(D.getTime() + 5 * DIA_MS).toBeGreaterThan(D.getTime());
    expect(await linhasDeAuditoria(c, `salao_id = $1 AND resultado = 'sucesso'`, [s.salaoId])).toHaveLength(0);
  });
});
