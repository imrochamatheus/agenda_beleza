import { assinaturaPrazos } from './assinatura-prazos';
import { exemplo } from './exemplo';
import { limparRateLimit } from './limpar-rate-limit';
import { reconciliarMensagens } from './reconciliar-mensagens';
import type { DefinicaoFila } from './tipos';
import { whatsappReserva } from './whatsapp-reserva';

/** Filas de produção registradas pelo worker (RN-8). Uma linha por handler . */
export const REGISTRO: readonly DefinicaoFila[] = [
  exemplo,
  assinaturaPrazos,
  whatsappReserva,
  reconciliarMensagens,
  limparRateLimit,
];
