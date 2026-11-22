// Contratos client-safe do início da assinatura e do retorno do checkout (D-040). Sem imports de servidor.
// As mensagens nunca incluem texto cru do provedor.

export type ResultadoIniciar =
  | { resultado: 'iniciada'; urlCheckout: string }
  /** O provedor já tinha a autorização (RN-5): o teste foi iniciado sem criar outra. */
  | { resultado: 'teste_iniciado' }
  | { resultado: 'recusado'; motivo: 'ja_existe' }
  | { resultado: 'provedor_indisponivel' }
  /** Perdeu a corrida de gravação do vínculo (iniciar x iniciar). */
  | { resultado: 'tente_novamente' };

export const RESULTADOS_RETORNO = [
  'teste_iniciado',
  'ja_em_teste',
  'aguardando',
  'cancelada_no_provedor',
  'sem_assinatura',
  'indisponivel',
  'vinculo_invalido',
  'neutro',
] as const;
export type ResultadoRetorno = (typeof RESULTADOS_RETORNO)[number];

export const MENSAGENS_ASSINATURA = {
  provedorIndisponivel: 'Não foi possível falar com o provedor de pagamento agora. Tente novamente em instantes.',
  jaExiste: 'O salão já tem uma assinatura. Renovação e reativação ficam disponíveis em breve.',
  tenteNovamente: 'Outra tentativa estava em andamento. Toque em "Assinar" novamente.',
  testeIniciado: 'Assinatura autorizada! Seu período de teste começou e o agendamento está liberado.',
  testeIniciadoAntes: 'Seu período de teste já está em andamento.',
  aguardando: 'Ainda aguardando a confirmação do provedor de pagamento. Atualize esta página em instantes.',
  canceladaNoProvedor: 'A autorização foi cancelada no provedor de pagamento. Você pode tentar assinar novamente.',
  semAssinatura: 'Nenhuma assinatura em andamento. Inicie a assinatura para continuar.',
  indisponivel: 'Não foi possível consultar o provedor de pagamento agora. Atualize esta página em instantes.',
  vinculoInvalido: 'Não foi possível confirmar esta assinatura. Inicie a assinatura novamente.',
  neutro: 'Nada a atualizar no momento.',
} as const;

export function mensagemDeRetorno(r: ResultadoRetorno): string {
  switch (r) {
    case 'teste_iniciado':
      return MENSAGENS_ASSINATURA.testeIniciado;
    case 'ja_em_teste':
      return MENSAGENS_ASSINATURA.testeIniciadoAntes;
    case 'aguardando':
      return MENSAGENS_ASSINATURA.aguardando;
    case 'cancelada_no_provedor':
      return MENSAGENS_ASSINATURA.canceladaNoProvedor;
    case 'sem_assinatura':
      return MENSAGENS_ASSINATURA.semAssinatura;
    case 'indisponivel':
      return MENSAGENS_ASSINATURA.indisponivel;
    case 'vinculo_invalido':
      return MENSAGENS_ASSINATURA.vinculoInvalido;
    default:
      return MENSAGENS_ASSINATURA.neutro;
  }
}

export function mensagemDeIniciar(r: Exclude<ResultadoIniciar, { resultado: 'iniciada' }>): string {
  switch (r.resultado) {
    case 'teste_iniciado':
      return MENSAGENS_ASSINATURA.testeIniciado;
    case 'recusado':
      return MENSAGENS_ASSINATURA.jaExiste;
    case 'provedor_indisponivel':
      return MENSAGENS_ASSINATURA.provedorIndisponivel;
    default:
      return MENSAGENS_ASSINATURA.tenteNovamente;
  }
}
