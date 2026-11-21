import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_DENUNCIA } from '@/app/(publico)/[slug]/_denuncia/estado';
import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';
import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';

import { demonstrarDenunciaAcao } from './acoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fd(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('demonstrarDenunciaAcao', () => {
  it('desligada, devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarDenunciaAcao(ESTADO_INICIAL_DENUNCIA, fd({ motivo: 'spam' }))).toBe(ESTADO_INICIAL_DENUNCIA);
  });

  it('ligada: motivo inválido e texto longo viram erro; token ruim vira "humano"; válido redireciona', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const ruim = await demonstrarDenunciaAcao(ESTADO_INICIAL_DENUNCIA, fd({ motivo: 'x', texto: 'y'.repeat(501) }));
    expect(ruim).toMatchObject({ status: 'invalido', erros: { motivo: MENSAGENS_DENUNCIA.motivo, texto: MENSAGENS_DENUNCIA.texto } });
    const humano = await demonstrarDenunciaAcao(ESTADO_INICIAL_DENUNCIA, fd({ motivo: 'spam', 'cf-turnstile-response': 'ruim' }));
    expect(humano).toMatchObject({ status: 'humano', mensagem: MENSAGENS_DENUNCIA.humano, valores: { motivo: 'spam' } });
    await expect(
      demonstrarDenunciaAcao(ESTADO_INICIAL_DENUNCIA, fd({ motivo: 'spam', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/dev/denuncia?denuncia=recebida#avaliacoes') });
    expect(readFileSync(new URL('./acoes.ts', import.meta.url), 'utf8')).not.toMatch(/server\/repos/);
  });
});
