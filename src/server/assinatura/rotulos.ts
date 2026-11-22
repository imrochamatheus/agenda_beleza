import type { SituacaoOperacional } from '@/domain/assinatura';

// Rótulos pt-BR da situação do salão para a tela de assinatura (D-040; a tela completa é a E6.5).

const ROTULOS: Record<SituacaoOperacional, string> = {
  sem_assinatura: 'Sem assinatura',
  pendente: 'Assinatura pendente',
  em_teste: 'Em período de teste',
  ativa: 'Assinatura ativa',
  em_carencia: 'Pagamento não confirmado',
  suspensa: 'Assinatura suspensa',
  cancelada: 'Assinatura cancelada',
  encerrada: 'Assinatura encerrada',
  manual: 'Salão suspenso pela administração',
};

export const rotuloDeSituacao = (s: SituacaoOperacional): string => ROTULOS[s];
