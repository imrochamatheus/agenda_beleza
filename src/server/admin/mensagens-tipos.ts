import type { EstadoMensagem, TipoMensagem } from '@/server/mensagens/tipos';

import type { FiltroDeSalao } from './paginacao';

// Contratos client-safe da fila de mensagens no painel do super admin (D-045). Sem imports de servidor de
// runtime. O DTO NUNCA carrega destinatário (E.164), parâmetros, link do convite, id do provedor,
// `erro_detalhe`, chave de idempotência, id da reserva/cliente nem nome da cliente (RN-9, CA-8).

export type FiltrosMensagens = {
  estado: EstadoMensagem | null;
  tipo: TipoMensagem | null;
  salaoId: string | null;
  pagina: number;
};

export type MensagemAdminDTO = {
  id: string;
  salaoId: string;
  salaoNome: string;
  tipo: TipoMensagem;
  revisao: number;
  estado: EstadoMensagem;
  /** Já filtrado por `^[a-z0-9_]{1,40}$`. */
  erroCodigo: string | null;
  /** '+55 (71) 9****-1234', 'Cliente removida' ou '—'. */
  paraMascarado: string;
  /** ISO 8601 (UTC); a tela formata em America/Sao_Paulo. */
  criadaEm: string;
  atualizadaEm: string;
  enviadaEm: string | null;
};

/** Chaves do DTO (o teste compara com o objeto real e com a lista proibida). */
export const CHAVES_MENSAGEM_ADMIN = [
  'id',
  'salaoId',
  'salaoNome',
  'tipo',
  'revisao',
  'estado',
  'erroCodigo',
  'paraMascarado',
  'criadaEm',
  'atualizadaEm',
  'enviadaEm',
] as const satisfies readonly (keyof MensagemAdminDTO)[];

export type TentativaAdminDTO = {
  numero: number;
  iniciadaEm: string;
  finalizadaEm: string | null;
  resultado: 'sucesso' | 'falha' | null;
  erroCodigo: string | null;
};

export type ListaMensagens = {
  itens: MensagemAdminDTO[];
  total: number;
  pagina: number;
  paginas: number;
  filtros: FiltrosMensagens;
  /** Algum parâmetro de filtro era inválido e foi ignorado. */
  ignorados: boolean;
  salao: FiltroDeSalao;
};

export type ResultadoReenvioAdmin =
  | { resultado: 'reenfileirada'; mensagemId: string; filaIndisponivel: boolean }
  | { resultado: 'recusada'; motivo: 'nao_falhou' | 'obsoleta' | 'cliente_anonimizada' };

/** Códigos fechados do PRG `?reenvio=`. */
export const CODIGOS_REENVIO = ['ok', 'ok_fila', 'recusada', 'obsoleta', 'anonimizada', 'inexistente'] as const;
export type CodigoReenvio = (typeof CODIGOS_REENVIO)[number];

export function codigoDoReenvio(r: ResultadoReenvioAdmin): CodigoReenvio {
  if (r.resultado === 'reenfileirada') return r.filaIndisponivel ? 'ok_fila' : 'ok';
  if (r.motivo === 'obsoleta') return 'obsoleta';
  return r.motivo === 'cliente_anonimizada' ? 'anonimizada' : 'recusada';
}

export function lerCodigoDeReenvio(v: unknown): CodigoReenvio | null {
  return typeof v === 'string' && (CODIGOS_REENVIO as readonly string[]).includes(v) ? (v as CodigoReenvio) : null;
}

export const MENSAGENS_REENVIO: Record<CodigoReenvio, { variante: 'sucesso' | 'info' | 'aviso'; texto: string }> = {
  ok: { variante: 'sucesso', texto: 'Reenvio solicitado. A mensagem volta para a fila e o envio é feito em instantes.' },
  ok_fila: { variante: 'info', texto: 'Reenvio registrado. A fila está lenta; o envio será retomado automaticamente.' },
  recusada: { variante: 'info', texto: 'Nada foi reenviado: esta mensagem não está mais com falha.' },
  obsoleta: { variante: 'aviso', texto: 'Nada foi reenviado: a reserva mudou e a mensagem perdeu a validade.' },
  anonimizada: { variante: 'info', texto: 'A cliente foi removida; a mensagem foi cancelada e nada foi enviado.' },
  inexistente: { variante: 'info', texto: 'Mensagem não encontrada.' },
};

export const TEXTO_FILTRO_INVALIDO = 'Filtro inválido ignorado.';
