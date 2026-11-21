// Contratos client-safe das denúncias e da moderação de avaliações (D-035, E8.4). Sem imports de servidor.

export const MOTIVOS_DENUNCIA = ['ofensivo', 'falso', 'spam', 'dados_pessoais', 'outro'] as const;
export type MotivoDenuncia = (typeof MOTIVOS_DENUNCIA)[number];

export const ROTULOS_MOTIVO: Record<MotivoDenuncia, string> = {
  ofensivo: 'Linguagem ofensiva',
  falso: 'Conteúdo falso ou enganoso',
  spam: 'Propaganda ou spam',
  dados_pessoais: 'Expõe dados pessoais',
  outro: 'Outro motivo',
};

export const RESOLUCOES = ['retirada', 'mantida'] as const;
export type Resolucao = (typeof RESOLUCOES)[number];

export const LIMITE_TEXTO_DENUNCIA = 500;
export const MOTIVO_MODERACAO_MIN = 3;
export const MOTIVO_MODERACAO_MAX = 300;
/** Teto de denúncias pendentes por avaliação (RN-5); acima, a resposta é uniforme e nada é gravado. */
export const TETO_PENDENTES = 20;
export const POR_PAGINA_FILA = 20;

export const ESTADOS_FILA = ['visivel', 'retirada', 'com_denuncia_pendente'] as const;
export type EstadoFila = (typeof ESTADOS_FILA)[number];
export const ROTULOS_ESTADO: Record<EstadoFila, string> = {
  visivel: 'Visível',
  retirada: 'Retirada',
  com_denuncia_pendente: 'Com denúncia pendente',
};

export const MENSAGENS_DENUNCIA = {
  recebida: 'Recebemos sua denúncia. Obrigada por avisar.',
  motivo: 'Escolha um motivo.',
  texto: `O detalhe deve ter no máximo ${LIMITE_TEXTO_DENUNCIA} caracteres.`,
  limitado: 'Muitas tentativas. Tente novamente em alguns minutos.',
  humano: 'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
} as const;

export const MENSAGENS_MODERACAO = {
  motivoObrigatorio: `Informe o motivo, de ${MOTIVO_MODERACAO_MIN} a ${MOTIVO_MODERACAO_MAX} caracteres.`,
  motivoComDados: 'O motivo não pode conter e-mail nem telefone. Descreva sem dados pessoais.',
  avisoDados: 'Não coloque dados pessoais (e-mail, telefone) no motivo: ele fica no registro de auditoria.',
  recusadoEstado: 'A avaliação já não está nesse estado. Atualize a página.',
  semPendentes: 'Não há denúncias pendentes para arquivar.',
  retirada: 'Avaliação retirada da página pública.',
  restaurada: 'Avaliação restaurada na página pública.',
  arquivadas: 'Denúncias arquivadas; a avaliação foi mantida.',
  naoEncontrada: 'Avaliação não encontrada.',
} as const;

export type CampoDenuncia = 'motivo' | 'texto';
export type ErrosDenuncia = Partial<Record<CampoDenuncia, string>>;

export type EntradaDenuncia = {
  avaliacaoId: string;
  motivo: string;
  texto?: string;
  ip: string;
  tokenHumano?: string | null;
};

export type ResultadoDenuncia =
  | { resultado: 'recebida' }
  | { resultado: 'invalido'; erros: ErrosDenuncia }
  | { resultado: 'humano' }
  | { resultado: 'limitado' };

export type ResultadoModeracao =
  | { resultado: 'ok' }
  | { resultado: 'invalido'; erro: string }
  | { resultado: 'recusado'; motivo: 'estado_atual' | 'sem_pendentes' };

export type ItemDaFila = {
  id: string;
  salaoId: string;
  salaoNome: string;
  nota: number;
  nome: string | null;
  comentario: string | null;
  criadoEm: Date;
  retiradaEm: Date | null;
  pendentes: number;
  motivos: MotivoDenuncia[];
  /** Reserva não concluída ou cliente anonimizada: a avaliação não aparece publicamente. */
  naoPublicada: boolean;
};

export type FilaModeracao = { total: number; pagina: number; porPagina: number; itens: ItemDaFila[] };

export type DenunciaDoDetalhe = {
  id: string;
  motivo: MotivoDenuncia;
  texto: string | null;
  criadoEm: Date;
  resolvidaEm: Date | null;
  resolucao: Resolucao | null;
};

export type DetalheDaAvaliacao = Omit<ItemDaFila, 'pendentes' | 'motivos'> & {
  denuncias: DenunciaDoDetalhe[];
};
