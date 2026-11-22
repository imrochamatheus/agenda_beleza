import type { ConfigWhatsAppReal } from './ambiente';
import { criarClienteHttp } from './http';
import { caminhoDeEnvio, classificarResposta, montarCorpo } from './mapeamento';
import { ErroEnvioPermanente, ErroEnvioTemporario, validarEnvioModelo } from './port';
import type { PortaWhatsApp } from './port';

// Adaptador real do WhatsApp Cloud API (D-047): mensagem de modelo por HTTP. Validado só por testes
// de contrato com servidor local (README, "Pendente de validação na Meta"). Sem estado, sem log,
// sem retentativa interna. `chaveIdempotencia` só é validada: a Meta não tem campo para ela.

export type OpcoesWhatsAppReal = {
  /** URL base da Graph API, injetável para os testes com servidor local. */
  urlBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function criarWhatsAppReal(config: ConfigWhatsAppReal, opcoes: OpcoesWhatsAppReal = {}): PortaWhatsApp {
  const http = criarClienteHttp({
    token: config.accessToken,
    urlBase: opcoes.urlBase,
    fetchImpl: opcoes.fetchImpl,
    timeoutMs: opcoes.timeoutMs,
  });
  return {
    async enviarModelo(e) {
      const invalida = validarEnvioModelo(e);
      if (invalida) throw invalida;
      const corpo = montarCorpo(config, e);
      const resposta = await http.postar(caminhoDeEnvio(config), corpo);
      const c = classificarResposta(resposta);
      if (c.tipo === 'sucesso') return { provedorMensagemId: c.id };
      throw c.tipo === 'temporario' ? new ErroEnvioTemporario(c.codigo) : new ErroEnvioPermanente(c.codigo);
    },
  };
}
