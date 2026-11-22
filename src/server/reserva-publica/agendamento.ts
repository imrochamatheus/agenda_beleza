// Decisão única "o salão aceita reservas pela página pública?" (D-026 RN-5, D-038 RN-4). Pura: sem imports
// de runtime, sem relógio. O critério assinatura/manual deriva da tabela de capacidades (`agendar`),
// resolvida em `estadoEfetivoDoSalao`; não há lista paralela de estados.

export type EstadoAgendamento = {
  /** `estado.motivo === 'manual'` do estado efetivo. */
  suspensoManual: boolean;
  /** `estado.capacidades.agendar` do estado efetivo. */
  agendar: boolean;
  servicosOfertaveis: number;
};

export type MotivoIndisponivel = 'suspenso_manual' | 'assinatura' | 'sem_servico';
export type DecisaoAgendamento = { disponivel: true } | { disponivel: false; motivo: MotivoIndisponivel };

/** Ordem fixa de motivos: suspensão manual → assinatura (`agendar` negado) → sem serviço. */
export function agendamentoDisponivel(e: EstadoAgendamento): DecisaoAgendamento {
  if (e.suspensoManual) return { disponivel: false, motivo: 'suspenso_manual' };
  if (e.agendar !== true) return { disponivel: false, motivo: 'assinatura' };
  if (e.servicosOfertaveis === 0) return { disponivel: false, motivo: 'sem_servico' };
  return { disponivel: true };
}
