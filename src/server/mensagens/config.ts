// Prazos do pipeline de mensagens (D-024 A-8, RN-21): constantes de código, sem variável de ambiente.

/** `pendente` mais antiga que isto é reenfileirada pela reconciliação (2 min). */
export const PRAZO_PENDENTE_MS = 120_000;
/** `enviando` mais antiga que isto vira `falhou/resultado_incerto` (5 min). */
export const PRAZO_ENVIANDO_MS = 300_000;
/** Mensagens examinadas por execução da reconciliação, de cada tipo (mais antigas primeiro). */
export const LOTE_RECONCILIACAO = 100;
/** Tempo máximo que o adaptador real (E7.2) pode levar numa chamada; PRAZO_ENVIANDO_MS é maior. */
export const TIMEOUT_MAXIMO_ENVIO_MS = 60_000;
/** `expireInSeconds` padrão do pg-boss (15 min): PRAZO_ENVIANDO_MS é menor. */
export const EXPIRACAO_PADRAO_JOB_MS = 900_000;
