import { NaoImplementado } from '../nao-implementado';
import type { PortaMercadoPago } from './port';

// Stub do adaptador real do Mercado Pago (D-1, CA-9). A E6.6 substitui o corpo deste arquivo e
// o `mercadopago/ambiente.ts`; a assinatura pode ganhar campos (credenciais vindas da config).

export type OpcoesMercadoPagoReal = {
  /** URL base da API do provedor, injetável para os testes com stub local (RN-6). */
  urlBase?: string;
};

/** Todo método rejeita com NaoImplementado('E6.6'), inclusive `validarWebhook`. */
export function criarMercadoPagoReal(opcoes: OpcoesMercadoPagoReal = {}): PortaMercadoPago {
  void opcoes;
  const rejeitar = () => Promise.reject(new NaoImplementado('E6.6'));
  return {
    criarAssinatura: rejeitar,
    consultarAssinatura: rejeitar,
    consultarPagamento: rejeitar,
    cancelarAssinatura: rejeitar,
    adiarProximaCobranca: rejeitar,
    validarWebhook: rejeitar,
  };
}
