import type { EstadoAssinatura } from '@/domain/assinatura';
import type { CodigoErroWebhook } from '@/server/assinatura/webhook-decisao';

// Contratos client-safe da tela "Assinatura e eventos" do super admin (D-045 RN-10/RN-11). Nunca o id do
// provedor, `chave_dedupe` nem `recurso_id`.

export const MAX_CAUSA = 80;

/** Códigos de erro do webhook que a tela mostra; qualquer outro valor gravado → "—" (RN-10). */
const CODIGOS: Record<CodigoErroWebhook, true> = {
  assinatura_desconhecida: true,
  recurso_inexistente: true,
  vinculo_invalido: true,
  estado_pendente: true,
  provedor_indisponivel: true,
  ocupada: true,
  interno: true,
  pagamento_duplicado: true,
  sem_assinatura: true,
  ignorado_pela_maquina: true,
};
export const CODIGOS_ERRO_WEBHOOK: readonly string[] = Object.freeze(Object.keys(CODIGOS));

export type ResumoAssinaturaDTO = {
  estado: EstadoAssinatura;
  vinculada: boolean;
  testeFimEm: string | null;
  periodoPagoAte: string | null;
  primeiraFalhaEm: string | null;
  carenciaAte: string | null;
  canceladaEm: string | null;
  acessoAte: string | null;
};

export type TransicaoDTO = {
  id: string;
  de: EstadoAssinatura | null;
  para: EstadoAssinatura;
  /** Texto gravado, truncado em 80 caracteres. */
  causa: string;
  ocorridaEm: string;
  origemEvento: boolean;
};

export type EventoDTO = {
  id: string;
  tipo: string | null;
  resultado: string;
  origemValida: boolean;
  /** Só código fechado; senão null. */
  erro: string | null;
  recebidoEm: string;
  processadoEm: string | null;
  /** Como gravado pela D-041 (já sanitizado). */
  payload: unknown;
};

export type AssinaturaDoSalaoDTO = {
  salao: { id: string; nome: string; fuso: string };
  assinatura: ResumoAssinaturaDTO | null;
  transicoes: TransicaoDTO[];
  eventos: EventoDTO[];
  /** Há mais de 50 eventos. */
  maisEventos: boolean;
};

export const MENSAGENS_ASSINATURA_ADMIN = {
  semAssinaturaTitulo: 'Este salão ainda não tem assinatura',
  semTransicoes: 'Nenhuma transição registrada',
  semEventos: 'Nenhum evento de webhook recebido',
  maisEventos: 'Mostrando os 50 mais recentes',
  erroLeitura: 'Não foi possível carregar a assinatura.',
} as const;
