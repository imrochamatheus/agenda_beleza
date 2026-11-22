import type { JsonObjeto } from '@/server/auditoria/tipos';

import type { FiltroDeSalao } from './paginacao';

// Contratos client-safe da consulta de auditoria do super admin (D-045 RN-15). Somente leitura.

export type FiltrosAuditoria = {
  salaoId: string | null;
  /** E-mail exato em minúsculas. */
  ator: string | null;
  acao: string | null;
  resultado: 'sucesso' | 'falha' | null;
  /** 'AAAA-MM-DD' (dia civil em America/Sao_Paulo) ou null. */
  de: string | null;
  ate: string | null;
  pagina: number;
};

export type ErrosAuditoria = { de?: string; ate?: string; ator?: string };

export type RegistroAuditoriaDTO = {
  id: string;
  acao: string;
  entidade: string | null;
  resultado: string;
  ocorridoEm: string;
  /** E-mail do usuário, ou o informado; null → "Sistema". */
  atorEmail: string | null;
  salaoId: string | null;
  salaoNome: string | null;
  antes: JsonObjeto | null;
  depois: JsonObjeto | null;
};

export type ListaAuditoria = {
  itens: RegistroAuditoriaDTO[];
  total: number;
  pagina: number;
  paginas: number;
  filtros: FiltrosAuditoria;
  erros: ErrosAuditoria;
  /** Algum filtro de lista fechada ou UUID era inválido e foi ignorado. */
  ignorados: boolean;
  /** Valores digitados (ecoados nos campos; no máximo 254 caracteres). */
  ecoes: { ator: string; de: string; ate: string };
  salao: FiltroDeSalao;
};

export const MENSAGENS_AUDITORIA = {
  dataInvalida: 'Data inválida.',
  periodoInvertido: 'A data inicial é depois da final.',
  atorInvalido: 'Informe um e-mail válido.',
  vazioTitulo: 'Nenhum registro encontrado',
  erroLeitura: 'Não foi possível carregar os registros.',
} as const;
