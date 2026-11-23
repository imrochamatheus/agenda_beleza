import type { EstadoMensagem } from './tipos';

// Contrato client-safe da situação de envio mostrada à equipe (D-043). Só rótulos já mapeados no
// servidor: nunca `erroCodigo` bruto, destinatário, parâmetros, id do provedor nem `erro_detalhe`.
export type MensagemSituacao = {
  id: string;
  /**
   * D-050 RN-29/RN-37: item a que a mensagem se refere (remarcação/cancelamento de um item); null = reserva
   * inteira (confirmação, convite, "cancelar todos" e mensagens antigas). Opcional só para as vitrines.
   */
  reservaItemId?: string | null;
  estado: EstadoMensagem;
  rotulo: string;
  motivo: string | null;
  tentativas: number;
  ultimaTentativaEm: Date | null;
};
