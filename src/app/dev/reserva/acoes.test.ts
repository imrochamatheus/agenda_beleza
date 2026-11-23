import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoInicialReserva } from '@/app/(publico)/[slug]/estado';

import { valorDoItem } from '@/server/reserva-publica/passos';

import { EQUIPE_DEMO, SERVICOS_DEMO } from './dados';
import { demonstrarReservaAcao } from './acoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

const CHAVE = '44444444-4444-4444-8444-444444444444';
function fd(sobre: Record<string, string> = {}): FormData {
  const f = new FormData();
  const campos: Record<string, string> = {
    slug: 'demonstracao',
    data: '2026-12-02',
    h0: valorDoItem(EQUIPE_DEMO[0].id, '2026-12-02T13:00:00.000Z'),
    chave: CHAVE,
    nome: 'Maria',
    telefone: '(11) 98765-4321',
    consentimento_mensagens: 'on',
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...sobre,
  };
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  f.append('s', SERVICOS_DEMO[0].id);
  return f;
}

describe('demonstrarReservaAcao', () => {
  it('desligada devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = estadoInicialReserva(CHAVE);
    expect(await demonstrarReservaAcao(anterior, fd())).toBe(anterior);
  });

  it('ligada: confirma simulando, sem gravar; erros por campo preservam os valores', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const anterior = estadoInicialReserva(CHAVE);
    const ok = await demonstrarReservaAcao(anterior, fd());
    expect(ok).toMatchObject({ status: 'confirmada', chave: CHAVE, resumo: { data: '2026-12-02', totalCentavos: 9000, itens: [{ servicoNome: 'Escova', profissionalNome: 'Ana' }] } });
    const erro = await demonstrarReservaAcao(anterior, fd({ nome: 'M', telefone: '1', consentimento_mensagens: '' }));
    expect(erro.status).toBe('editando');
    expect(Object.keys(erro.erros).sort()).toEqual(['mensagensReserva', 'nome', 'telefone']);
    expect(erro.valores).toMatchObject({ nome: 'M', telefone: '1' });
  });

  it('Turnstile: token inválido ou ausente recusa sem confirmar (CA-5, CA-10)', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const anterior = estadoInicialReserva(CHAVE);
    for (const token of ['TOKEN.INVALIDO.DE.TESTE', '']) {
      const r = await demonstrarReservaAcao(anterior, fd({ 'cf-turnstile-response': token }));
      expect(r.status).toBe('editando');
      expect(r.mensagem).toBe('Não foi possível confirmar que você é uma pessoa. Tente novamente.');
      expect(r.valores.nome).toBe('Maria');
    }
  });
});
