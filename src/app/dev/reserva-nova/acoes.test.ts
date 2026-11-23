import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoInicial, valoresVazios } from '@/app/painel/agenda/nova/estado';

import { demonstrarReservaManualAcao } from './acoes';
import { ANA_DEMO, SERVICOS_DEMO } from './demonstracao';

// D-029 / D-050: a ação de demonstração só valida; desligada a vitrine, não processa nada.
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
    expect(e.errosPorLinha[0]).toMatchObject({ servico: expect.any(String), hora: expect.any(String) });
    expect(e.chave).toBe('k');
  });

  it('ligada: "Adicionar outro serviço" devolve uma linha a mais sem validar', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const e = await demonstrarReservaManualAcao(estadoInicial('k', valoresVazios()), formulario({ linha: 'adicionar', nome: 'Maria', 'item-1-hora': '10:00', chave: 'k' }));
    expect(e.valores.itens).toHaveLength(2);
    expect(e.valores.itens[0].hora).toBe('10:00');
    expect(e.valores.nome).toBe('Maria');
    expect(e.erros).toEqual({});
    expect(e.statusLinha).toBe('Linha de serviço adicionada.');
  });

  it('ligada: dados válidos criam (sem gravar) com chave nova ou pedem confirmação de encaixe', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const depois = new Date(Date.now() + 30 * 86_400_000);
    const data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(depois);
    const fd = formulario({
      data, itens: '1', 'item-1-servico': SERVICOS_DEMO[0].id, 'item-1-profissional': ANA_DEMO.id, 'item-1-hora': '10:00',
      nome: 'Maria Souza', telefone: '(11) 91234-5678', chave: 'k',
    });
    const e = await demonstrarReservaManualAcao(estadoInicial('k', valoresVazios()), fd);
    // Dia útil → criada; fim de semana → pede confirmação. Em ambos o desfecho é determinístico e sem erro.
    expect(e.erros).toEqual({});
    expect(e.criada !== null || e.encaixe !== null).toBe(true);
    if (e.criada) {
      expect(e.chave).not.toBe('k');
      expect(e.criada.hrefAgenda).toContain('/dev/agenda');
    }
  });
});
