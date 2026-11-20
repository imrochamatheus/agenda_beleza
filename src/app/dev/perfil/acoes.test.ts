import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoPerfilInicial } from '@/app/painel/configuracoes/perfil/estado';
import { MENSAGENS_PERFIL as M, VALORES_PERFIL_VAZIOS } from '@/server/salao/perfil-tipos';

import { demonstrarPerfilAcao } from './acoes';

// D-020 T-12: a ação de demonstração só valida; desligada a vitrine, não processa nada.

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe('demonstrarPerfilAcao', () => {
  it('vitrine desligada → estado anterior sem validar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = estadoPerfilInicial();
    expect(await demonstrarPerfilAcao(anterior, formulario({ cep: '1' }))).toBe(anterior);
  });

  it('inválido → erros com os valores e as caixas digitados', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarPerfilAcao(estadoPerfilInicial(), formulario({ cidade: 'São Paulo', meiosPagamento: ['pix'], instagram: 'pe..rfil' }));
    expect(r.erros).toMatchObject({ logradouro: M.enderecoObrigatorio, instagram: M.instagram });
    expect(r.valores).toMatchObject({ cidade: 'São Paulo', meiosPagamento: ['pix'], instagram: 'pe..rfil' });
    expect(r.sucesso).toBeNull();
  });

  it('válido → sucesso de demonstração com os valores normalizados', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(await demonstrarPerfilAcao(estadoPerfilInicial(), formulario({ telefone: '11987654321', instagram: '@Meu.Salao', comodidades: ['wifi', 'wifi'] }))).toEqual({
      mensagem: null,
      sucesso: M.demonstracao,
      erros: {},
      valores: { ...VALORES_PERFIL_VAZIOS, telefone: '(11) 98765-4321', instagram: 'meu.salao', comodidades: ['wifi'] },
    });
  });
});
