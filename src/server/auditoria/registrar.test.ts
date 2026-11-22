import { describe, expect, it } from 'vitest';

import { criarAdminContext, criarTenantContext } from '@/server/tenant/context';
import type { Repos } from '@/server/repos';

import { montarEntrada, registrarAuditoria } from './registrar';
import { ACOES_AUDITAVEIS, ENTIDADES_AUDITAVEIS, ErroAuditoriaEntrada, FORMATO_ACAO } from './tipos';

const UUID = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const SALAO = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';

const base = { atorId: UUID, resultado: 'sucesso' as const };

describe('vocabulário', () => {
  it('ações têm o formato entidade.verbo, sem duplicata, e a entidade pertence à lista', () => {
    expect(new Set(ACOES_AUDITAVEIS).size).toBe(ACOES_AUDITAVEIS.length);
    expect(new Set(ENTIDADES_AUDITAVEIS).size).toBe(ENTIDADES_AUDITAVEIS.length);
    for (const a of ACOES_AUDITAVEIS) {
      expect(a).toMatch(FORMATO_ACAO);
      expect(a.length).toBeLessThanOrEqual(64);
      // `login.*` e `totp.*` incidem sobre a entidade `usuario` (D-034); as demais, sobre a do prefixo.
      const prefixo = ['login', 'totp'].includes(a.split('.')[0]) ? 'usuario' : a.split('.')[0];
      expect(ENTIDADES_AUDITAVEIS as readonly string[]).toContain(prefixo);
    }
  });
});

describe('vocabulário da D-044', () => {
  const NOVAS = ['salao.atualizar', 'salao.suspender', 'salao.reativar', 'salao.estender_teste', 'usuario.atualizar_email'] as const;
  it('as cinco ações novas existem, exigem antes e depois em sucesso e a entidade assinatura é aceita', () => {
    for (const acao of NOVAS) {
      expect(ACOES_AUDITAVEIS as readonly string[]).toContain(acao);
      expect(() => montarEntrada({ ...base, acao, entidade: 'salao', entidadeId: SALAO, antes: { a: 1 } })).toThrow(ErroAuditoriaEntrada);
      expect(montarEntrada({ ...base, acao, entidade: 'salao', entidadeId: SALAO, antes: { a: 1 }, depois: { a: 2 } }).acao).toBe(acao);
    }
    expect(ENTIDADES_AUDITAVEIS as readonly string[]).toContain('assinatura');
    expect(montarEntrada({ atorId: UUID, resultado: 'falha', acao: 'salao.estender_teste', entidade: 'assinatura', entidadeId: SALAO, depois: { dias: 5 } }).entidade).toBe('assinatura');
  });
});

