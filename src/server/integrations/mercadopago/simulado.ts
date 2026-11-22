import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { ehUuid } from '@/server/repos/ids';
import { repoSimMercadoPago } from '@/server/repos/sim-mercadopago';
import type { RepoSimMercadoPago } from '@/server/repos/sim-mercadopago';

import { somarDias, somarUmMes } from './datas';
import {
  ErroProvedor,
  OPERACOES_MP,
  OperacaoInvalidaNoProvedor,
  RecursoNaoEncontradoNoProvedor,
  validarCriacaoAssinatura,
} from './port';
import type { NotificacaoWebhook, OperacaoMp, PortaMercadoPago } from './port';
import { notificacaoSimulada, validarNotificacaoSimulada } from './webhook-simulado';

// Mercado Pago simulado (RN-17, RN-18). Estado no PostgreSQL (tabelas sim_mp_*, via
// src/server/repos/sim-mercadopago.ts), compartilhado entre app, worker e testes (RN-15).

const ESTADO_INVALIDO =
  'Operação inválida no provedor de pagamento: o estado da assinatura não permite a operação.';
const DATA_INVALIDA =
  'Operação inválida no provedor de pagamento: a nova data de cobrança deve ser posterior ao instante atual.';
const ERRO_FORCADO = 'Falha no provedor de pagamento (erro forçado no simulado).';

/** Controle do simulado: disparo dos eventos do provedor e erro forçado (RN-4). */
export interface ControleMpSimulado {
  /** `pendente → autorizada`; próxima cobrança = `em` + DIAS_TESTE. */
  autorizar(id: string, o?: { em?: Date }): Promise<NotificacaoWebhook>;
  /** Só em `autorizada`: pagamento `aprovado` e próxima cobrança + 1 mês. */
  aprovarCobranca(id: string, o?: { em?: Date }): Promise<{ pagamentoId: string; notificacao: NotificacaoWebhook }>;
  /** Só em `autorizada`: pagamento `recusado`; estado e data não mudam. */
  falharCobranca(id: string, o?: { em?: Date }): Promise<{ pagamentoId: string; notificacao: NotificacaoWebhook }>;
  /** `pendente|autorizada → cancelada`; numa já cancelada, erro (a porta é que é idempotente). */
  cancelar(id: string, o?: { em?: Date }): Promise<NotificacaoWebhook>;
  /** A próxima chamada da operação, de qualquer processo, lança ErroProvedor sem efeito. */
  forcarErro(operacao: OperacaoMp): Promise<void>;
  listarAdiamentos(id: string): Promise<{ dataAnterior: Date | null; novaData: Date; criadoEm: Date }[]>;
}

export type OpcoesMpSimulado = {
  /** Base de `urlCheckout` (APP_URL). */
  appUrl: string;
  /** Relógio (padrão: agora). Os testes de prazo o controlam. */
  agora?: () => Date;
  /** Só os testes informam (outro cliente de banco). */
  repo?: RepoSimMercadoPago;
};

/** ID que não é UUID nunca existiu no simulado: não encontrado, sem consultar o banco. */
function exigirId(id: string): void {
  if (!ehUuid(id)) throw new RecursoNaoEncontradoNoProvedor();
}

