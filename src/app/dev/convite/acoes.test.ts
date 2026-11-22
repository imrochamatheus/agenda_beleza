import { afterEach, describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_CONVITE } from '@/app/(publico)/convite/[token]/estado';
import { MENSAGENS_CONVITE } from '@/server/convites/tipos';

import { demonstrarConviteAcao } from './acoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

const formulario = (senha?: string) => {
  const f = new FormData();
  if (senha !== undefined) f.set('senha', senha);
  return f;
};

describe('demonstrarConviteAcao', () => {
  it('desligada, devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarConviteAcao(ESTADO_INICIAL_CONVITE, formulario('senha-valida-1'))).toBe(ESTADO_INICIAL_CONVITE);
  });

  it('ligada: senha curta ou ausente → erro de campo; senha válida → sucesso (nada é gravado)', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    for (const f of [formulario('123'), formulario()]) {
      expect(await demonstrarConviteAcao(ESTADO_INICIAL_CONVITE, f)).toEqual({
        status: 'formulario',
        mensagem: null,
        erroSenha: MENSAGENS_CONVITE.senhaCurta,
      });
    }
    expect(await demonstrarConviteAcao(ESTADO_INICIAL_CONVITE, formulario('senha-valida-1'))).toEqual({
      status: 'sucesso',
      mensagem: MENSAGENS_CONVITE.sucesso,
      erroSenha: null,
    });
  });
});
