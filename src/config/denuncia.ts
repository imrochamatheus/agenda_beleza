/** Nomes fixos dos campos do formulário de denúncia de avaliação (D-035); a página e o servidor leem daqui. */
export const CAMPOS_DENUNCIA = {
  slug: 'slug',
  avaliacao: 'avaliacao_id',
  motivo: 'motivo',
  texto: 'texto',
} as const;

/** Valor de `?denuncia=` da página pública depois de uma denúncia aceita (PRG). */
export const PARAMETRO_DENUNCIA = 'denuncia';
export const VALOR_DENUNCIA_RECEBIDA = 'recebida';