describe('montarEntrada (CA-7, CA-9)', () => {
  it('monta a entrada válida de uma mutação', () => {
    const e = montarEntrada({
      ...base, acao: 'salao.renomear', entidade: 'salao', entidadeId: SALAO, salaoId: SALAO,
      antes: { nome: 'A' }, depois: { nome: 'B' },
    });
    expect(e).toMatchObject({ atorId: UUID, acao: 'salao.renomear', entidade: 'salao', entidadeId: SALAO, salaoId: SALAO, antes: { nome: 'A' }, depois: { nome: 'B' }, resultado: 'sucesso', atorEmailInformado: null });
  });

  it.each([
    ['fora do vocabulário', 'salao.apagar'],
    ['sem ponto', 'salaorenomear'],
    ['maiúscula', 'Salao.renomear'],
    ['acima de 64', `a.${'b'.repeat(70)}`],
    ['não string', 42],
  ])('recusa ação %s', (_n, acao) => {
    expect(() => montarEntrada({ ...base, acao, entidade: 'salao' })).toThrow(ErroAuditoriaEntrada);
  });

  it('recusa entidade fora do vocabulário, entidadeId vazio/longo e UUID malformado', () => {
    const ok = { ...base, acao: 'login.falha_senha' };
    expect(() => montarEntrada({ ...ok, entidade: 'cliente' })).toThrow('entidade');
    expect(() => montarEntrada({ ...ok, entidade: 7 })).toThrow('entidade');
    expect(() => montarEntrada({ ...ok, entidadeId: '' })).toThrow('entidadeId');
    expect(() => montarEntrada({ ...ok, entidadeId: 'x'.repeat(65) })).toThrow('entidadeId');
    expect(() => montarEntrada({ ...ok, salaoId: 'nao-uuid' })).toThrow('salaoId');
    expect(() => montarEntrada({ ...ok, atorId: 'nao-uuid' })).toThrow('atorId');
    expect(montarEntrada({ ...ok, entidadeId: 'x'.repeat(64) }).entidadeId).toHaveLength(64);
  });

  it('exige antes e depois (objetos) nas ações de mutação em sucesso, mas não em falha', () => {
    const m = { ...base, acao: 'avaliacao.retirar', entidade: 'avaliacao', entidadeId: UUID };
    expect(() => montarEntrada(m)).toThrow('obrigatórios');
    expect(() => montarEntrada({ ...m, antes: { a: 1 } })).toThrow('obrigatórios');
    expect(() => montarEntrada({ ...m, antes: [] , depois: {} })).toThrow('objeto');
    expect(() => montarEntrada({ ...m, antes: 'x', depois: {} })).toThrow('objeto');
    expect(montarEntrada({ ...m, antes: {}, depois: {} }).depois).toEqual({});
    expect(montarEntrada({ ...m, resultado: 'falha' }).antes).toBeNull();
  });

  it('recusa JSON não puro e chave proibida em antes/depois', () => {
    const m = { ...base, acao: 'salao.renomear', entidade: 'salao', entidadeId: SALAO };
    expect(() => montarEntrada({ ...m, antes: { a: undefined }, depois: {} })).toThrow(ErroAuditoriaEntrada);
    expect(() => montarEntrada({ ...m, antes: {}, depois: { senha: 'x' } })).toThrow('depois.senha');
  });

  it('e-mail informado: minúsculo, até 254, sem controle', () => {
    const f = { atorId: null, resultado: 'falha' as const, acao: 'login.falha_senha' };
    expect(montarEntrada({ ...f, atorEmailInformado: 'X@Y.com' }).atorEmailInformado).toBe('x@y.com');
    expect(() => montarEntrada({ ...f, atorEmailInformado: `${'a'.repeat(250)}@y.com` })).toThrow('atorEmailInformado');
    expect(() => montarEntrada({ ...f, atorEmailInformado: 'a\nb@y.com' })).toThrow('atorEmailInformado');
    expect(montarEntrada({ ...f, atorEmailInformado: 'a'.repeat(254) }).atorEmailInformado).toHaveLength(254);
  });
});

describe('registrarAuditoria (CA-6)', () => {
  const r = { auditoria: { inserir: () => { throw new Error('não deveria gravar'); } } } as unknown as Repos;
  const e = { acao: 'login.falha_senha', entidade: 'usuario', entidadeId: UUID } as const;

  it('recusa contexto que não é admin, sem tocar o repositório', async () => {
    const tenant = criarTenantContext({ usuarioId: UUID, papel: 'gestor', salaoId: SALAO, profissionalId: null });
    await expect(registrarAuditoria(tenant as never, e, r)).rejects.toThrow('AdminContext');
    await expect(registrarAuditoria({ tipo: 'admin', usuarioId: UUID } as never, e, r)).rejects.toThrow('AdminContext');
  });

  it('usa o ator do contexto e resultado sucesso', async () => {
    let recebida: unknown;
    const r2 = { auditoria: { inserir: async (x: unknown) => { recebida = x; return { id: 'i' }; } } } as unknown as Repos;
    await expect(registrarAuditoria(criarAdminContext(UUID), e, r2)).resolves.toEqual({ id: 'i' });
    expect(recebida).toMatchObject({ atorId: UUID, resultado: 'sucesso' });
  });
});
