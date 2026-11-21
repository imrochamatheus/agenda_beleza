/** Nomes fixos dos campos dos formulários de moderação (D-035); as páginas e as ações leem daqui. */
export const CAMPOS_MODERACAO = {
  avaliacao: 'avaliacao_id',
  denuncia: 'denuncia_id',
  motivo: 'motivo',
} as const;

/** Parâmetro do PRG das ações de moderação: um código de lista fechada, nunca texto livre. */
export const PARAMETRO_RESULTADO = 'resultado';
