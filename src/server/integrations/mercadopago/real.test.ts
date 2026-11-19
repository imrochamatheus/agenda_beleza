import { describe, expect, it } from 'vitest';

import { NaoImplementado } from '../nao-implementado';
import { OPERACOES_MP, type PortaMercadoPago } from './port';
import { criarMercadoPagoReal } from './real';

const ASSINATURA_ID = '0f8fad5b-d9cb-469f-a165-90a5f8b3a6b1';

// Uma chamada por método da porta. O tipo Record<keyof PortaMercadoPago, …> faz o typecheck
// falhar se a porta ganhar um método sem caso aqui.
const CHAMADAS: Record<keyof PortaMercadoPago, (p: PortaMercadoPago) => Promise<unknown>> = {
  criarAssinatura: (p) =>
    p.criarAssinatura({
      salaoId: ASSINATURA_ID,
      emailPagador: 'gestor@exemplo.com',
      urlRetorno: 'http://localhost:3000/assinatura',
    }),
  consultarAssinatura: (p) => p.consultarAssinatura(ASSINATURA_ID),
  consultarPagamento: (p) => p.consultarPagamento(ASSINATURA_ID),
  cancelarAssinatura: (p) => p.cancelarAssinatura(ASSINATURA_ID),
  adiarProximaCobranca: (p) => p.adiarProximaCobranca(ASSINATURA_ID, new Date('2027-01-10T12:00:00Z')),
  validarWebhook: (p) => p.validarWebhook({ cabecalhos: {}, consulta: {}, corpo: {} }),
};

describe('criarMercadoPagoReal: stub NaoImplementado (CA-9, D-1)', () => {
  it('a instância expõe exatamente os métodos da porta', () => {
    expect(Object.keys(criarMercadoPagoReal()).sort()).toEqual(
      [...OPERACOES_MP, 'validarWebhook'].sort(),
    );
  });

  it.each(Object.keys(CHAMADAS) as (keyof PortaMercadoPago)[])(
    'CA-9: %s rejeita com NaoImplementado citando E6.6',
    async (metodo) => {
      const porta = criarMercadoPagoReal({ urlBase: 'http://127.0.0.1:1' });
      const promessa = CHAMADAS[metodo](porta);
      await expect(promessa).rejects.toBeInstanceOf(NaoImplementado);
      await expect(promessa).rejects.toMatchObject({
        name: 'NaoImplementado',
        item: 'E6.6',
        message: 'Adaptador real ainda não implementado (E6.6).',
      });
    },
  );
});
