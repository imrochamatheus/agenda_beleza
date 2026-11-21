import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JsonObjeto } from '@/server/auditoria/tipos';
import { ErroAuditoriaEntrada, ErroAuditoriaSegredo } from '@/server/auditoria/tipos';
import { registrarAuditoria, registrarFalhaAuditoria } from '@/server/auditoria/registrar';
import type { Repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { criarAdminContext, criarTenantContext } from '@/server/tenant/context';

import { contarAuditoria, criarSuperAdmin, linhasDeAuditoria } from '../../support/auditoria';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, erroSql } from '../../support/sql';

// D-033 T-3: auditoria contra PostgreSQL real. A tabela é somente inserção: cada teste usa
// entidade_id próprio e nunca assume contagem global.

let c: pg.Client;
let s: SalaoCompleto;
let admin: Awaited<ReturnType<typeof criarSuperAdmin>>;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  admin = await criarSuperAdmin(c);
});
afterAll(async () => {
  await c.end();
});

const nomeDoSalao = async (id: string) =>
  (await c.query<{ nome: string }>('SELECT nome FROM salao WHERE id = $1', [id])).rows[0].nome;

const ctxDe = (salaoId: string) =>
  criarTenantContext({ usuarioId: s.gestor.usuarioId, papel: 'gestor', salaoId, profissionalId: null });

/** A mutação de negócio usada nos testes: renomeia o salão pelo repositório, na transação `r`. */
async function renomear(r: Repos, salaoId: string, nome: string): Promise<void> {
  const ctx = ctxDe(salaoId);
  await r.saloes.travar(ctx);
  await r.saloes.atualizarConfiguracoes(ctx, { ...(await r.saloes.obterConfiguracoes(ctx)), nome });
}

describe('CA-1: sucesso na mesma transação', () => {
  it('grava ator, ação, entidade, salão, antes/depois, resultado e data UTC', async () => {
    const t0 = Date.now() - 5000;
    const { salaoId } = await criarSalaoCompleto({ salao: { nome: 'A' } });
    const { id } = await emTransacao(async (r) => {
      await renomear(r, salaoId, 'B');
      return registrarAuditoria(admin.ctx, {
        acao: 'salao.renomear', entidade: 'salao', entidadeId: salaoId, salaoId,
        antes: { nome: 'A' }, depois: { nome: 'B' },
      }, r);
    });
    const [l] = await linhasDeAuditoria(c, 'id = $1', [id]);
    expect(l).toMatchObject({
      ator_id: admin.usuarioId, acao: 'salao.renomear', entidade: 'salao', entidade_id: salaoId,
      salao_id: salaoId, antes: { nome: 'A' }, depois: { nome: 'B' }, resultado: 'sucesso',
      ator_email_informado: null,
    });
    expect(await nomeDoSalao(salaoId)).toBe('B');
    expect(l.ocorrido_em.getTime()).toBeGreaterThan(t0);
    expect(l.ocorrido_em.getTime()).toBeLessThan(Date.now() + 5000);
  });
});

describe('CA-2: falha na gravação desfaz a mutação', () => {
  async function mutarEAuditar(salaoId: string, extra: Record<string, unknown>, nome: string) {
    return emTransacao(async (r) => {
      await renomear(r, s.salaoId, nome);
      return registrarAuditoria(admin.ctx, {
        acao: 'salao.renomear', entidade: 'salao', entidadeId: s.salaoId, salaoId,
        antes: { nome: 'x' }, depois: { nome }, ...extra,
      }, r);
    });
  }

  it('FK 23503 (salaoId inexistente): a mutação não persiste e não há linha', async () => {
    const original = await nomeDoSalao(s.salaoId);
    const inexistente = randomUUID();
    await expect(mutarEAuditar(inexistente, {}, 'Mudou-FK')).rejects.toThrow();
    expect(await nomeDoSalao(s.salaoId)).toBe(original);
    expect(await linhasDeAuditoria(c, 'salao_id = $1', [inexistente])).toEqual([]);
  });

  it('depois acima de 16 KiB e chave proibida: mutação revertida, nada gravado', async () => {
    const original = await nomeDoSalao(s.salaoId);
    const antes = await contarAuditoria(c);
    await expect(mutarEAuditar(s.salaoId, { depois: { t: 'a'.repeat(17000) } }, 'Mudou-grande')).rejects.toBeInstanceOf(ErroAuditoriaEntrada);
    await expect(mutarEAuditar(s.salaoId, { depois: { totpSecret: 'VALOR' } }, 'Mudou-segredo')).rejects.toBeInstanceOf(ErroAuditoriaSegredo);
    expect(await nomeDoSalao(s.salaoId)).toBe(original);
    expect(await contarAuditoria(c)).toBe(antes);
  });
});