export function criarMercadoPagoSimulado(o: OpcoesMpSimulado): PortaMercadoPago & ControleMpSimulado {
  const repo = o.repo ?? repoSimMercadoPago();
  const agora = o.agora ?? (() => new Date());
  const baseCheckout = `${o.appUrl.replace(/\/+$/, '')}/dev/mp-checkout`;

  /** Erro forçado: consultado ANTES de qualquer efeito da operação (RN-18). */
  async function falharSeForcado(operacao: OperacaoMp): Promise<void> {
    if (await repo.consumirErroForcado(operacao)) throw new ErroProvedor(ERRO_FORCADO);
  }

  async function cobrar(id: string, aprovada: boolean, em: Date) {
    exigirId(id);
    const r = await repo.registrarCobranca(
      id,
      aprovada ? 'aprovado' : 'recusado',
      PRECO_MENSAL_CENTAVOS,
      em,
      aprovada ? somarUmMes : undefined,
    );
    if (r === 'nao_encontrada') throw new RecursoNaoEncontradoNoProvedor();
    if (r === 'estado_invalido') throw new OperacaoInvalidaNoProvedor(ESTADO_INVALIDO);
    return { pagamentoId: r.pagamentoId, notificacao: notificacaoSimulada('pagamento', r.pagamentoId, em) };
  }

  return {
    async criarAssinatura(e) {
      const invalida = validarCriacaoAssinatura(e);
      if (invalida) throw invalida;
      await falharSeForcado('criarAssinatura');
      const linha = await repo.criarAssinatura({
        referenciaExterna: e.salaoId,
        emailPagador: e.emailPagador,
        urlRetorno: e.urlRetorno,
        valorCentavos: PRECO_MENSAL_CENTAVOS,
      });
      return { assinaturaId: linha.id, urlCheckout: `${baseCheckout}?assinatura=${linha.id}` };
    },

    async consultarAssinatura(id) {
      exigirId(id);
      await falharSeForcado('consultarAssinatura');
      const a = await repo.buscarAssinatura(id);
      if (!a) throw new RecursoNaoEncontradoNoProvedor();
      return {
        id: a.id,
        salaoId: a.referenciaExterna,
        estado: a.estado,
        valorCentavos: a.valorCentavos,
        autorizadaEm: a.autorizadaEm,
        proximaCobrancaEm: a.proximaCobrancaEm,
        canceladaEm: a.canceladaEm,
      };
    },

    async consultarPagamento(id) {
      exigirId(id);
      await falharSeForcado('consultarPagamento');
      const p = await repo.buscarPagamento(id);
      if (!p) throw new RecursoNaoEncontradoNoProvedor();
      return {
        id: p.id,
        assinaturaId: p.assinaturaId,
        status: p.status,
        valorCentavos: p.valorCentavos,
        ocorridoEm: p.cobradoEm,
      };
    },

    async cancelarAssinatura(id) {
      exigirId(id);
      await falharSeForcado('cancelarAssinatura');
      // Idempotente: 'ja_cancelada' não é erro na porta.
      if ((await repo.cancelar(id, agora())) === 'nao_encontrada') {
        throw new RecursoNaoEncontradoNoProvedor();
      }
    },

    async adiarProximaCobranca(id, novaData) {
      exigirId(id);
      if (!(novaData instanceof Date) || Number.isNaN(novaData.getTime())) {
        throw new OperacaoInvalidaNoProvedor(DATA_INVALIDA);
      }
      await falharSeForcado('adiarProximaCobranca');
      const r = await repo.adiar(id, novaData, agora());
      if (r === 'nao_encontrada') throw new RecursoNaoEncontradoNoProvedor();
      if (r === 'estado_invalido') throw new OperacaoInvalidaNoProvedor(ESTADO_INVALIDO);
      if (r === 'data_invalida') throw new OperacaoInvalidaNoProvedor(DATA_INVALIDA);
    },

    async urlAtualizarMeioPagamento(id) {
      exigirId(id);
      await falharSeForcado('urlAtualizarMeioPagamento');
      const a = await repo.buscarAssinatura(id);
      if (!a) throw new RecursoNaoEncontradoNoProvedor();
      if (a.estado === 'cancelada') throw new OperacaoInvalidaNoProvedor(ESTADO_INVALIDO);
      return `${baseCheckout}?assinatura=${id}`;
    },

    async validarWebhook(n) {
      return validarNotificacaoSimulada(n);
    },

    async autorizar(id, opcoes = {}) {
      exigirId(id);
      const em = opcoes.em ?? agora();
      const r = await repo.autorizar(id, em, somarDias(em, DIAS_TESTE));
      if (r === 'nao_encontrada') throw new RecursoNaoEncontradoNoProvedor();
      if (r === 'estado_invalido') throw new OperacaoInvalidaNoProvedor(ESTADO_INVALIDO);
      return notificacaoSimulada('assinatura', id, em);
    },

    aprovarCobranca: (id, opcoes = {}) => cobrar(id, true, opcoes.em ?? agora()),
    falharCobranca: (id, opcoes = {}) => cobrar(id, false, opcoes.em ?? agora()),

    async cancelar(id, opcoes = {}) {
      exigirId(id);
      const em = opcoes.em ?? agora();
      const r = await repo.cancelar(id, em);
      if (r === 'nao_encontrada') throw new RecursoNaoEncontradoNoProvedor();
      if (r === 'ja_cancelada') throw new OperacaoInvalidaNoProvedor(ESTADO_INVALIDO);
      return notificacaoSimulada('assinatura', id, em);
    },

    async forcarErro(operacao) {
      if (!(OPERACOES_MP as readonly string[]).includes(operacao)) {
        throw new RangeError('forcarErro: operação desconhecida do Mercado Pago.');
      }
      await repo.forcarErro(operacao);
    },

    async listarAdiamentos(id) {
      const linhas = await repo.listarAdiamentos(id);
      return linhas.map((l) => ({ dataAnterior: l.dataAnterior, novaData: l.novaData, criadoEm: l.criadoEm }));
    },
  };
}
