import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoInicial, valoresVazios } from '@/app/painel/agenda/nova/estado';

import { demonstrarReservaManualAcao } from './acoes';
import { ANA_DEMO, SERVICOS_DEMO } from './demonstracao';

// D-029: a ação de demonstração só valida; desligada a vitrine, não processa nada.
afterEach(() => vi.unstubAllEnvs());

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe('demonstrarReservaManualAcao', () => {
  it('vitrine desligada: devolve o estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = estadoInicial('k', valoresVazios());
    expect(await demonstrarReservaManualAcao(anterior, formulario({ nome: 'x' }))).toBe(anterior);
  });

  it('ligada: valida e devolve erros de campo preservando os dados', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const e = await demonstrarReservaManualAcao(estadoInicial('k', valoresVazios()), formulario({ nome: '', chave: 'k' }));
    expect(Object.keys(e.erros)).toContain('nome');
    expect(e.chave).toBe('k');
  });

  it('ligada: dados válidos em horário normal criam (sem gravar) com chave nova', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const depois = new Date(Date.now() + 30 * 86_400_000);
    const data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(depois);
    const fd = formulario({
      profissionalId: ANA_DEMO.id, s: SERVICOS_DEMO[0].id, data, hora: '10:00', nome: 'Maria Souza', telefone: '(11) 91234-5678', chave: 'k',
    });
    const e = await demonstrarReservaManualAcao(estadoInicial('k', valoresVazios()), fd);
    // Dia útil → criada; fim de semana → pede confirmação. Em ambos o desfecho é determinístico e sem erro.
    expect(e.erros).toEqual({});
    expect(e.criada !== null || e.motivos !== null).toBe(true);
    if (e.criada) expect(e.chave).not.toBe('k');
  });
});
