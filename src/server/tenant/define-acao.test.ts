import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from '@/server/repos/db';

import { METADADOS_ACAO, defineAcao, metadadosDaAcao } from './define-acao';
import type { ConfigAcao } from './define-acao';

// A forma chamável lê o cookie por next/headers; aqui o cookie é substituído (não é mock de banco).
const cookie = vi.hoisted(() => ({ valor: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ab_sessao' && cookie.valor !== undefined ? { name: nome, value: cookie.valor } : undefined,
  }),
}));

// Banco inacessível: qualquer consulta indevida apareceria como erro de conexão, não como 401.
const URL_FECHADA = 'postgresql://usuario:senha@127.0.0.1:1/z';

describe('defineAcao (sem sessão; os caminhos com sessão real ficam na integração, T-5)', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', URL_FECHADA);
    cookie.valor = undefined;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await encerrarPrisma();
  });

  it('credencial nula → 401 sem executar handler nem política e sem tocar o banco (CA-9a)', async () => {
    const handler = vi.fn(async () => 'nunca');
    const politica = vi.fn(() => ({ permitido: true as const }));
    const acao = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, handler);

    await expect(acao.executar(null, { x: 1 }, { politica })).resolves.toEqual({
      ok: false,
      erro: 'nao_autenticado',
      status: 401,
    });
    await expect(acao.executar({ token: '' }, { x: 1 })).resolves.toEqual({
      ok: false,
      erro: 'nao_autenticado',
      status: 401,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(politica).not.toHaveBeenCalled();
  });

  it('forma chamável sem cookie → 401 (lê ab_sessao por next/headers)', async () => {
    const handler = vi.fn(async () => 'nunca');
    const acao = defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'leitura' }, handler);
    await expect(acao({})).resolves.toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('erro que não é de domínio é relançado (vira 500 no Next), não mascarado como 401', async () => {
    cookie.valor = 'token-qualquer';
    const handler = vi.fn(async () => 'nunca');
    const acao = defineAcao({ papeis: ['gestor'], capacidade: 'agendar' }, handler);
    const erro = await acao({}).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { codigo?: unknown }).codigo).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('expõe os metadados congelados no símbolo de registro', () => {
    const papeis: ConfigAcao['papeis'] = ['gestor', 'profissional'];
    const acao = defineAcao({ papeis, capacidade: 'cancelar' }, async () => null);
    expect(acao[METADADOS_ACAO]).toEqual({ papeis: ['gestor', 'profissional'], capacidade: 'cancelar' });
    expect(metadadosDaAcao(acao)).toBe(acao[METADADOS_ACAO]);
    expect(Object.isFrozen(acao[METADADOS_ACAO])).toBe(true);
    expect(Object.isFrozen(acao[METADADOS_ACAO].papeis)).toBe(true);
    // Mudar o array original depois não altera a ação.
    (papeis as unknown as string[]).push('super_admin');
    expect(acao[METADADOS_ACAO].papeis).toEqual(['gestor', 'profissional']);
    // Ação é função assíncrona (exigência de 'use server'); metadados não enumeráveis.
    expect(typeof acao).toBe('function');
    expect(Object.keys(acao)).toEqual([]);
  });

  it('metadadosDaAcao devolve undefined para o que não passou por defineAcao', () => {
    expect(metadadosDaAcao(async () => null)).toBeUndefined();
    expect(metadadosDaAcao({ [METADADOS_ACAO]: { papeis: ['gestor'], capacidade: 'leitura' } })).toBeUndefined();
    expect(metadadosDaAcao(undefined)).toBeUndefined();
  });

  it('ação sem capacidade ou papéis válidos recusa executar (fail closed), antes de ler sessão', async () => {
    const handler = vi.fn(async () => 'nunca');
    const invalidas = [
      defineAcao({ papeis: ['gestor'] } as unknown as ConfigAcao, handler),
      defineAcao({ papeis: ['gestor'], capacidade: 'excluir' } as unknown as ConfigAcao, handler),
      defineAcao({ papeis: [], capacidade: 'leitura' } as unknown as ConfigAcao, handler),
      defineAcao({ papeis: ['super_admin'], capacidade: 'leitura' } as unknown as ConfigAcao, handler),
      defineAcao({ capacidade: 'leitura' } as unknown as ConfigAcao, handler),
    ];
    for (const acao of invalidas) {
      await expect(acao.executar(null, {})).rejects.toThrow('ação sem papeis ou capacidade válidos');
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
