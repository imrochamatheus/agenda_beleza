import { z } from 'zod';

// Porta do Mercado Pago (RN-12). Não importa provedor, Prisma nem process.env.
// IDs de recurso são strings opacas: o simulado usa UUID e o real (E6.6) o formato do MP.

/** Estado na nomenclatura da porta, independente da do provedor. */
export type EstadoAssinaturaProvedor = 'pendente' | 'autorizada' | 'cancelada';
export type StatusPagamentoProvedor = 'aprovado' | 'recusado';

export type AssinaturaProvedor = {
  id: string;
  /** Referência externa gravada em `criarAssinatura` (vínculo inequívoco com o salão). */
  salaoId: string;
  estado: EstadoAssinaturaProvedor;
  valorCentavos: number;
  autorizadaEm: Date | null;
  proximaCobrancaEm: Date | null;
  canceladaEm: Date | null;
};

export type PagamentoProvedor = {
  id: string;
  assinaturaId: string;
  status: StatusPagamentoProvedor;
  valorCentavos: number;
  ocorridoEm: Date;
};

export type NotificacaoWebhook = {
  /** Nomes em minúsculas. */
  cabecalhos: Readonly<Record<string, string>>;
  /** Query string (`data.id`, `type`). */
  consulta: Readonly<Record<string, string>>;
  /** JSON já parseado. */
  corpo: unknown;
  /** Texto exato recebido (até 16 KiB), para o HMAC do adaptador real (E6.6). O simulado o ignora. */
  corpoBruto?: string;
};

export type ResultadoValidacaoWebhook =
  | { valida: false }
  | { valida: true; tipo: 'assinatura' | 'pagamento'; recursoId: string };

export type EntradaCriarAssinatura = { salaoId: string; emailPagador: string; urlRetorno: string };

export interface PortaMercadoPago {
  criarAssinatura(e: EntradaCriarAssinatura): Promise<{ assinaturaId: string; urlCheckout: string }>;
  consultarAssinatura(id: string): Promise<AssinaturaProvedor>;
  consultarPagamento(id: string): Promise<PagamentoProvedor>;
  /** Idempotente: cancelar uma assinatura já cancelada não falha. */
  cancelarAssinatura(id: string): Promise<void>;
  adiarProximaCobranca(id: string, novaData: Date): Promise<void>;
  /** D-042: URL em que o gestor atualiza o meio de pagamento da assinatura (nenhum efeito local). */
  urlAtualizarMeioPagamento(id: string): Promise<string>;
  /** Nunca lança: qualquer problema vira `{ valida: false }`. */
  validarWebhook(n: NotificacaoWebhook): Promise<ResultadoValidacaoWebhook>;
}

export const OPERACOES_MP = [
  'criarAssinatura',
  'consultarAssinatura',
  'consultarPagamento',
  'cancelarAssinatura',
  'adiarProximaCobranca',
  'urlAtualizarMeioPagamento',
] as const;
export type OperacaoMp = (typeof OPERACOES_MP)[number];

export type CodigoErroMercadoPago = 'nao_encontrado' | 'operacao_invalida' | 'falha_provedor';

/** Base dos erros da porta. Erros do provedor nunca vazam para a lógica de negócio (E6.6 RN-3). */
export abstract class ErroMercadoPago extends Error {
  abstract readonly codigo: CodigoErroMercadoPago;
}

/** Identificador desconhecido no provedor. */
export class RecursoNaoEncontradoNoProvedor extends ErroMercadoPago {
  readonly codigo = 'nao_encontrado';

  constructor(mensagem = 'Recurso não encontrado no provedor de pagamento.') {
    super(mensagem);
    this.name = 'RecursoNaoEncontradoNoProvedor';
  }
}

/** Operação recusada por estado, data ou entrada inválidos. */
export class OperacaoInvalidaNoProvedor extends ErroMercadoPago {
  readonly codigo = 'operacao_invalida';

  constructor(mensagem = 'Operação inválida no provedor de pagamento.') {
    super(mensagem);
    this.name = 'OperacaoInvalidaNoProvedor';
  }
}

/** Falha do provedor (inclui o erro forçado do simulado). */
export class ErroProvedor extends ErroMercadoPago {
  readonly codigo = 'falha_provedor';

  constructor(mensagem = 'Falha no provedor de pagamento.') {
    super(mensagem);
    this.name = 'ErroProvedor';
  }
}

const ENTRADA_CRIAR_ASSINATURA = z.object({
  salaoId: z.uuid(),
  emailPagador: z.email(),
  urlRetorno: z.url({ protocol: /^https?$/ }),
});

/**
 * Validação comum a simulado e real, feita antes de qualquer efeito (RN-12): `salaoId` UUID,
 * `emailPagador` e-mail e `urlRetorno` URL absoluta http(s). Devolve o erro ou null.
 * A mensagem não ecoa valores.
 */
export function validarCriacaoAssinatura(
  e: EntradaCriarAssinatura,
): OperacaoInvalidaNoProvedor | null {
  const resultado = ENTRADA_CRIAR_ASSINATURA.safeParse(e);
  if (resultado.success) return null;
  const campos = [...new Set(resultado.error.issues.map((i) => String(i.path[0])))].sort();
  return new OperacaoInvalidaNoProvedor(
    `Operação inválida no provedor de pagamento: entrada inválida (${campos.join(', ')}).`,
  );
}
