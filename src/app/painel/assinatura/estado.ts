// Estado dos formulários da assinatura (D-040, D-042). Client-safe. O resultado volta no estado da
// resposta, sem PRG: funciona sem JavaScript. `em` desempata qual mensagem é a mais recente.

export type VarianteDoResultado = 'sucesso' | 'info' | 'aviso' | 'erro';

export type EstadoAcaoAssinatura = { mensagem: string | null; variante: VarianteDoResultado; em: number };

export const ESTADO_ACAO_INICIAL: EstadoAcaoAssinatura = { mensagem: null, variante: 'info', em: 0 };

export type AcaoDaAssinatura = (anterior: EstadoAcaoAssinatura, formData: FormData) => Promise<EstadoAcaoAssinatura>;

export type AcoesDaTela = { assinar: AcaoDaAssinatura; regularizar: AcaoDaAssinatura; cancelar: AcaoDaAssinatura };