describe('CA-3: somente inserção no banco', () => {
  it('UPDATE, DELETE e TRUNCATE diretos são rejeitados com P0001 e a contagem não muda', async () => {
    const { id } = await emTransacao((r) =>
      registrarAuditoria(admin.ctx, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: randomUUID(), antes: { ocultaEm: null }, depois: { ocultaEm: '2026-01-01T00:00:00Z' } }, r),
    );
    const n = await contarAuditoria(c);
    for (const sql of [`UPDATE auditoria SET acao = 'x' WHERE id = '${id}'`, `DELETE FROM auditoria WHERE id = '${id}'`, 'TRUNCATE auditoria']) {
      expect((await erroSql(c.query(sql))).code).toBe('P0001');
    }
    expect(await contarAuditoria(c)).toBe(n);
  });
});

describe('CA-4: falha persiste após rollback da principal', () => {
  it('chamada dentro da transação que depois sofre rollback', async () => {
    const entidadeId = randomUUID();
    await expect(
      emTransacao(async () => {
        await registrarFalhaAuditoria({ acao: 'login.falha_totp', entidade: 'usuario', entidadeId, atorId: admin.usuarioId });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const ls = await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId]);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ resultado: 'falha', ator_id: admin.usuarioId, acao: 'login.falha_totp' });
  });

  it('chamada no catch, depois do rollback (mutação revertida)', async () => {
    const entidadeId = randomUUID();
    const original = await nomeDoSalao(s.salaoId);
    try {
      await emTransacao(async (r) => {
        await renomear(r, s.salaoId, 'Mudou-catch');
        throw new Error('falha de negócio');
      });
    } catch {
      await registrarFalhaAuditoria({ acao: 'login.falha_senha', entidade: 'usuario', entidadeId, salaoId: s.salaoId });
    }
    expect(await nomeDoSalao(s.salaoId)).toBe(original);
    const ls = await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId]);
    expect(ls).toMatchObject([{ resultado: 'falha', salao_id: s.salaoId }]);
  });
});

describe('CA-5: segredos', () => {
  it('chave proibida recusa sem gravar e sem vazar o valor', async () => {
    const entidadeId = randomUUID();
    const valor = 'SEGREDO-NAO-VAZAR';
    for (const depois of [{ senha: valor } as JsonObjeto, { a: [{ tokenHash: valor }] }, { Authorization: valor }]) {
      const erro = await emTransacao((r) =>
        registrarAuditoria(admin.ctx, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId, antes: {}, depois }, r),
      ).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroAuditoriaSegredo);
      expect((erro as Error).message).not.toContain(valor);
    }
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId])).toEqual([]);
  });

  it('chaves legítimas passam', async () => {
    const entidadeId = randomUUID();
    await emTransacao((r) =>
      registrarAuditoria(admin.ctx, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId, antes: { nome: 'a', slug: 'b' }, depois: { ocultaEm: 'x', motivo: 'y' } }, r),
    );
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId])).toHaveLength(1);
  });
});

