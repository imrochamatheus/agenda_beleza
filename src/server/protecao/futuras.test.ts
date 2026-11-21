import { describe, expect, it, vi } from 'vitest';

import { criarAntesDaReserva } from './futuras';
import { MENSAGENS_PROTECAO } from './tipos';

const AGORA = new Date('2026-11-21T12:00:00Z');
const CHAVE = '11111111-1111-4111-8111-111111111111';

function repos(contagem: number, existente: unknown = null) {
  const contar = vi.fn(async () => contagem);
  const buscar = vi.fn(async () => existente);
  return { r: { reservas: { contarFuturasDaCliente: contar, buscarPorChave: buscar } } as never, contar, buscar };
}
const CTX = {} as never;
const D = { clienteId: 'c', inicio: AGORA };

describe('criarAntesDaReserva', () => {
  it('2 futuras: permite; 3: recusa com a mensagem que não revela reservas', async () => {
    const dois = repos(2);
    expect(await criarAntesDaReserva({ chave: CHAVE, agora: AGORA })(CTX, dois.r, D)).toEqual({ permitido: true });
    expect(dois.contar).toHaveBeenCalledWith(CTX, { clienteId: 'c', agora: AGORA, ignorarChave: CHAVE });
    const tres = repos(3);
    expect(await criarAntesDaReserva({ chave: CHAVE, agora: AGORA })(CTX, tres.r, D)).toEqual({
      permitido: false,
      motivo: MENSAGENS_PROTECAO.futuras,
    });
    expect(MENSAGENS_PROTECAO.futuras).not.toMatch(/\d/);
  });

  it('chave já gravada: permite sem contar (repetida nunca é recusada)', async () => {
    const x = repos(99, { id: 'r' });
    expect(await criarAntesDaReserva({ chave: CHAVE, agora: AGORA })(CTX, x.r, D)).toEqual({ permitido: true });
    expect(x.contar).not.toHaveBeenCalled();
  });

  it('sem chave: conta tudo', async () => {
    const x = repos(3);
    expect((await criarAntesDaReserva({ chave: null, agora: AGORA })(CTX, x.r, D)).permitido).toBe(false);
    expect(x.buscar).not.toHaveBeenCalled();
    expect(x.contar).toHaveBeenCalledWith(CTX, { clienteId: 'c', agora: AGORA, ignorarChave: null });
  });
});
