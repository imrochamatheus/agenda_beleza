// Decisão única "o salão aceita reservas pela página pública?" (D-026 RN-5, D-1). Pura: sem imports de
// runtime, sem relógio (agora é entrada). A E6.4 troca só esta função (e a `politica` do criarReserva).

export type EstadoDaAssinatura = 'pendente' | 'em_teste' | 'ativa' | 'em_carencia' | 'suspensa' | 'cancelada' | 'encerrada';

export type EstadoAgendamento = {
  suspensoManualEm: Date | null;
  assinatura: { estado: EstadoDaAssinatura; acessoAte: Date | null } | null;
  servicosOfertaveis: number;
  agora: Date;
};

export type MotivoIndisponivel = 'suspenso_manual' | 'assinatura' | 'sem_servico';
export type DecisaoAgendamento = { disponivel: true } | { disponivel: false; motivo: MotivoIndisponivel };

/**
 * Ordem fixa de motivos: suspensão manual → assinatura → sem serviço. Sem assinatura (salão legado ou
 * de seed) é disponível (D-1). `cancelada` vale até `acessoAte` (exclusivo).
 */
export function agendamentoDisponivel(e: EstadoAgendamento): DecisaoAgendamento {
  if (e.suspensoManualEm !== null) return { disponivel: false, motivo: 'suspenso_manual' };
  const a = e.assinatura;
  if (a !== null) {
    switch (a.estado) {
      case 'pendente':
      case 'suspensa':
      case 'encerrada':
        return { disponivel: false, motivo: 'assinatura' };
      case 'cancelada':
        if (a.acessoAte === null || a.acessoAte.getTime() <= e.agora.getTime()) {
          return { disponivel: false, motivo: 'assinatura' };
        }
        break;
      default:
        break;
    }
  }
  if (e.servicosOfertaveis === 0) return { disponivel: false, motivo: 'sem_servico' };
  return { disponivel: true };
}
