import { randomUUID } from 'node:crypto';

import type { ConfigMercadoPagoReal } from './ambiente';
import { criarClienteHttp, idParaCaminho, URL_BASE_PADRAO } from './http';
import {
  ESTRATEGIA_CRIACAO,
  extrairProximaCobranca,
  lerIdCriado,
  lerInitPoint,
  mapearPagamento,
  mapearPreapproval,
  montarCorpoAdiamento,
  montarCorpoCancelamento,
  montarCorpoCriacao,
} from './mapeamento';
import {
  type AssinaturaProvedor,
  ErroProvedor,
  OperacaoInvalidaNoProvedor,
  type PagamentoProvedor,
  type PortaMercadoPago,
  ProvedorNaoSuportaAdiamento,
  validarCriacaoAssinatura,
} from './port';
import { validarWebhookReal } from './webhook';

// Adaptador real do Mercado Pago (D-046): API de Assinaturas (preapproval) por HTTP. Validado só por
// testes de contrato com servidor local; a validação no MP real é pendência do sandbox (README).

/** Tolerância da conferência do adiamento (RN-4). */
const TOLERANCIA_ADIAMENTO_MS = 60_000;

export type OpcoesMercadoPagoReal = {
  /** URL base da API, injetável para os testes com stub local. */
  urlBase?: string;
  fetchImpl?: typeof fetch;
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
  gerarChave?: () => string;
  timeoutMs?: number;
  /** URL pública do webhook, enviada como `notification_url` (NÃO CONFIRMADO, R-5). */
  urlNotificacao?: string;
};

export function criarMercadoPagoReal(
  config: ConfigMercadoPagoReal,
  opcoes: OpcoesMercadoPagoReal = {},
): PortaMercadoPago {
  const http = criarClienteHttp({
    token: config.accessToken,
    urlBase: opcoes.urlBase ?? URL_BASE_PADRAO,
    fetchImpl: opcoes.fetchImpl,
    esperar: opcoes.esperar,
    timeoutMs: opcoes.timeoutMs,
  });
  const agora = opcoes.agora ?? (() => new Date());
  const gerarChave = opcoes.gerarChave ?? randomUUID;

  async function lerAssinatura(id: string): Promise<AssinaturaProvedor> {
    const caminho = `/preapproval/${idParaCaminho(id)}`;
    return mapearPreapproval(await http.requisitar({ metodo: 'GET', caminho }));
  }

  return {
    async criarAssinatura(e) {
      const invalida = validarCriacaoAssinatura(e);
      if (invalida) throw invalida;
      const json = await http.requisitar({
        metodo: 'POST',
        caminho: '/preapproval',
        idempotencia: gerarChave(),
        corpo: montarCorpoCriacao(ESTRATEGIA_CRIACAO, {
          planoId: config.planoId,
          emailPagador: e.emailPagador,
          salaoId: e.salaoId,
          urlRetorno: e.urlRetorno,
          urlNotificacao: opcoes.urlNotificacao,
        }),
      });
      const assinaturaId = lerIdCriado(json);
      const urlCheckout = lerInitPoint(json);
      if (urlCheckout === null) throw new ErroProvedor('Resposta inesperada do provedor de pagamento.');
      return { assinaturaId, urlCheckout };
    },

    consultarAssinatura: lerAssinatura,

    async consultarPagamento(id): Promise<PagamentoProvedor> {
      const caminho = `/authorized_payments/${idParaCaminho(id)}`;
      return mapearPagamento(await http.requisitar({ metodo: 'GET', caminho }));
    },

    async cancelarAssinatura(id) {
      const caminho = `/preapproval/${idParaCaminho(id)}`;
      try {
        await http.requisitar({ metodo: 'PUT', caminho, corpo: montarCorpoCancelamento() });
      } catch (e) {
        // RN-12: idempotente. O MP recusa cancelar o que já está cancelado; confere por consulta.
        if (!(e instanceof OperacaoInvalidaNoProvedor)) throw e;
        if ((await lerAssinatura(id)).estado === 'cancelada') return;
        throw e;
      }
    },

    async adiarProximaCobranca(id, novaData) {
      const caminho = `/preapproval/${idParaCaminho(id)}`;
      if (!(novaData instanceof Date) || Number.isNaN(novaData.getTime()) || novaData.getTime() <= agora().getTime()) {
        throw new OperacaoInvalidaNoProvedor('Operação inválida no provedor de pagamento: data inválida.');
      }
      try {
        await http.requisitar({ metodo: 'PUT', caminho, corpo: montarCorpoAdiamento(novaData) });
      } catch (e) {
        if (e instanceof OperacaoInvalidaNoProvedor) throw new ProvedorNaoSuportaAdiamento();
        throw e;
      }
      // NÃO CONFIRMADO que o PUT altera a data: relê e confere (RN-4).
      const refletida = extrairProximaCobranca(await http.requisitar({ metodo: 'GET', caminho }));
      if (refletida === null || Math.abs(refletida.getTime() - novaData.getTime()) > TOLERANCIA_ADIAMENTO_MS) {
        throw new ProvedorNaoSuportaAdiamento();
      }
    },

    async urlAtualizarMeioPagamento(id) {
      const caminho = `/preapproval/${idParaCaminho(id)}`;
      const json = await http.requisitar({ metodo: 'GET', caminho });
      if (mapearPreapproval(json).estado === 'cancelada') throw new OperacaoInvalidaNoProvedor();
      const url = lerInitPoint(json);
      if (url === null) throw new ErroProvedor('Resposta inesperada do provedor de pagamento.');
      return url;
    },

    validarWebhook(n) {
      return Promise.resolve(validarWebhookReal(n, { segredo: config.webhookSecret, agora: agora() }));
    },
  };
}
