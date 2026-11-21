import { afterEach, describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_ADMIN } from '@/app/admin/entrar/estado';

import { demonstrarCodigoAcao, demonstrarCredenciaisAcao } from './acoes';

const form = (campos: Record<string, unknown>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v as string);
  return f;
};

afterEach(() => vi.unstubAllEnvs());

describe('ações de demonstração do login do admin (D-034, sem banco)', () => {
  it('vitrine desligada: devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarCredenciaisAcao(ESTADO_INICIAL_ADMIN, form({ email: 'a@b.test', senha: 'x' }))).toBe(ESTADO_INICIAL_ADMIN);
    expect(await demonstrarCodigoAcao(ESTADO_INICIAL_ADMIN, form({ codigo: '123456' }))).toBe(ESTADO_INICIAL_ADMIN);
  });

  it('credenciais: erros por campo e, válidas, aviso com o e-mail preservado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(await demonstrarCredenciaisAcao(ESTADO_INICIAL_ADMIN, form({}))).toEqual({
      mensagem: null,
      erros: { email: 'Informe seu e-mail.', senha: 'Informe sua senha.' },
      email: '',
    });
    const ok = await demonstrarCredenciaisAcao(ESTADO_INICIAL_ADMIN, form({ email: ' A@B.test ', senha: 'x' }));
    expect(ok).toMatchObject({ erros: {}, email: 'A@B.test', aviso: 'Demonstração: formato válido, nada foi enviado.' });
  });

  it('código: só 6 dígitos (com espaços ou hífen) passam', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    for (const ruim of ['', '12345', 'abcdef']) {
      expect((await demonstrarCodigoAcao(ESTADO_INICIAL_ADMIN, form({ codigo: ruim }))).erros.codigo).toBe('Informe o código de 6 dígitos.');
    }
    expect((await demonstrarCodigoAcao(ESTADO_INICIAL_ADMIN, form({ codigo: '123 456' }))).aviso).toContain('Demonstração');
  });
});
