import { afterEach, describe, expect, it, vi } from 'vitest';

import { arquivarDemonstracao, restaurarDemonstracao, retirarDemonstracao } from './acoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

const fd = (motivo: string) => {
  const f = new FormData();
  f.set('motivo', motivo);
  return f;
};
const destino = (p: Promise<unknown>) => p.then(() => null, (e: { digest?: string }) => e.digest ?? '');

describe('ações de demonstração da moderação', () => {
  it('desligadas, não fazem nada (sem redirecionar)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await destino(retirarDemonstracao(fd('Motivo válido')))).toBeNull();
    expect(await destino(restaurarDemonstracao(fd('Motivo válido')))).toBeNull();
    expect(await destino(arquivarDemonstracao())).toBeNull();
  });

  it('ligadas: validam só o motivo e fazem PRG com código fechado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(await destino(retirarDemonstracao(fd('Motivo válido')))).toContain('resultado=retirada');
    expect(await destino(restaurarDemonstracao(fd('Motivo válido')))).toContain('resultado=restaurada');
    expect(await destino(retirarDemonstracao(fd('ab')))).toContain('resultado=motivo_invalido');
    expect(await destino(retirarDemonstracao(fd('fale com a@b.com')))).toContain('resultado=motivo_dados');
    expect(await destino(arquivarDemonstracao())).toContain('resultado=arquivadas');
  });
});
