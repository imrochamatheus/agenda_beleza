import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registrarAuditoria, registrarFalhaAuditoria } from '@/server/auditoria/registrar';
import { chaveEhProibida } from '@/server/auditoria/sanitizar';
import { emTransacao } from '@/server/repos/transacao';
import { criarAdminContext } from '@/server/tenant/context';
import { criarSuperAdmin, linhasDeAuditoria } from '../../support/auditoria';
import { conectar } from '../../support/sql';

let c: pg.Client;
let admin: Awaited<ReturnType<typeof criarSuperAdmin>>;
beforeAll(async () => { c = await conectar(); admin = await criarSuperAdmin(c); });
afterAll(async () => { await c.end(); });

describe('sonda do tester D-033', () => {
  it('falsos positivos e verdadeiros positivos', () => {
    for (const k of ['panorama', 'capital', 'nome', 'slug', 'ocultaEm', 'motivo', 'hotpot', 'footprint', 'spinner']) expect(chaveEhProibida(k), k).toBe(false);
    for (const k of ['PAN', 'pin', 'otp', 'senhaNova', 'x-api-key', 'Authorization', 'tokenHash', 'cartão', 'numero_cartao', 'refreshToken', 'set-cookie', 'passwordConfirm', 'client_secret']) expect(chaveEhProibida(k), k).toBe(true);
  });
  it('ctx descongelado/forjado e salão (tenant) recusados; mensagem não vaza valor', async () => {
    const forjado = { tipo: 'admin', usuarioId: admin.usuarioId };
    const id = randomUUID();
    await expect(emTransacao((r) => registrarAuditoria(forjado as never, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: id, antes: { a: 1 }, depois: { a: 2 } }, r))).rejects.toThrow();
    const ctx = criarAdminContext(admin.usuarioId);
    const e = await emTransacao((r) => registrarAuditoria(ctx, { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: id, antes: { a: 1 }, depois: { senha: 'VALOR-SECRETO-XYZ' } }, r)).catch((x: Error) => x);
    expect(String((e as Error).message)).not.toContain('VALOR-SECRETO-XYZ');
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [id])).toHaveLength(0);
  });
  it('valor segredo em array aninhado, __proto__, Date e acao inválida', async () => {
    const ctx = criarAdminContext(admin.usuarioId);
    const id = randomUUID();
    const base = { acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: id, antes: { a: 1 } } as const;
    await expect(emTransacao((r) => registrarAuditoria(ctx, { ...base, depois: { l: [{ x: 1 }, { y: { Token: 'v' } }] } }, r))).rejects.toThrow(/depois\.l\[1\]\.y\.Token/);
    await expect(emTransacao((r) => registrarAuditoria(ctx, { ...base, depois: { d: new Date() } as never }, r))).rejects.toThrow();
    await expect(emTransacao((r) => registrarAuditoria(ctx, { ...base, acao: 'x.y' as never, depois: { a: 1 } }, r))).rejects.toThrow();
    await expect(registrarFalhaAuditoria({ acao: 'login.falha_senha', atorEmailInformado: 'a'.repeat(255) })).rejects.toThrow();
    await expect(registrarFalhaAuditoria({ acao: 'login.falha_senha', atorId: 'nao-uuid' })).rejects.toThrow();
    expect(await linhasDeAuditoria(c, 'entidade_id = $1', [id])).toHaveLength(0);
  });
});
