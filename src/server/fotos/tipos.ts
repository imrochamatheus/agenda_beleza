// Contratos, limites, códigos e mensagens das fotos do salão (D-021 §3.4; RN-4..RN-18).
// Client-safe: só constantes, tipos e funções puras, sem import de runtime de @/server/** (é importado
// por componentes cliente, pela casca, pelo route handler e pelo serviço).

export const LIMITES_FOTO = Object.freeze({
  /** RN-10. */
  maxFotos: 12,
  /** RN-4 (D-3): 5 MiB. */
  maxBytes: 5_242_880,
  /** Folga do envelope multipart e do texto alternativo (RN-4). */
  folgaCorpo: 65_536,
  /** RN-9 (UTF-16, igual ao maxlength). */
  maxAlt: 150,
});

/** Maior corpo aceito: arquivo + folga (RN-4). */
export const LIMITE_CORPO_BYTES = LIMITES_FOTO.maxBytes + LIMITES_FOTO.folgaCorpo;

/** RN-17: lista fechada de códigos do `?envio=` (e dos resultados do envio). */
export const CODIGOS_ENVIO = Object.freeze([
  'ok',
  'tamanho',
  'tipo',
  'ilegivel',
  'resolucao',
  'limite',
  'alt_vazio',
  'alt_longo',
  'sem_arquivo',
  'falha',
  'negado',
] as const);
export type CodigoEnvio = (typeof CODIGOS_ENVIO)[number];

export function ehCodigoEnvio(v: unknown): v is CodigoEnvio {
  return typeof v === 'string' && (CODIGOS_ENVIO as readonly string[]).includes(v);
}

/** Mensagens pt-BR por código do envio (spec RN-4..RN-17). */
export const MENSAGENS_FOTO = Object.freeze({
  ok: 'Foto enviada.',
  tamanho: 'A foto deve ter no máximo 5 MB.',
  tipo: 'Envie uma foto em JPEG, PNG ou WebP.',
  ilegivel: 'Não foi possível ler esta imagem. Tente outro arquivo.',
  resolucao: 'A foto tem resolução grande demais (máximo de 50 megapixels).',
  limite: 'O salão já tem 12 fotos. Remova uma para enviar outra.',
  alt_vazio: 'Descreva a foto (texto alternativo para quem usa leitor de tela).',
  alt_longo: 'Use no máximo 150 caracteres na descrição da foto.',
  sem_arquivo: 'Escolha uma foto para enviar.',
  falha: 'Não foi possível salvar a foto agora. Tente de novo em instantes.',
  negado: 'Você não tem permissão para alterar as fotos do salão.',
  /** Ações sobre a lista (RN-9, RN-11, RN-12, RN-18). */
  alt_salvo: 'Descrição da foto salva.',
  movida: 'Ordem das fotos alterada.',
  ordem_mudou: 'A ordem das fotos mudou. Confira e tente de novo.',
  na_ponta: 'A foto já está nessa ponta da lista.',
  removida: 'Foto removida.',
  nao_encontrada: 'A foto não foi encontrada; ela pode já ter sido removida.',
} as const satisfies Record<string, string>);

/** Códigos do `?acao=` (PRG das ações sobre a lista); lista fechada. */
export const CODIGOS_ACAO = Object.freeze([
  'alt_ok',
  'movida',
  'ordem_mudou',
  'na_ponta',
  'removida',
  'alt_vazio',
  'alt_longo',
  'nao_encontrada',
  'negado',
] as const);
export type CodigoAcao = (typeof CODIGOS_ACAO)[number];
export function ehCodigoAcao(v: unknown): v is CodigoAcao {
  return typeof v === 'string' && (CODIGOS_ACAO as readonly string[]).includes(v);
}

/** Mensagem de cada código de ação. */
export const MENSAGENS_ACAO: Readonly<Record<CodigoAcao, string>> = Object.freeze({
  alt_ok: MENSAGENS_FOTO.alt_salvo,
  movida: MENSAGENS_FOTO.movida,
  ordem_mudou: MENSAGENS_FOTO.ordem_mudou,
  na_ponta: MENSAGENS_FOTO.na_ponta,
  removida: MENSAGENS_FOTO.removida,
  alt_vazio: MENSAGENS_FOTO.alt_vazio,
  alt_longo: MENSAGENS_FOTO.alt_longo,
  nao_encontrada: MENSAGENS_FOTO.nao_encontrada,
  negado: MENSAGENS_FOTO.negado,
});

export type FotoDoPainel = { id: string; posicao: number; alt: string; largura: number; altura: number };
export type FotoPublica = { id: string; url: string; alt: string; largura: number; altura: number };

/** Corpo do envio já lido e limitado (multipart.ts). */
export type CorpoLido =
  | { ok: true; arquivo: Uint8Array; alt: string; envio: string }
  | { ok: false; codigo: Exclude<CodigoEnvio, 'ok' | 'negado' | 'limite'> };

export type EntradaEnvio = { obterCorpo: () => Promise<CorpoLido> };
export type ResultadoEnvio =
  | { resultado: 'ok'; fotoId: string | null; duplicado: boolean }
  | { resultado: 'recusado'; codigo: Exclude<CodigoEnvio, 'ok' | 'negado'> };

export type EntradaAlt = { fotoId: string; alt: string };
export type ResultadoAlt = { resultado: 'salvo' | 'invalido'; erro?: string };

export type EntradaMover = { fotoId: string; direcao: 'cima' | 'baixo'; posicaoEsperada: number };
export type ResultadoMover = { resultado: 'movida' | 'ordem_mudou' | 'na_ponta' };

export type EntradaRemover = { fotoId: string };
export type ResultadoRemover = { resultado: 'removida' };
