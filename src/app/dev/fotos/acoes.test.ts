import { afterEach, describe, expect, it, vi } from 'vitest';

import { demonstrarAltAcao, demonstrarMoverAcao, demonstrarRemoverAcao } from './acoes';

// D-021 T-11: as ações de demonstração só validam e redirecionam (PRG); desligada a vitrine, nada é processado.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(destino);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

const form = (c: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(c)) f.append(k, v);
  return f;
};
const destino = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as Redirecionado).destino;

describe('ações de demonstração', () => {
  it('desligada: redireciona para a vitrine sem código', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await destino(demonstrarAltAcao(form({ alt: 'x' })))).toBe('/dev/fotos');
    expect(await destino(demonstrarMoverAcao(form({ posicaoEsperada: '1' })))).toBe('/dev/fotos');
    expect(await destino(demonstrarRemoverAcao())).toBe('/dev/fotos');
  });

  it('ligada: valida o texto, a posição e remove', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(await destino(demonstrarAltAcao(form({ alt: ' Bom  texto ' })))).toBe('/dev/fotos?acao=alt_ok');
    expect(await destino(demonstrarAltAcao(form({ alt: '' })))).toBe('/dev/fotos?acao=alt_vazio');
    expect(await destino(demonstrarAltAcao(form({ alt: 'a'.repeat(151) })))).toBe('/dev/fotos?acao=alt_longo');
    expect(await destino(demonstrarAltAcao(form({})))).toBe('/dev/fotos?acao=alt_vazio');
    expect(await destino(demonstrarMoverAcao(form({ posicaoEsperada: '2' })))).toBe('/dev/fotos?acao=movida');
    expect(await destino(demonstrarMoverAcao(form({ posicaoEsperada: 'x' })))).toBe('/dev/fotos?acao=ordem_mudou');
    expect(await destino(demonstrarRemoverAcao())).toBe('/dev/fotos?acao=removida');
  });
});
