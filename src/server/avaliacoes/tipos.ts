// Contratos client-safe das avaliações verificadas (D-032, E4.5). Sem imports de servidor.

/** RN-4: um único texto para todo link que não vale (malformado, desconhecido, usado, vencido…). */
export const MENSAGEM_LINK_INVALIDO = 'Link inválido ou expirado.';
export const LIMITE_COMENTARIO = 1000;
/** Validade do convite, contada da primeira geração (RN-3). */
export const VALIDADE_CONVITE_DIAS = 30;
/** Quantas avaliações a página pública lista (D-3). */
export const LIMITE_LISTA_PUBLICA = 10;

export const MENSAGENS_AVALIACAO = {
  nota: 'Escolha uma nota de 1 a 5.',
  comentario: `O comentário deve ter no máximo ${LIMITE_COMENTARIO} caracteres.`,
  aceite: 'Para publicar a avaliação, é preciso autorizar a publicação.',
  limitado: 'Muitas tentativas. Tente novamente em alguns minutos.',
  humano: 'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
  enviada: 'Obrigada! Sua avaliação foi publicada.',
} as const;

export type CampoAvaliacao = 'nota' | 'comentario' | 'aceite';
export type ErrosAvaliacao = Partial<Record<CampoAvaliacao, string>>;

export type EntradaEnvio = {
  slug: string;
  token: string;
  nota: unknown;
  comentario: unknown;
  aceite: unknown;
  ip: string;
  tokenHumano: string | null;
};

export type ResultadoEnvio =
  | { resultado: 'enviada' }
  | { resultado: 'invalido_campos'; erros: ErrosAvaliacao }
  | { resultado: 'link_invalido' }
  | { resultado: 'limite_excedido' }
  | { resultado: 'verificacao_falhou' };

export type ResultadoVerificacao =
  | { ok: true; nomeSalao: string; slugAtual: string; historico: boolean }
  | { ok: false; motivo: 'invalido' | 'limite' };

/** `id` só serve ao formulário de denúncia (D-035): UUID aleatório, sem relação com cliente nem reserva. */
export type AvaliacaoPublica = { id: string; nome: string; nota: number; comentario: string | null; mesAno: string };
export type AvaliacoesPublicas = { total: number; media: number | null; itens: AvaliacaoPublica[] };
