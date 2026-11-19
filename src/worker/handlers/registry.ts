import { assinaturaPrazos } from './assinatura-prazos';
import { exemplo } from './exemplo';
import { reconciliarMensagens } from './reconciliar-mensagens';
import type { DefinicaoFila } from './tipos';
import { whatsappReserva } from './whatsapp-reserva';

/** Filas de produção registradas pelo worker (RN-8). Uma linha por handler (a E4.2 acrescenta a sua). */
export const REGISTRO: readonly DefinicaoFila[] = [
  exemplo,
  assinaturaPrazos,
  whatsappReserva,
  reconciliarMensagens,
];
