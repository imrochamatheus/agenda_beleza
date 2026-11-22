import { listarSaloesParaFiltro } from '@/server/repos/admin-filtros';

import { LIMITE_SELECT_SALOES } from './paginacao';
import type { FiltroDeSalao } from './paginacao';

/**
 * `Select` de salões (até `limite`, por nome) ou, acima disso, campo de código (D-045 §1.2). Lê `limite + 1`
 * linhas: se vier o excedente, não monta a lista. O limite é injetável para o teste.
 */
export async function montarFiltroDeSalao(limite: number = LIMITE_SELECT_SALOES): Promise<FiltroDeSalao> {
  const linhas = await listarSaloesParaFiltro(limite);
  return linhas.length > limite ? { modo: 'codigo' } : { modo: 'select', opcoes: linhas };
}
