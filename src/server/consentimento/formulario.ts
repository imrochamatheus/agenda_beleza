import { CAMPOS_CONSENTIMENTO, type ValoresConsentimento } from './tipos';
import { ehAceite } from './validacao';

/** Leitura dos campos fixos do FormData (A-10). Client-safe: sem repositórios nem next/*. */
export function lerConsentimentoDoFormulario(fd: FormData): { mensagensReserva: unknown; conviteAvaliacao: unknown } {
  return {
    mensagensReserva: fd.get(CAMPOS_CONSENTIMENTO.mensagensReserva),
    conviteAvaliacao: fd.get(CAMPOS_CONSENTIMENTO.conviteAvaliacao),
  };
}

/** Estado das caixas para reexibir sem JavaScript. */
export function valoresDoFormulario(fd: FormData): ValoresConsentimento {
  const l = lerConsentimentoDoFormulario(fd);
  return { mensagensReserva: ehAceite(l.mensagensReserva), conviteAvaliacao: ehAceite(l.conviteAvaliacao) };
}
