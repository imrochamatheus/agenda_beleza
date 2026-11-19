import { describe, expect, it } from 'vitest';

import { NaoImplementado } from '../nao-implementado';
import { criarWhatsAppReal } from './real';

describe('criarWhatsAppReal: stub NaoImplementado (CA-9, D-1)', () => {
  it('a instância expõe exatamente o método da porta', () => {
    expect(Object.keys(criarWhatsAppReal())).toEqual(['enviarModelo']);
  });

  it('CA-9: enviarModelo rejeita com NaoImplementado citando E7.2', async () => {
    const promessa = criarWhatsAppReal({ urlBase: 'http://127.0.0.1:1' }).enviarModelo({
      destinatarioE164: '+5511987654321',
      modelo: 'confirmacao',
      parametros: { nome: 'Ana' },
      chaveIdempotencia: 'reserva-1:confirmacao:1',
    });
    await expect(promessa).rejects.toBeInstanceOf(NaoImplementado);
    await expect(promessa).rejects.toMatchObject({
      name: 'NaoImplementado',
      item: 'E7.2',
      message: 'Adaptador real ainda não implementado (E7.2).',
    });
  });
});
