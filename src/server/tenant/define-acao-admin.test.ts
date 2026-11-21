import { describe, expect, it } from 'vitest';

import { METADADOS_ACAO, metadadosDaAcao } from './define-acao';
import { defineAcaoAdmin } from './define-acao-admin';
import { verificarAcoes } from './registro';

const acao = defineAcaoAdmin(async (_ctx, n: number) => n);

describe('defineAcaoAdmin (núcleo sem banco)', () => {
  it('sem nenhuma credencial é 401, sem chamar o handler nem o banco', async () => {
    let chamou = false;
    const a = defineAcaoAdmin(async () => {
      chamou = true;
    });
    expect(await a.executar({ admin: null, salao: null }, undefined)).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    expect(chamou).toBe(false);
  });

  it('expõe metadados só de admin, congelados, que o registro de ações aceita', () => {
    expect(metadadosDaAcao(acao)).toEqual({ tipo: 'admin', papeis: ['admin'] });
    const m = (acao as unknown as Record<typeof METADADOS_ACAO, object>)[METADADOS_ACAO];
    expect(Object.isFrozen(m)).toBe(true);
    expect(verificarAcoes({ '/src/x.acao.ts': { acao } })).toEqual([]);
  });

  it('o registro recusa a forma forjada sem a marca de admin', () => {
    const forjada = Object.assign(async () => null, { [METADADOS_ACAO]: { papeis: ['admin'] } });
    expect(verificarAcoes({ '/src/y.acao.ts': { forjada } })).toEqual([{ arquivo: '/src/y.acao.ts', exportacao: 'forjada', motivo: 'sem_capacidade' }]);
  });
});
