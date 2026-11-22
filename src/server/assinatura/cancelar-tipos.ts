// Contratos client-safe do cancelamento (D-042). Sem imports de servidor. As mensagens nunca incluem
// texto cru do provedor; a data sai de `formatarData` no fuso do salão.
import { formatarData } from '@/lib/format';
import type { VarianteAlerta } from '@/components/ui/Alert';

export const ESTADOS_VISTOS = ['pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada', 'encerrada'] as const;
export type EstadoVisto = (typeof ESTADOS_VISTOS)[number];

/** Dica de UX da etapa 2 (nunca escolhe a assinatura): fora da lista fechada, é ignorada. */
export function lerEstadoVisto(valor: unknown): EstadoVisto | undefined {
  return typeof valor === 'string' && (ESTADOS_VISTOS as readonly string[]).includes(valor) ? (valor as EstadoVisto) : undefined;
}

export type EntradaCancelar = { estadoVisto?: EstadoVisto };

export type ResultadoCancelar =
  | { resultado: 'cancelada'; para: 'cancelada' | 'encerrada'; acessoAte: Date | null; fuso: string }
  | { resultado: 'ja_cancelada'; acessoAte: Date | null; fuso: string }
  /** `estadoVisto` ≠ real, ou o vínculo/estado mudou sob a trava. */
  | { resultado: 'mudou' }
  /** Erro do provedor: nada foi alterado. */
  | { resultado: 'provedor_indisponivel' }
  /** O provedor cancelou, mas o banco falhou: repetir é seguro (idempotente). */
  | { resultado: 'tente_novamente' }
  | { resultado: 'recusado'; motivo: 'estado' | 'manual' };

export const MENSAGENS_CANCELAR = {
  cancelada: 'Assinatura cancelada.',
  encerrada: 'Assinatura cancelada e encerrada. O painel ficou somente leitura.',
  jaCancelada: 'Sua assinatura já estava cancelada.',
  mudou: 'A assinatura mudou. Atualizamos as informações.',
  provedorIndisponivel: 'Não foi possível concluir agora. Nada foi alterado; tente novamente.',
  tenteNovamente: 'Não foi possível concluir o cancelamento agora. Tente novamente em instantes.',
  recusado: 'Não é possível cancelar a assinatura neste momento.',
  recusadoManual: 'O salão está suspenso pela administração. Entre em contato com o suporte.',
} as const;

const comAcesso = (base: string, acessoAte: Date | null, fuso: string): string =>
  acessoAte === null ? base : `${base} Acesso até ${formatarData(acessoAte, fuso)}.`;

/** Mensagem pt-BR do resultado (pura). */
export function mensagemDeCancelar(r: ResultadoCancelar): { texto: string; variante: VarianteAlerta } {
  switch (r.resultado) {
    case 'cancelada':
      return r.para === 'encerrada'
        ? { texto: MENSAGENS_CANCELAR.encerrada, variante: 'sucesso' }
        : { texto: comAcesso(MENSAGENS_CANCELAR.cancelada, r.acessoAte, r.fuso), variante: 'sucesso' };
    case 'ja_cancelada':
      return { texto: comAcesso(MENSAGENS_CANCELAR.jaCancelada, r.acessoAte, r.fuso), variante: 'info' };
    case 'mudou':
      return { texto: MENSAGENS_CANCELAR.mudou, variante: 'info' };
    case 'provedor_indisponivel':
      return { texto: MENSAGENS_CANCELAR.provedorIndisponivel, variante: 'erro' };
    case 'tente_novamente':
      return { texto: MENSAGENS_CANCELAR.tenteNovamente, variante: 'erro' };
    default:
      return {
        texto: r.motivo === 'manual' ? MENSAGENS_CANCELAR.recusadoManual : MENSAGENS_CANCELAR.recusado,
        variante: 'aviso',
      };
  }
}
