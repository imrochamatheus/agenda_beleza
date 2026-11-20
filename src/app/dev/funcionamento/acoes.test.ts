import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoFuncionamentoInicial } from '@/app/painel/configuracoes/funcionamento/estado';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';

import { demonstrarFuncionamentoAcao } from './acoes';

// D-020 T-12: a ação de demonstração só valida; desligada a vitrine, não processa nada.

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const inicial = () => estadoFuncionamentoInicial({ definido: false });

describe('demonstrarFuncionamentoAcao', () => {
  it('vitrine desligada → estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = inicial();
    expect(await demonstrarFuncionamentoAcao(anterior, formulario({ modo: 'informar' }))).toBe(anterior);
  });

  it('inválido → erros por dia com os valores e o modo', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarFuncionamentoAcao(inicial(), formulario({ modo: 'informar', 'inicio-1-0': '22:00', 'fim-1-0': '02:00' }));
    expect(r.erros).toEqual({ dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } } } });
    expect(r.modo).toBe('informar');
    expect(r.valores[1][0]).toEqual({ inicio: '22:00', fim: '02:00' });
    expect((await demonstrarFuncionamentoAcao(inicial(), formulario({}))).erros).toEqual({ modo: M.modo });
  });

  it('informar válido → semana canônica; 6 intervalos num dia aceitos; não informar → linhas vazias', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const campos: Record<string, string> = { modo: 'informar', 'inicio-2-0': '9:00', 'fim-2-0': '12:00', 'inicio-2-1': '12:00', 'fim-2-1': '13:00' };
    const r = await demonstrarFuncionamentoAcao(inicial(), formulario(campos));
    expect(r).toMatchObject({ sucesso: M.demonstracao, modo: 'informar', erros: {} });
    expect(r.valores[2].slice(0, 2)).toEqual([
      { inicio: '09:00', fim: '13:00' },
      { inicio: '', fim: '' },
    ]);
    const seis: Record<string, string> = { modo: 'informar' };
    [8, 10, 12, 14, 16, 18].forEach((h, n) => {
      seis[`inicio-4-${n}`] = `${h}:00`;
      seis[`fim-4-${n}`] = `${h}:30`;
    });
    const r6 = await demonstrarFuncionamentoAcao(inicial(), formulario(seis));
    expect(r6.sucesso).toBe(M.demonstracao);
    expect(r6.valores[4].every((l) => l.inicio !== '')).toBe(true);
    const nao = await demonstrarFuncionamentoAcao(inicial(), formulario({ modo: 'nao_informar', 'inicio-1-0': 'x' }));
    expect(nao).toMatchObject({ sucesso: M.demonstracao, modo: 'nao_informar', funcionamento: { definido: false } });
    expect(nao.valores[1][0]).toEqual({ inicio: '', fim: '' });
  });
});
