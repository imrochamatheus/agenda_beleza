import { afterEach, describe, expect, it, vi } from 'vitest';

import { CAMPOS_CONSENTIMENTO, MENSAGENS_CONSENTIMENTO } from '@/server/consentimento/tipos';

import { demonstrarConsentimentoAcao } from './acoes';
import { estadoConsentimentoInicial } from './estado';

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const ligar = () => vi.stubEnv('VITRINE_COMPONENTES', 'true');
const { mensagensReserva: M, conviteAvaliacao: C } = CAMPOS_CONSENTIMENTO;

describe('demonstrarConsentimentoAcao (CA-5, CA-19)', () => {
  it('desligada, devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = estadoConsentimentoInicial();
    expect(await demonstrarConsentimentoAcao(anterior, formulario({ [M]: 'on' }))).toBe(anterior);
  });

  it('só o convite → erro da obrigatória e o convite continua marcado', async () => {
    ligar();
    expect(await demonstrarConsentimentoAcao(estadoConsentimentoInicial(), formulario({ [C]: 'on' }))).toEqual({
      erros: { mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva },
      valores: { mensagensReserva: false, conviteAvaliacao: true },
      gravaria: null,
    });
  });

  it('só a obrigatória → só mensagens_reserva; as duas → as duas', async () => {
    ligar();
    expect((await demonstrarConsentimentoAcao(estadoConsentimentoInicial(), formulario({ [M]: 'on' }))).gravaria).toEqual(['mensagens_reserva']);
    const duas = await demonstrarConsentimentoAcao(estadoConsentimentoInicial(), formulario({ [M]: 'on', [C]: 'on' }));
    expect(duas).toEqual({ erros: {}, valores: { mensagensReserva: true, conviteAvaliacao: true }, gravaria: ['mensagens_reserva', 'convite_avaliacao'] });
  });

  it('não importa repositório (RN-21)', async () => {
    const { readFileSync } = await import('node:fs');
    const texto = readFileSync(new URL('./acoes.ts', import.meta.url), 'utf8');
    expect(texto).not.toMatch(/server\/repos/);
  });
});