describe('CA-6: contexto', () => {
  it('tenant e objeto forjado são recusados e nada é gravado', async () => {
    const entidadeId = randomUUID();
    const e = { acao: 'login.falha_senha', entidade: 'usuario', entidadeId } as const;
    const tenant = criarTenantContext({ usuarioId: s.gestor.usuarioId, papel: 'gestor', salaoId: s.salaoId, profissionalId: null });
    await expect(emTransacao((r) => registrarAuditoria(tenant as never, e, r))).rejects.toThrow('AdminContext');
    await expect(emTransacao((r) => registrarAuditoria({ tipo: 'admin', usuarioId: admin.usuarioId } as never, e, r))).rejects.toThrow('AdminContext');
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId])).toEqual([]);
  });

  it('salaoId de outro salão é aceito (ação de plataforma)', async () => {
    const { a, b } = await criarDoisSaloes();
    const { id } = await emTransacao((r) =>
      registrarAuditoria(criarAdminContext(admin.usuarioId), { acao: 'salao.renomear', entidade: 'salao', entidadeId: a.salaoId, salaoId: b.salaoId, antes: { nome: 'x' }, depois: { nome: 'y' } }, r),
    );
    expect((await linhasDeAuditoria(c, 'id = $1', [id]))[0].salao_id).toBe(b.salaoId);
  });
});

describe('CA-8: retirar seguido de restaurar', () => {
  it('duas linhas na ordem, no mesmo emTransacao', async () => {
    const avaliacaoId = randomUUID();
    await emTransacao(async (r) => {
      await registrarAuditoria(admin.ctx, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: avaliacaoId, salaoId: s.salaoId, antes: { ocultaEm: null }, depois: { ocultaEm: '2026-11-21T10:00:00.000Z' } }, r);
      await registrarAuditoria(admin.ctx, { acao: 'avaliacao.restaurar', entidade: 'avaliacao', entidadeId: avaliacaoId, salaoId: s.salaoId, antes: { ocultaEm: '2026-11-21T10:00:00.000Z' }, depois: { ocultaEm: null } }, r);
    });
    const ls = await linhasDeAuditoria(c, 'entidade_id = $1', [avaliacaoId]);
    expect(ls.map((l) => l.acao)).toEqual(['avaliacao.retirar', 'avaliacao.restaurar']);
    expect(ls[0]).toMatchObject({ ator_id: admin.usuarioId, entidade: 'avaliacao', antes: { ocultaEm: null }, depois: { ocultaEm: '2026-11-21T10:00:00.000Z' } });
    expect(ls[1]).toMatchObject({ antes: { ocultaEm: '2026-11-21T10:00:00.000Z' }, depois: { ocultaEm: null } });
  });
});

describe('CA-9: falha sem ator', () => {
  it('e-mail em minúsculas, ator nulo, resultado falha', async () => {
    const entidadeId = randomUUID();
    await registrarFalhaAuditoria({ acao: 'login.falha_senha', entidade: 'usuario', entidadeId, atorEmailInformado: 'X@Y.com' });
    const ls = await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId]);
    expect(ls).toMatchObject([{ ator_id: null, ator_email_informado: 'x@y.com', resultado: 'falha' }]);
  });

  it('atorId inexistente: a falha de FK propaga', async () => {
    const e = await registrarFalhaAuditoria({ acao: 'login.falha_senha', atorId: randomUUID() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(ErroAuditoriaEntrada);
  });
});

describe('CA-10: concorrência', () => {
  it('20 registros paralelos com mutação FOR NO KEY UPDATE no salão: todos completam', async () => {
    const entidadeId = randomUUID();
    const registros = Array.from({ length: 20 }, (_, i) =>
      emTransacao((r) =>
        registrarAuditoria(admin.ctx, { acao: 'salao.renomear', entidade: 'salao', entidadeId, salaoId: s.salaoId, antes: { i }, depois: { i: i + 1 } }, r),
      ),
    );
    const mutacao = emTransacao(async (r) => {
      await r.saloes.travar(ctxDe(s.salaoId));
      await new Promise((ok) => setTimeout(ok, 100));
    });
    const res = await Promise.allSettled([...registros, mutacao]);
    expect(res.filter((x) => x.status === 'rejected')).toEqual([]);
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [entidadeId])).toHaveLength(20);
  });
});
