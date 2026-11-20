import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { exigirAcessoAoPainel } from '@/server/auth/pagina';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';

// D-013 T-1 (§3.1; CA-11): `exigirAcessoAoPainel(caminho, papeis?, operacao?)` aplica a matriz de
// permissões da operação no mesmo try. next/headers e next/navigation são substituídos (não é mock de
// banco): as sessões são reais no PostgreSQL deste worker.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const jar = vi.hoisted(() => ({ valor: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && jar.valor !== undefined ? { name: nome, value: jar.valor } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
}));

let a: SalaoCompleto;

beforeAll(async () => {
  ({ a } = await criarDoisSaloes());
});
afterAll(() => {
  jar.valor = undefined;
});
beforeEach(() => {
  jar.valor = undefined;
});

describe('exigirAcessoAoPainel com operação', () => {
  it('gestor com profissional.gerir → permitido, com o contexto da sessão', async () => {
    jar.valor = (await criarSessao(a.gestor.usuarioId)).token;
    const r = await exigirAcessoAoPainel('/painel/profissionais', ['gestor'], 'profissional.gerir');
    expect(r.tipo).toBe('permitido');
    expect(r.tipo === 'permitido' && [r.ctx.papel, r.ctx.salaoId]).toEqual(['gestor', a.salaoId]);
  });

  it('profissional com profissional.gerir → negado (a matriz nega), mesmo se o papel for aceito', async () => {
    jar.valor = (await criarSessao(a.profissional.usuarioId)).token;
    expect(await exigirAcessoAoPainel('/painel/profissionais', ['gestor', 'profissional'], 'profissional.gerir')).toEqual({
      tipo: 'negado',
    });
    // Controle: operação com escopo próprio e perfil ativo → permitido.
    expect((await exigirAcessoAoPainel('/painel/agenda', ['gestor', 'profissional'], 'agenda.ver')).tipo).toBe('permitido');
    // Sem operação, o comportamento anterior continua (só painel.acessar).
    expect((await exigirAcessoAoPainel('/painel')).tipo).toBe('permitido');
  });

  it('sem cookie → redirect para /entrar?proximo=<caminho> (fora do try)', async () => {
    const erro = await exigirAcessoAoPainel('/painel/profissionais', ['gestor'], 'profissional.gerir').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Redirecionado);
    expect((erro as Redirecionado).destino).toBe('/entrar?proximo=%2Fpainel%2Fprofissionais');
  });
});
