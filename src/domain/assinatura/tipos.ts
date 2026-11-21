// Tipos do domínio da assinatura (D-037). Client-safe, sem imports de servidor.

export const ESTADOS_ASSINATURA = [
  'pendente',
  'em_teste',
  'ativa',
  'em_carencia',
  'suspensa',
  'cancelada',
  'encerrada',
] as const;
export type EstadoAssinatura = (typeof ESTADOS_ASSINATURA)[number];

export type Origem =
  | 'pagamento_aprovado'
  | 'pagamento_recusado'
  | 'cancelamento_gestor'
  | 'prazo_carencia'
  | 'prazo_acesso'
  | 'prazo_teste'
  | 'teste_iniciado';

export type EventoDominio =
  | { tipo: 'teste_iniciado' }
  | { tipo: 'cobranca_aprovada'; pagoEm: Date }
  | { tipo: 'cobranca_falhou'; falhouEm: Date }
  | { tipo: 'cancelamento' }
  | { tipo: 'prazo' };

/** Colunas de data da assinatura usadas pela máquina (UTC). */
export type CamposAssinatura = {
  testeFimEm: Date | null;
  periodoPagoAte: Date | null;
  primeiraFalhaEm: Date | null;
  carenciaAte: Date | null;
  canceladaEm: Date | null;
  acessoAte: Date | null;
};

export type AssinaturaBruta = { estado: string } & CamposAssinatura;

export type Passo = {
  de: EstadoAssinatura;
  para: EstadoAssinatura;
  origem: Origem;
  campos: Partial<CamposAssinatura>;
};

export type MotivoIgnorado = 'estado_incompativel' | 'assinatura_pendente' | 'assinatura_encerrada' | 'desconhecido';

export type Decisao =
  | { tipo: 'transicoes'; passos: Passo[] }
  | { tipo: 'atualiza'; campos: { periodoPagoAte: Date } }
  | { tipo: 'sem_efeito' }
  | { tipo: 'ignorado'; motivo: MotivoIgnorado };
