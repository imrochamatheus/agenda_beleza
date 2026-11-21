import { describe, expect, it, vi } from 'vitest';

import { verificarHumano } from './turnstile';

describe('verificarHumano (falha fechada)', () => {
  it('aceita só quando a porta valida e repassa o IP conhecido', async () => {
    const validar = vi.fn(async () => ({ valido: true as const }));
    expect(await verificarHumano('t', '1.2.3.4', { validar })).toBe(true);
    expect(validar).toHaveBeenCalledWith({ token: 't', ip: '1.2.3.4' });
  });
  it('não envia IP "desconhecido"', async () => {
    const validar = vi.fn(async () => ({ valido: true as const }));
    await verificarHumano('t', 'desconhecido', { validar });
    expect(validar).toHaveBeenCalledWith({ token: 't' });
  });
  it('inválido, indisponível ou exceção → false', async () => {
    expect(await verificarHumano(null, '1.2.3.4', { validar: async () => ({ valido: false, motivo: 'token_invalido' }) })).toBe(false);
    expect(await verificarHumano('t', '1.2.3.4', { validar: async () => ({ valido: false, motivo: 'indisponivel' }) })).toBe(false);
    expect(await verificarHumano('t', '1.2.3.4', { validar: async () => { throw new Error('x'); } })).toBe(false);
  });
  it('com a porta simulada do ambiente: o token documentado passa, outro não', async () => {
    expect(await verificarHumano('XXXX.DUMMY.TOKEN.XXXX', '1.2.3.4')).toBe(true);
    expect(await verificarHumano('outro', '1.2.3.4')).toBe(false);
    expect(await verificarHumano(null, '1.2.3.4')).toBe(false);
  });
});
