import { afterEach, describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_FORMULARIO_JORNADA } from '@/app/painel/profissionais/[id]/jornada/estado';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import { demonstrarJornadaAcao } from './acoes';

// D-015 T-7 (R-11): a ação de demonstração só valida; desligada, não processa nada.

const M = MENSAGENS_JORNADA;
const ID = '00000000-0000-4000-8000-00000000d015';

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  f.set('profissionalId', ID);
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('demonstrarJornadaAcao', () => {
  it.each([undefined, '', 'false', '1'])('vitrine desligada (VITRINE_COMPONENTES=%s) → estado inicial, sem validar', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    expect(await demonstrarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario({ 'inicio-1-0': '22:00', 'fim-1-0': '02:00' }))).toBe(
      ESTADO_INICIAL_FORMULARIO_JORNADA,
    );
  });

  it('ligada, inválido → erros e valores preservados', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarJornadaAcao(ESTADO_INICIAL_FORMULARIO_JORNADA, formulario({ 'inicio-1-0': '22:00', 'fim-1-0': '02:00' }));
    expect(r.mensagem).toBeNull();
    expect(r.erros).toEqual({ dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } } } });
    expect(r.valores![1][0]).toEqual({ inicio: '22:00', fim: '02:00' });
  });

  it('ligada, válido → mensagem de sucesso e valores canônicos (contíguos unidos, ordenados)', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarJornadaAcao(
      ESTADO_INICIAL_FORMULARIO_JORNADA,
      formulario({ 'inicio-2-0': '12:00', 'fim-2-0': '13:00', 'inicio-2-1': '9:00', 'fim-2-1': '12:00' }),
    );
    expect(r).toMatchObject({ mensagem: M.demonstracao, sucesso: true, erros: {} });
    expect(r.valores![2].slice(0, 2)).toEqual([
      { inicio: '09:00', fim: '13:00' },
      { inicio: '', fim: '' },
    ]);
  });
});
