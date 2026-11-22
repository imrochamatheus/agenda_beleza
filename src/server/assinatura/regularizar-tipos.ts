// Contratos client-safe de "regularizar / atualizar meio de pagamento" (D-042). Sem imports de servidor.
import type { VarianteAlerta } from '@/components/ui/Alert';

export type ResultadoRegularizar =
  | { resultado: 'iniciada'; url: string }
  /** `pendente` cujo provedor já tinha a autorização (delegado a `iniciarAssinatura`). */
  | { resultado: 'teste_iniciado' }
  | { resultado: 'provedor_indisponivel' }
  /** Perdeu a corrida de gravação do vínculo (delegado a `iniciarAssinatura`). */
  | { resultado: 'tente_novamente' }
  | { resultado: 'recusado'; motivo: 'estado' | 'manual' | 'sem_vinculo' };

export const MENSAGENS_REGULARIZAR = {
  provedorIndisponivel: 'Não foi possível concluir agora. Nada foi alterado; tente novamente.',
  tenteNovamente: 'Outra tentativa estava em andamento. Tente novamente.',
  testeIniciado: 'Assinatura autorizada! Seu período de teste começou e o agendamento está liberado.',
  recusado: 'Não é possível atualizar o meio de pagamento neste momento.',
  semVinculo: 'Não encontramos a assinatura no provedor de pagamento. Inicie a assinatura novamente.',
} as const;

/** Mensagem do resultado que NÃO redireciona (`iniciada` vira redirect na casca). */
export function mensagemDeRegularizar(r: Exclude<ResultadoRegularizar, { resultado: 'iniciada' }>): {
  texto: string;
  variante: VarianteAlerta;
} {
  switch (r.resultado) {
    case 'teste_iniciado':
      return { texto: MENSAGENS_REGULARIZAR.testeIniciado, variante: 'sucesso' };
    case 'provedor_indisponivel':
      return { texto: MENSAGENS_REGULARIZAR.provedorIndisponivel, variante: 'erro' };
    case 'tente_novamente':
      return { texto: MENSAGENS_REGULARIZAR.tenteNovamente, variante: 'aviso' };
    default:
      return {
        texto: r.motivo === 'sem_vinculo' ? MENSAGENS_REGULARIZAR.semVinculo : MENSAGENS_REGULARIZAR.recusado,
        variante: 'aviso',
      };
  }
}
