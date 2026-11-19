import { NaoImplementado } from '../nao-implementado';
import type { PortaWhatsApp } from './port';

// Stub do adaptador real do WhatsApp Cloud API (D-1, CA-9). A E7.2 substitui o corpo deste
// arquivo e o `whatsapp/ambiente.ts`; a assinatura pode ganhar campos (token, número, templates).

export type OpcoesWhatsAppReal = {
  /** URL base da Graph API, injetável para os testes com stub local (RN-6). */
  urlBase?: string;
};

/** `enviarModelo` rejeita com NaoImplementado('E7.2'). */
export function criarWhatsAppReal(opcoes: OpcoesWhatsAppReal = {}): PortaWhatsApp {
  void opcoes;
  return {
    enviarModelo: () => Promise.reject(new NaoImplementado('E7.2')),
  };
}
