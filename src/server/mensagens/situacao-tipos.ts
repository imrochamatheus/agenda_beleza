import type { EstadoMensagem } from './tipos';

// Contrato client-safe da situação de envio mostrada à equipe (D-043). Só rótulos já mapeados no
// servidor: nunca `erroCodigo` bruto, destinatário, parâmetros, id do provedor nem `erro_detalhe`.
export type MensagemSituacao = {
  id: string;
  estado: EstadoMensagem;
  rotulo: string;
  motivo: string | null;
  tentativas: number;
  ultimaTentativaEm: Date | null;
};
